import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { activeCueIndex, parseCaptions, toSubtitleFile } from '../extension/src/subtitles.js';
import { attachDraggableOverlay, DEFAULT_POSITION } from '../extension/src/overlay-position.js';

const isCode = (code) => (error) => error.code === code;
const json = (events) => JSON.stringify({ events });
const event = (start, duration, text, extra = {}) => ({
  tStartMs: start, dDurationMs: duration, segs: [{ utf8: text }], ...extra,
});

test('JSON3 joins ASR segments and preserves millisecond timings', () => {
  const cues = parseCaptions(json([event(1250, 2350, '', {
    segs: [{ utf8: 'Hello ' }, { utf8: 'world', tOffsetMs: 500 }, { utf8: '\nNext line' }],
  })]), 'json3');
  assert.deepEqual(cues, [{ id: 'cue-1', start: 1.25, end: 3.6, text: 'Hello world\nNext line' }]);
});

test('JSON3 respects first segment offset and derives missing duration from the next cue', () => {
  const cues = parseCaptions(json([
    { tStartMs: 1000, segs: [{ utf8: 'First', tOffsetMs: 250 }] },
    event(2400, 900, 'Second'),
  ]), 'json3');
  assert.equal(cues[0].start, 1.25);
  assert.equal(cues[0].end, 2.4);
});

test('rolling append splits at arrival rather than moving later words earlier', () => {
  const cues = parseCaptions(json([
    event(0, 3000, 'Hello', { wWinId: 1 }),
    event(1000, 2000, ' world', { wWinId: 1, aAppend: 1 }),
    event(2000, 2000, 'Hello world again', { wWinId: 1 }),
  ]), 'json3');
  assert.deepEqual(cues.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 1, text: 'Hello' },
    { start: 1, end: 2, text: 'Hello world' },
    { start: 2, end: 4, text: 'Hello world again' },
  ]);
});

test('rolling duplicates merge but a later repeated phrase is preserved', () => {
  const cues = parseCaptions(json([
    event(0, 2000, 'Yes'), event(1000, 2000, 'Yes'), event(4000, 1000, 'Yes'),
  ]), 'json3');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].end, 3);
  assert.equal(cues[1].start, 4);
});

test('overlapping different windows do not lose timed text', () => {
  const cues = parseCaptions(json([
    event(0, 10000, 'Long speaker', { wWinId: 1 }),
    event(1000, 1000, 'Short speaker', { wWinId: 2 }),
  ]), 'json3');
  assert.equal(cues[0].end, 10);
  assert.equal(activeCueIndex(cues, 1.5), 1);
  assert.equal(activeCueIndex(cues, 2.5), 0);
});

test('legacy XML decodes named, decimal, hex and double-encoded entities', () => {
  const cues = parseCaptions(`<?xml version="1.0"?><transcript>
    <text start="1.234" dur="2.001">Tom &amp; Jerry &quot;hi&quot; &#39;ok&#39; &#x1F600; &amp;#39; &nbsp;&lt;3<br/>next</text>
  </transcript>`, 'xml');
  assert.equal(cues[0].text, 'Tom & Jerry "hi" \'ok\' 😀 \'  <3\nnext');
  assert.equal(cues[0].end, 3.235);
});

test('srv3 XML joins timed segments without inventing extra spaces', () => {
  const cues = parseCaptions(`<timedtext format="3"><head/><body>
    <p t='1250' d='2500'><s t='0'>Hello </s><s t='400'>世界</s><br/><s>line 2</s></p>
  </body></timedtext>`, 'xml');
  assert.deepEqual(cues, [{ id: 'cue-1', start: 1.25, end: 3.75, text: 'Hello 世界\nline 2' }]);
});

test('WebVTT handles BOM, identifiers, settings, metadata, styles and inline timestamps', () => {
  const raw = '﻿WEBVTT\r\nKind: captions\r\n\r\nNOTE ignored\r\nnot a cue\r\n\r\nSTYLE\r\n::cue { color:red }\r\n\r\nintro\r\n00:01.001 --> 00:02.250 align:start\r\n<v Alice><b>Hello</b> &amp; <00:01.500>world</v>\r\nsecond line\r\n\r\n02:03:04.005 --> 02:03:05.006\r\nLong video\r\n';
  const cues = parseCaptions(raw, 'vtt');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello & world\nsecond line');
  assert.equal(cues[1].start, 7384.005);
});

