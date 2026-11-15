import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.js';
import { Translator } from '../server/translator.js';

const root = new URL('../', import.meta.url), local = new URL('.local/', root), shots = new URL('screenshots/', local);
await mkdir(shots, { recursive: true });
const connection = JSON.parse(await readFile(new URL('connection.json', local), 'utf8'));
let executablePath = process.env.BROWSER_EXECUTABLE;
if (!executablePath) { const cached = `${homedir()}/Library/Caches/ms-playwright/chromium-1161/chrome-mac/Chromium.app/Contents/MacOS/Chromium`; try { await access(cached); executablePath = cached; } catch { executablePath = chromium.executablePath(); } }
const ext = fileURLToPath(new URL('dist/extension/', root));
const context = await chromium.launchPersistentContext(await mkdtemp(fileURLToPath(new URL('page-browser-', local))), { executablePath, headless: true, args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`], viewport: { width: 1100, height: 900 } });
const errors = []; context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
let testServer;
try {
  const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker', { predicate: w => w.url().startsWith('chrome-extension://') });
  for (let i = 0; i < 100; i++) { if (await worker.evaluate(() => !!globalThis.chrome?.storage?.local)) break; if (i === 99) throw Error('Extension API readiness'); await new Promise(r => setTimeout(r, 50)); }
  const id = new URL(worker.url()).host;
  await worker.evaluate(async settings => chrome.storage.local.set({ ...settings, enabled: false, locale: 'en', pageMode: 'replace', pageTargetLanguage: 'zh-Hans' }), connection);
  const page = await context.newPage();
  const url = 'http://127.0.0.1:8787/controlled-page-fixture';
  const realHtml = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reading fixture</title><style>body{font:18px/1.8 system-ui;color:#204634;background:#f7f9f2;max-width:760px;margin:60px auto;padding:24px}h1{line-height:1.3}button{padding:10px;border:1px solid #8ca780;background:#edf4e7}</style><h1>Good stories deserve to be understood.</h1><p>Explore the world, one page at a time.</p><button>Continue reading</button>';
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: realHtml }));
  await page.goto(url);
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, url);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`); await popup.setViewportSize({ width: 390, height: 900 });
  await worker.evaluate(async tab => chrome.tabs.update(tab, { active: true }), tab);
  await popup.locator('#translate-page:not([disabled])').waitFor(); await popup.click('#page-tab');
  const originalHeading = await page.locator('h1').textContent();
  assert.equal(originalHeading, 'Good stories deserve to be understood.', 'Injection/status must not translate before a click');
  await popup.click('#translate-page');
  await page.waitForFunction(() => /[㐀-鿿]/.test(document.querySelector('h1').textContent), null, { timeout: 110000 });
  await popup.locator('#page-state').filter({ hasText: 'Page translation complete' }).waitFor({ timeout: 110000 });
  console.log('REAL page translation:', await page.locator('h1').textContent());
  await page.screenshot({ path: fileURLToPath(new URL('v2-page-real.png', shots)), fullPage: true });
  for (const locale of ['en', 'zh-CN']) {
    await popup.selectOption('#locale', locale);
    assert(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await popup.screenshot({ path: fileURLToPath(new URL(`v2-page-popup-${locale}.png`, shots)), fullPage: true });
  }
  await popup.click('#restore-page'); await page.waitForFunction(() => document.querySelector('h1').textContent === 'Good stories deserve to be understood.');
  console.log('Actual popup → injected page → local API → real provider → restore passed.');

  // Deterministic adverse provider: validates DOM safety and lifecycle without
  // requiring a real model to return a particular attack string or response time.
  const received = []; let gate = null, gateEntered = false, providerCompleted = false;
  const provider = async body => {
    received.push(...body.cues.map(c => c.text));
    if (gate) { gateEntered = true; await gate; providerCompleted = true; }
    return body.cues.map(c => ({ id: c.id, text: c.text === 'Literal markup' ? '<img src=x onerror="window.__executed=true">' : `译文 ${c.text}` }));
  };
  const token = randomBytes(32).toString('hex');
  testServer = createApp({ translator: new Translator({ provider, model: 'test-double' }), clientToken: token, model: 'test-double', port: 0, webDir: new URL('web/', root) });
  await new Promise(resolve => testServer.listen(0, '127.0.0.1', resolve));
  const testUrl = `http://127.0.0.1:${testServer.address().port}`;
  await worker.evaluate(async ({ serverUrl, clientToken }) => chrome.storage.local.set({ serverUrl, clientToken }), { serverUrl: testUrl, clientToken: token });
  await context.unroute(url);
  const safetyHtml = `<!doctype html><meta charset="utf-8"><title>DOM safety fixture</title><style>body{font:16px/1.6 system-ui;padding:30px;max-width:800px}.hidden{display:none}</style><h1 id="heading">Hello readers</h1><p id="paragraph">  Read <strong>carefully</strong> today.  </p><button id="button">Keep this button</button><a id="link" href="#section">Go to section</a><p id="markup">Literal markup</p><p id="mutable">Initial message</p><input id="form" value="PRIVATE_FORM_VALUE"><textarea>PRIVATE_TEXTAREA_VALUE</textarea><div contenteditable="true">PRIVATE_EDIT_VALUE</div><pre>PRIVATE_CODE_VALUE</pre><p class="hidden">PRIVATE_HIDDEN_VALUE</p><p translate="no">PRIVATE_NOTRANS_VALUE</p><script>window.originalButton=document.getElementById('button');window.clicks=0;originalButton.addEventListener('click',()=>window.clicks++);</script>`;
  await context.route(url, route => route.fulfill({ contentType: 'text/html', body: safetyHtml })); await page.reload();
  await popup.selectOption('#locale', 'en'); await popup.click('#translate-page');
  await page.waitForFunction(() => document.querySelector('#heading').textContent.startsWith('译文'));
  await popup.locator('#page-state').filter({ hasText: 'Page translation complete' }).waitFor();
  assert(!received.some(text => text.includes('PRIVATE_')), 'Form/editable/hidden/code/opt-out text must never be sent');
  assert.equal(await page.locator('img').count(), 0, 'Model HTML must remain literal text');
  assert.match(await page.locator('#markup').textContent(), /<img/);
  assert.equal(await page.evaluate(() => window.__executed), undefined);
  await page.click('#button'); assert.equal(await page.evaluate(() => window.clicks), 1);
  assert(await page.evaluate(() => window.originalButton === document.querySelector('#button')), 'Original DOM identity retained');
  await page.locator('#form').fill('USER_TYPED_VALUE');
  const sentBeforeMode = received.length;
  await popup.selectOption('#page-mode', 'bilingual');
  await page.waitForFunction(() => !!document.querySelector('[data-captionbridge-page-v2]'));
  assert.equal(await page.locator('#heading').evaluate(e => e.firstChild.data), 'Hello readers');
  await popup.selectOption('#page-mode', 'replace'); await page.waitForFunction(() => !document.querySelector('[data-captionbridge-page-v2]'));
  assert.equal(received.length, sentBeforeMode, 'Switching modes does not invoke the provider');
  await popup.selectOption('#locale', 'zh-CN'); assert.equal(received.length, sentBeforeMode, 'Changing UI language does not retranslate');
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'dynamic'; p.textContent = 'Newly loaded text'; document.body.append(p); });
  await page.waitForFunction(() => document.querySelector('#dynamic').textContent === '译文 Newly loaded text');
  await page.evaluate(() => { document.querySelector('#mutable').firstChild.data = 'Updated externally'; });
  await page.waitForFunction(() => document.querySelector('#mutable').textContent === '译文 Updated externally');
  await popup.click('#restore-page');
  await page.waitForFunction(() => document.querySelector('#heading').textContent === 'Hello readers');
  assert.equal(await page.locator('#mutable').textContent(), 'Updated externally', 'Restore keeps newer app-authored content');
  assert.equal(await page.locator('#paragraph').textContent(), '  Read carefully today.  ', 'Original whitespace restored exactly');
  assert.equal(await page.locator('#form').inputValue(), 'USER_TYPED_VALUE', 'Restore preserves form state');
  assert.equal(await page.locator('#dynamic').textContent(), 'Newly loaded text');

  let release; gate = new Promise(resolve => { release = resolve; });
  await popup.selectOption('#page-target', 'ja'); await popup.click('#translate-page');
  for (let i = 0; i < 100 && !gateEntered; i++) await new Promise(r => setTimeout(r, 50));
  assert(gateEntered, 'Delayed provider request started'); await popup.click('#restore-page'); release();
  for (let i = 0; i < 100 && !providerCompleted; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await page.locator('#heading').textContent(), 'Hello readers', 'Late response cannot overwrite restored original');
  assert.equal(await page.locator('[data-captionbridge-page-v2]').count(), 0);
  gate = null;
  await page.evaluate(() => { const p = document.createElement('p'); p.textContent = 'x'.repeat(500001); document.body.append(p); });
  await popup.selectOption('#locale', 'en'); await popup.click('#translate-page');
  await popup.locator('#page-error').filter({ hasText: 'processing limit' }).waitFor();
  console.log('Deterministic DOM checks passed: exclusions, handlers, modes, dynamic content, restore, cancellation, literal markup, and size caps.');
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
} finally { await context.close(); if (testServer) await new Promise(resolve => testServer.close(resolve)); }
