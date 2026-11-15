import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_LIMITS, splitPageText, validatePageTranslations, installPageTranslator } from '../extension/src/page-translator.js';

const isCode = (code) => (error) => error.code === code;
const cues = [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'World' }];

test('page engine imports in Node without installing or reading a page', () => {
  assert.equal(installPageTranslator(), null);
  assert.equal(globalThis.__captionBridgePageV2, undefined);
  assert.equal(PAGE_LIMITS.batchEntries, 20);
  assert.equal(PAGE_LIMITS.batchChars, 6000);
});

test('installation is idempotent, passive, and ignores foreign runtime senders', () => {
  const listeners = [];
  const scope = {
    document: { get body() { assert.fail('Installation must not scan the page'); } },
    chrome: { runtime: { id: 'extension-id', onMessage: { addListener: (listener) => listeners.push(listener) } } },
    MutationObserver: class { observe() { assert.fail('Installation must not observe the page'); } },
  };
  const engine = installPageTranslator(scope);
  assert.equal(installPageTranslator(scope), engine);
  assert.equal(listeners.length, 1);
  for (const sender of [{}, { id: 'foreign' }]) {
    assert.equal(listeners[0]({ type: 'PAGE_START' }, sender, () => assert.fail('Foreign sender received a response')), false);
  }
  let response;
  listeners[0]({ type: 'PAGE_STATUS' }, { id: 'extension-id' }, (value) => { response = value; });
  assert.deepEqual(response, { ok: true, data: { state: 'idle', completed: 0, total: 0, mode: 'replace', targetLanguage: 'zh-Hans' } });
});

test('page splitting preserves every character, spacing, and surrogate pair', () => {
  const examples = ['', ' \n\tHello 世界!  ', 'x'.repeat(1999) + '😀' + 'z'.repeat(2200),
    'Mixed 中文 😀 words.\n'.repeat(700), '界'.repeat(6100), ' '.repeat(6100)];
  for (const source of examples) {
    const parts = splitPageText(source);
    assert.equal(parts.join(''), source);
    assert.ok(parts.every((part) => part.length > 0 && part.length <= 2000));
    assert.ok(parts.every((part) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part)));
  }
  assert.deepEqual(splitPageText('Hello world again', 12), ['Hello world ', 'again']);
  assert.deepEqual(splitPageText('a😀b', 2), ['a', '😀', 'b']);
});

test('split limits reject invalid inputs rather than truncating', () => {
  for (const source of [null, 123, {}, undefined]) assert.throws(() => splitPageText(source), isCode('INVALID_REQUEST'));
  for (const limit of [0, 1, -1, 1.5, 2001, Infinity]) assert.throws(() => splitPageText('text', limit), isCode('INVALID_REQUEST'));
});

test('partial response validates only real IDs and leaves missing parts incomplete', () => {
  const results = validatePageTranslations([{ id: 'b', text: ' 世界 ' }], cues);
  assert.equal(results.get('b'), '世界');
  assert.equal(results.has('a'), false);
  assert.equal(validatePageTranslations([], cues).size, 0);
  // Model HTML remains literal text; the DOM engine never parses it as markup.
  assert.equal(validatePageTranslations([{ id: 'a', text: '<img src=x onerror=alert(1)>' }], cues).get('a'), '<img src=x onerror=alert(1)>');
});

test('response validation rejects unknown, duplicated, empty, or excessive output', () => {
  for (const translations of [undefined, {}, [null], [{ id: 'foreign', text: 'x' }],
    [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }], [{ id: 1, text: 'x' }],
    [{ id: 'a', text: ' \n ' }], [{ id: 'a', text: 123 }], [{ id: 'a', text: 'x'.repeat(8001) }]]) {
    assert.throws(() => validatePageTranslations(translations, cues), isCode('MODEL_OUTPUT_INVALID'));
  }
  const reversed = validatePageTranslations([{ id: 'b', text: '二' }, { id: 'a', text: '一' }], cues);
  assert.equal(reversed.get('a'), '一');
  assert.equal(reversed.get('b'), '二');
});

test('transport validation enforces the per-cue, batch-entry, and batch-character caps', () => {
  const full = Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: 'x'.repeat(300) }));
  assert.equal(validatePageTranslations([], full).size, 0);
  for (const input of [[], [...full, { id: 'extra', text: 'x' }], [{ id: 'a', text: 'x'.repeat(2001) }],
    [{ id: 'a', text: ' ' }], [{ id: 'a', text: 'x' }, { id: 'a', text: 'x' }]]) {
    assert.throws(() => validatePageTranslations([], input), isCode('INVALID_REQUEST'));
  }
  assert.throws(() => validatePageTranslations([], full.map((cue) => ({ ...cue, text: 'x'.repeat(301) }))), isCode('REQUEST_TOO_LARGE'));
});