test('negative starts clamp to zero without shortening the supplied end', () => {
  const cues = parseCaptions('<transcript><text start="-0.5" dur="2">Opening</text></transcript>', 'xml');
  assert.equal(cues[0].start, 0);
  assert.equal(cues[0].end, 1.5);
});

test('parsers reject malformed, foreign, empty and timing-free captions', () => {
  const cases = [
    ['', 'json3'], ['{}', 'json3'], ['{"events":[', 'json3'], [json([]), 'json3'],
    [json([event(0, 1000, '   ')]), 'json3'], [json([event('bad', 1000, 'text')]), 'json3'],
    [json([event(0, 0, 'text')]), 'json3'], [json([event(0, -1000, 'text')]), 'json3'],
    ['<html>Sign in</html>', 'xml'], ['<transcript><text start="1" dur="2">broken</transcript>', 'xml'],
    ['<!DOCTYPE transcript [<!ENTITY x SYSTEM "file:///etc/passwd">]><transcript></transcript>', 'xml'],
    ['<transcript><text start="NaN" dur="2">x</text></transcript>', 'xml'],
    ['<transcript><text start="1" dur="0">x</text></transcript>', 'xml'],
    ['WEBVTT\n\n00:61.000 --> 00:62.000\nx', 'vtt'],
    ['WEBVTT\n\n00:02.000 --> 00:01.000\nx', 'vtt'], ['WEBVTT', 'vtt'], ['x', 'unknown'],
  ];
  for (const [raw, format] of cases) assert.throws(() => parseCaptions(raw, format), isCode('CAPTIONS_PARSE'), `${format}: ${raw}`);
});

test('identical XML cues deduplicate without removing nonidentical overlaps', () => {
  const cues = parseCaptions('<transcript><text start="0" dur="3">a</text><text start="0" dur="3">a</text><text start="1" dur="1">b</text></transcript>', 'xml');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].end, 3);
});

test('SRT export is bilingual, tag-free, multiline and supports 100+ hours', () => {
  const text = toSubtitleFile([{ id: 'a', start: 360000.1234, end: 360001.9996, text: '<b>Hello</b>\nworld', translated: '&lt;i&gt;你好&lt;/i&gt;\n世界' }], 'srt');
  assert.equal(text, '1\n100:00:00,123 --> 100:00:02,000\nHello\nworld\n你好\n世界\n');
});

test('WebVTT export escapes literal markup characters and round trips timings', () => {
  const cues = [{ id: 'a', start: 1.001, end: 3.999, text: 'A & B < 3', translated: '甲 & 乙 < 3' }];
  const text = toSubtitleFile(cues, 'vtt');
  assert.match(text, /^WEBVTT\n\n1\n00:00:01\.001 --> 00:00:03\.999\n/);
  assert.match(text, /A &amp; B &lt; 3/);
  const parsed = parseCaptions(text, 'vtt');
  assert.equal(parsed[0].start, 1.001);
  assert.equal(parsed[0].end, 3.999);
  assert.equal(parsed[0].text, 'A & B < 3\n甲 & 乙 < 3');
});

test('exports never fabricate empty or partial translation files', () => {
  for (const cues of [[], null, [{ start: 0, end: 1, translated: 'y' }], [{ start: 0, end: 1, text: 'x' }], [{ start: 0, end: 1, text: 'x', translated: ' ' }], [{ start: 0, end: 1, text: 'x', translated: '<b></b>' }]]) {
    assert.throws(() => toSubtitleFile(cues, 'srt'), isCode('INCOMPLETE'));
  }
  assert.throws(() => toSubtitleFile([{ start: -1, end: 1, text: 'x', translated: 'y' }], 'srt'), isCode('CAPTIONS_PARSE'));
});

test('active cue selection uses start-inclusive/end-exclusive boundaries and gaps', () => {
  const cues = [{ start: 1, end: 2 }, { start: 3, end: 4 }];
  for (const [time, expected] of [[0, -1], [1, 0], [1.999, 0], [2, -1], [3, 1], [4, -1], [-1, -1], [NaN, -1]]) {
    assert.equal(activeCueIndex(cues, time), expected);
  }
});

test('active cue segment index agrees with a reference scan for overlaps and seeks', () => {
  let seed = 13;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const cues = Array.from({ length: 1500 }, (_, index) => ({ start: index / 10, end: index / 10 + random() * 20 + 0.01 }));
  for (let i = 0; i < 500; i += 1) {
    const time = random() * 175;
    const expected = cues.findLastIndex((cue) => cue.start <= time && cue.end > time);
    assert.equal(activeCueIndex(cues, time), expected);
  }
  cues[1].translated = 'Does not invalidate timing index';
  assert.equal(activeCueIndex(cues, 0), 0);
});

// Browser contracts are tested in a minimal VM with mocked Chrome/page APIs.
// No model calls or YouTube network traffic occurs in this suite.
async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('Mock engine did not settle');
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = { contains: (name) => this.className.split(' ').includes(name) };
  }
  append(...children) {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  attachShadow() { this.shadowRoot = new MockElement('shadow'); return this.shadowRoot; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector.startsWith('.') ? child.className === selector.slice(1) : selector.includes(child.tagName)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  emit(type) { this.listeners.get(type)?.({ type }); }
}

function mockMedia(time = 1.5) {
  const player = new MockElement();
  const video = new MockElement('video');
  Object.assign(video, { currentTime: time, paused: false, ended: false, seeking: false, readyState: 4, duration: 100 });
  player.append(video);
  return { player, video };
}

function contentHarness({ stored = {}, events = [event(0, 1000, 'Hello')], tracks = [{ index: 0, languageCode: 'en', name: 'English', kind: '' }], translate, bridge, media, fastRetry = false } = {}) {
  const listeners = new Map();
  const timers = new Set();
  const requests = [];
  const translations = [];
  let runtimeListener;
  let storageListener;
  const location = { href: 'https://www.youtube.com/watch?v=video12345', origin: 'https://www.youtube.com' };
  const window = {
    addEventListener(type, listener) { const list = listeners.get(type) || []; list.push(listener); listeners.set(type, list); },
    postMessage(request) {
      requests.push(request);
      const data = request.type === 'GET_TRACKS'
        ? { videoId: request.videoId, title: '../Title: 演示', tracks }
        : { raw: json(events), format: 'json3', languageCode: tracks.find(t => t.index === request.trackIndex)?.languageCode || 'en' };
      const response = { source: 'CAPTIONBRIDGE_RESPONSE', requestId: request.requestId, videoId: request.videoId, ok: true, data };
      if (bridge) bridge(request, response, emit);
      else queueMicrotask(() => emit('message', { source: window, origin: location.origin, data: response }));
    },
  };
  function emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); }
  const chrome = {
    runtime: {
      id: 'test-extension', onMessage: { addListener(listener) { runtimeListener = listener; } },
      sendMessage(message) {
        translations.push(message);
        return translate ? translate(message) : Promise.resolve({ ok: true, data: {
          translations: message.payload.cues.map((cue) => ({ id: cue.id, text: `译 ${cue.text}` })), cached: 0,
        } });
      },
    },
    storage: {
      local: { get: (defaults) => Promise.resolve({ ...defaults, clientToken: 'local-test-token', ...stored }) },
      onChanged: { addListener(listener) { storageListener = listener; } },
    },
  };
  const context = {
    window, location, chrome, URL, crypto: webcrypto, AbortController,
    document: { getElementById: () => media?.player || null, addEventListener() {}, createElement: (tag) => new MockElement(tag) },
    setTimeout(callback, delay) { const id = setTimeout(() => { timers.delete(id); callback(); }, fastRetry && delay < 2000 ? 0 : delay); timers.add(id); return id; },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); }, setInterval: () => 0,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    activeCueIndex, parseCaptions, toSubtitleFile, attachDraggableOverlay, DEFAULT_POSITION,
  };
  const source = readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, '');
  vm.runInNewContext(source, context);
  function message(payload) {
    let result;
    runtimeListener(payload, { id: chrome.runtime.id }, (response) => { result = response; });
    return result;
  }
  return {
    requests, translations, emit, window, location,
    status: () => message({ type: 'GET_STATUS' }).data, message,
    change(changes) { storageListener(changes, 'local'); },
    close() { storageListener({ enabled: { newValue: false } }, 'local'); for (const id of timers) clearTimeout(id); },
  };
}

test('content engine requires configuration and respects disabled settings', async (t) => {
  for (const stored of [{ clientToken: '' }, { enabled: false }]) {
    const harness = contentHarness({ stored });
    t.after(() => harness.close());
    await new Promise(setImmediate);
    assert.equal(harness.requests.length, 0);
    assert.equal(harness.translations.length, 0);
    assert.equal(harness.status().state, stored.enabled === false ? 'disabled' : 'idle');
  }
});

test('content completes real batches, exports safe names and locale changes do not restart', async (t) => {
  const harness = contentHarness({ events: Array.from({ length: 45 }, (_, i) => event(i * 1000, 900, `Cue ${i}`)) });
  t.after(() => harness.close());
  await until(() => harness.status().state === 'ready');
  assert.equal(harness.status().completed, 45);
  assert.equal(harness.translations.length, 3);
  assert.ok(harness.translations.every((message) => message.payload.cues.length <= 20));
  const requestCount = harness.requests.length;
  harness.change({ locale: { newValue: 'en' } });
  assert.equal(harness.requests.length, requestCount);
  assert.equal(harness.status().state, 'ready');
  const file = harness.message({ type: 'DOWNLOAD', format: 'srt' });
  assert.equal(file.ok, true);
  assert.match(file.data.text, /译 Cue 44/);
  assert.ok(!/[<>:"/\\|?*]/.test(file.data.filename));
  assert.ok(!file.data.filename.startsWith('.'));
  assert.equal(harness.message({ type: 'SELECT_TRACK', index: -1 }).ok, true);
});

test('long captions split only in transport and preserve the original complete cue', async (t) => {
  const text = 'Hello 世界 😀 '.repeat(500);
  const harness = contentHarness({ events: [event(1234, 8765, text)] });
  t.after(() => harness.close());
  await until(() => harness.status().state === 'ready');
  const units = harness.translations.flatMap((message) => message.payload.cues);
  assert.ok(units.length > 1);
  assert.ok(units.every((cue) => cue.text.length <= 2000));
  assert.equal(harness.status().total, 1);
  assert.equal(harness.status().completed, 1);
  const exported = harness.message({ type: 'DOWNLOAD', format: 'srt' }).data.text;
  assert.match(exported, /00:00:01,234 --> 00:00:09,999/);
  assert.ok(exported.includes(text.trim()));
});

test('untranslated cues cannot export, and navigation invalidates a late worker response', async (t) => {
  const pending = [];
  const harness = contentHarness({ translate: (message) => new Promise((resolve) => pending.push({ message, resolve })) });
  t.after(() => harness.close());
  await until(() => pending.length === 1);
  assert.equal(harness.message({ type: 'DOWNLOAD', format: 'vtt' }).error.code, 'INCOMPLETE');
  harness.emit('yt-navigate-start');
  harness.location.href = 'https://www.youtube.com/watch?v=another1234';
  harness.emit('yt-navigate-finish');
  await until(() => pending.length === 2);
  pending[0].resolve({ ok: true, data: { translations: [{ id: 'cue-1', text: 'OLD RESULT' }] } });
  await new Promise(setImmediate);
  assert.equal(harness.status().completed, 0);
  assert.equal(harness.status().videoId, 'another1234');
  pending[1].resolve({ ok: true, data: { translations: [{ id: 'cue-1', text: 'NEW RESULT' }] } });
  await until(() => harness.status().state === 'ready');
  const file = harness.message({ type: 'DOWNLOAD', format: 'vtt' }).data.text;
  assert.ok(file.includes('NEW RESULT'));
  assert.ok(!file.includes('OLD RESULT'));
});

test('content passes API errors through and never claims fabricated translations', async (t) => {
  const harness = contentHarness({ translate: () => Promise.resolve({ ok: false, error: { code: 'INVALID_API_KEY' } }) });
  t.after(() => harness.close());
  await until(() => harness.status().state === 'error');
  assert.equal(harness.status().errorCode, 'INVALID_API_KEY');
  assert.equal(harness.status().completed, 0);
  assert.equal(harness.message({ type: 'DOWNLOAD', format: 'srt' }).error.code, 'INCOMPLETE');
});

test('missing translation results retry only three times and allow an explicit user retry', async (t) => {
  const harness = contentHarness({ fastRetry: true, translate: () => Promise.resolve({ ok: true, data: { translations: [], cached: 100 } }) });
  t.after(() => harness.close());
  await until(() => harness.status().state === 'error');
  assert.equal(harness.status().errorCode, 'INCOMPLETE');
  assert.equal(harness.status().completed, 0);
  assert.equal(harness.translations.length, 3);
  assert.equal(harness.message({ type: 'DOWNLOAD', format: 'vtt' }).error.code, 'INCOMPLETE');
  assert.equal(harness.message({ type: 'RETRY' }).ok, true);
  await until(() => harness.status().state === 'error');
  assert.equal(harness.translations.length, 6);
});

test('overlay stays visible when paused and clears on gaps, seeks and disable', async (t) => {
  const media = mockMedia();
  const harness = contentHarness({ media, events: [event(1000, 1000, '<script>not HTML</script>'), event(3000, 1000, 'Second cue')] });
  t.after(() => harness.close());
  await until(() => harness.status().state === 'ready');
  const host = media.player.children.find((child) => child.id === 'captionbridge-overlay');
  assert.ok(host);
  assert.equal(host.parentElement, media.player);
  assert.equal(host.hidden, false);
  const original = host.shadowRoot.querySelector('.original');
  assert.equal(original.textContent, '<script>not HTML</script>');
  assert.equal(original.getAttribute('aria-label'), '原文字幕');
  const calls = harness.translations.length;
  harness.change({ locale: { newValue: 'en' } });
  assert.equal(original.getAttribute('aria-label'), 'Original caption');
  assert.equal(harness.translations.length, calls);
  media.video.paused = true;
  media.video.emit('pause');
  assert.equal(host.hidden, false);
  assert.equal(original.textContent, '<script>not HTML</script>');
  harness.change({ subtitlePosition: { newValue: { x: 0.4, y: 0.3 } } });
  assert.equal(harness.translations.length, calls, 'Moving captions does not retranslate');
  media.video.paused = false;
  media.video.emit('play');
  assert.equal(host.hidden, false);
  media.video.currentTime = 2.5;
  media.video.emit('timeupdate');
  assert.equal(host.hidden, true);
  media.video.seeking = true;
  media.video.currentTime = 3.5;
  media.video.emit('seeking');
  assert.equal(host.hidden, true);
  media.video.seeking = false;
  media.video.emit('seeked');
  assert.equal(original.textContent, 'Second cue');
  media.video.playbackRate = 2;
  media.video.emit('ratechange');
  assert.equal(host.hidden, false);
  harness.change({ enabled: { newValue: false } });
  assert.equal(host.hidden, true);
  assert.equal(original.textContent, '');
});

test('seeking reprioritizes the next sequential translation batch', async (t) => {
  const media = mockMedia(40.2);
  const pending = [];
  const harness = contentHarness({
    media, events: Array.from({ length: 60 }, (_, i) => event(i * 1000, 900, `Cue ${i}`)),
    translate: (message) => new Promise((resolve) => pending.push({ message, resolve })),
  });
  t.after(() => harness.close());
  await until(() => pending.length === 1);
  assert.equal(pending[0].message.payload.cues[0].id, 'cue-41');
  media.video.currentTime = 5.2;
  media.video.emit('seeked');
  assert.equal(pending.length, 1);
  pending[0].resolve({ ok: true, data: { translations: pending[0].message.payload.cues.map(({ id }) => ({ id, text: 'Translated' })) } });
  await until(() => pending.length === 2);
  assert.equal(pending[1].message.payload.cues[0].id, 'cue-6');
});

function bridgeHarness(baseUrl = 'https://www.youtube.com/api/timedtext?v=video12345&lang=en', fetcher, nativeVideo = null) {
  const listeners = new Map();
  const responses = [];
  const calls = [];
  const timers = new Set();
  const location = { href: 'https://www.youtube.com/watch?v=video12345', origin: 'https://www.youtube.com' };
  const playerResponse = { videoDetails: { videoId: 'video12345', title: 'A video' }, captions: {
    playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl, languageCode: 'en', name: { simpleText: 'English' } }] },
  } };
  const window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { responses.push(message); },
    async fetch(url, options) {
      calls.push({ url, options });
      if (fetcher) return fetcher(url, options);
      const response = new Response(json([event(0, 1000, 'Real native caption')]));
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  };
  class XHR { open() {} addEventListener() {} }
  const context = {
    window, location, URL, XMLHttpRequest: XHR, AbortController, TextDecoder, parseCaptions,
    document: { getElementById: () => ({ getPlayerResponse: () => playerResponse }), querySelector: () => nativeVideo },
    setTimeout(callback, delay) { const id = setTimeout(() => { timers.delete(id); callback(); }, delay); timers.add(id); return id; },
    clearTimeout(id) { clearTimeout(id); timers.delete(id); },
  };
  vm.runInNewContext(readFileSync(new URL('../extension/src/page-bridge.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, ''), context);
  return {
    calls, responses, location, playerResponse,
    request(fields = {}) { listeners.get('message')({ source: window, origin: location.origin, data: {
      source: 'CAPTIONBRIDGE_REQUEST', requestId: `request-${responses.length}`, videoId: 'video12345', type: 'GET_CAPTIONS', trackIndex: 0, ...fields,
    } }); },
    close() { for (const timer of timers) clearTimeout(timer); },
  };
}

test('MAIN bridge fetches only the player URL, never an incoming URL or arbitrary origin', async (t) => {
  const harness = bridgeHarness();
  t.after(() => harness.close());
  harness.request({ url: 'https://attacker.example/private' });
  await until(() => harness.responses.length === 1);
  assert.equal(harness.responses[0].ok, true);
  assert.equal(harness.calls.length, 1);
  assert.equal(new URL(harness.calls[0].url).hostname, 'www.youtube.com');
  assert.equal(harness.calls[0].options.credentials, 'include');
  assert.equal(harness.calls[0].options.redirect, 'error');
  assert.equal(harness.responses[0].data.languageCode, 'en');
  const invalid = bridgeHarness('https://attacker.example/api/timedtext?v=video12345&lang=en');
  t.after(() => invalid.close());
  invalid.request();
  await until(() => invalid.responses.length === 1);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.responses[0].error.code, 'CAPTIONS_UNAVAILABLE');
});

test('automatic selection follows the active audio default, not alphabetic caption order', async (t) => {
  const harness = contentHarness({ tracks: [{ index: 0, languageCode: 'fr', name: 'French', kind: '' }, { index: 1, languageCode: 'en', name: 'English', kind: '', isDefault: true }] });
  t.after(() => harness.close());
  await until(() => harness.translations.length > 0);
  assert.equal(harness.requests.find(r => r.type === 'GET_CAPTIONS').trackIndex, 1);
  assert.equal(harness.translations[0].payload.sourceLanguage, 'en');
});

test('MAIN track metadata contains no signed URLs and rejects a changed video', async (t) => {
  const harness = bridgeHarness();
  t.after(() => harness.close());
  harness.request({ type: 'GET_TRACKS' });
  await until(() => harness.responses.length === 1);
  assert.equal(harness.responses[0].data.tracks[0].index, 0);
  assert.equal(harness.responses[0].data.tracks[0].url, undefined);
  assert.equal(harness.calls.length, 0);
  harness.location.href = 'https://www.youtube.com/watch?v=another1234';
  harness.request({ requestId: 'changed-video' });
  await until(() => harness.responses.length === 2);
  assert.equal(harness.responses[1].error.code, 'VIDEO_CHANGED');
});

test('MAIN native fallback requires a fully loaded track, not a partial TextTrack', async (t) => {
  const url = 'https://www.youtube.com/api/timedtext?v=video12345&lang=en';
  for (const readyState of [1, 2]) {
    const native = { duration: 20, querySelectorAll: () => [{
      readyState, src: url, srclang: 'en', label: 'English', track: {
        kind: 'captions', language: 'en', label: 'English', cues: [{ startTime: 1.25, endTime: 2.75, text: 'Native caption' }],
      },
    }] };
    const harness = bridgeHarness(url, async () => { throw new Error('Unavailable'); }, native);
    t.after(() => harness.close());
    harness.request();
    await until(() => harness.responses.length === 1);
    if (readyState === 1) assert.equal(harness.responses[0].error.code, 'CAPTIONS_UNAVAILABLE');
    else {
      assert.equal(harness.responses[0].ok, true);
      const data = harness.responses[0].data;
      assert.equal(parseCaptions(data.raw, data.format)[0].text, 'Native caption');
    }
  }
});

test('MAIN does not present live rolling captions as a full transcript', async (t) => {
  const harness = bridgeHarness();
  t.after(() => harness.close());
  harness.playerResponse.videoDetails.isLive = true;
  harness.request();
  await until(() => harness.responses.length === 1);
  assert.equal(harness.responses[0].error.code, 'CAPTIONS_UNAVAILABLE');
  assert.equal(harness.calls.length, 0);
});
