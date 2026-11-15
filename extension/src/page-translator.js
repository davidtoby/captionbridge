// Bundled as an isolated-world IIFE; installing does not collect or translate text.
export const PAGE_LIMITS = Object.freeze({
  batchEntries: 20, batchChars: 6000, cueChars: 2000, outputChars: 8000,
  textNodes: 5000, sourceChars: 500000, translatedChars: 2000000,
  scanNodes: 50000, ancestorDepth: 128,
});
const TARGETS = new Set(['zh-Hans', 'zh-Hant', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi']);
const MARKER = 'data-captionbridge-page-v2';
const EXCLUDED = `script,style,textarea,input,select,option,pre,code,noscript,svg,math,canvas,iframe,object,embed,
  [contenteditable],[role="textbox"],[role="searchbox"],[role="combobox"],
  [hidden],[aria-hidden="true" i],[inert],[translate="no" i],.notranslate,#captionbridge-overlay,[${MARKER}]`;
const fail = (code) => Object.assign(new Error(code), { code });
const errorCode = (error) => /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code || '') ? error.code : 'SERVER_UNREACHABLE';
const retryable = (code) => /^(?:MODEL_RATE_LIMIT|RATE_LIMITED|SERVER_BUSY|MODEL_UNREACHABLE|SERVER_UNREACHABLE|MODEL_TIMEOUT|MODEL_OUTPUT_INCOMPLETE)$/.test(code);

// Lossless UTF-16-sized transport chunks, preferring word/sentence boundaries.
// Whitespace-only chunks are retained locally, never sent for translation.
export function splitPageText(text, limit = PAGE_LIMITS.cueChars) {
  if (typeof text !== 'string' || !Number.isInteger(limit) || limit < 2 || limit > PAGE_LIMITS.cueChars) throw fail('INVALID_REQUEST');
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      const minimum = start + Math.floor((end - start) / 2);
      for (let boundary = end; boundary > minimum; boundary--) {
        if (/[\s。！？.!?]/u.test(text[boundary - 1])) { end = boundary; break; }
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// Partial responses are allowed, but only genuine, uniquely identified results
// can complete a part. Missing parts stay pending; cached counts are not proof.
export function validatePageTranslations(translations, cues) {
  if (!Array.isArray(cues) || !cues.length || cues.length > PAGE_LIMITS.batchEntries) throw fail('INVALID_REQUEST');
  const ids = new Set();
  let size = 0;
  for (const cue of cues) {
    if (!cue || typeof cue.id !== 'string' || !cue.id || cue.id.length > 100 || ids.has(cue.id)
      || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > PAGE_LIMITS.cueChars) throw fail('INVALID_REQUEST');
    ids.add(cue.id); size += cue.text.length;
  }
  if (size > PAGE_LIMITS.batchChars) throw fail('REQUEST_TOO_LARGE');
  if (!Array.isArray(translations) || translations.length > cues.length) throw fail('MODEL_OUTPUT_INVALID');
  const results = new Map();
  for (const item of translations) {
    if (!item || typeof item.id !== 'string' || !ids.has(item.id) || results.has(item.id)
      || typeof item.text !== 'string' || !item.text.trim() || item.text.length > PAGE_LIMITS.outputChars) throw fail('MODEL_OUTPUT_INVALID');
    results.set(item.id, item.text.trim());
  }
  return results;
}

export function installPageTranslator(scope = globalThis) {
  if (scope.__captionBridgePageV2) return scope.__captionBridgePageV2;
  const { chrome, document: doc } = scope;
  if (!chrome?.runtime?.id || !doc) return null;
  const records = new Map();
  const owned = new WeakSet();
  const writes = new WeakMap();
  let active = false;
  let serial = 0;
  let sourceChars = 0;
  let translatedChars = 0;
  let epoch = 0;
  let controller = null;
  let job = null;
  let scanTimer = null;
  let scanStarted = 0;
  const status = { state: 'idle', completed: 0, total: 0, mode: 'replace', targetLanguage: 'zh-Hans' };
  const observer = new scope.MutationObserver(onMutations);
  const snapshot = () => ({ ...status });
  const alive = (token) => active && token === epoch && !controller?.signal.aborted && !status.errorCode;

  function count() {
    status.total = records.size;
    status.completed = 0;
    for (const record of records.values()) if (record.translation !== null) status.completed++;
  }
  function setError(code) {
    status.state = 'error'; status.errorCode = code; count();
  }
  function write(node, value) {
    if (node.data !== value) { writes.set(node, value); node.data = value; }
  }
  function removeSpan(record) {
    record.span?.remove(); record.span = null;
  }
  function discard(record, restore = false) {
    const node = record.node;
    if (!node) return;
    records.delete(node);
    if (restore && node.isConnected && node.length === record.expected.length && node.data === record.expected) write(node, record.original);
    writes.delete(node);
    removeSpan(record);
    sourceChars -= record.original.length;
    translatedChars -= record.outputSize;
    // An in-flight batch may still hold the record, but not a removed DOM tree.
    record.node = null; record.original = ''; record.expected = ''; record.parts = []; record.translation = null; record.outputSize = 0;
  }
  function prune() {
    for (const record of records.values()) if (!record.node.isConnected || record.node.getRootNode() !== doc) discard(record);
    count();
  }
  function ownNode(node) {
    return owned.has(node) || Boolean((node.nodeType === 1 ? node : node.parentElement)?.closest(`[${MARKER}]`));
  }
  function onMutations(mutations) {
    if (!active) return;
    if (mutations.length > PAGE_LIMITS.scanNodes) { prune(); setError('PAGE_TOO_LARGE'); return; }
    let dirty = false;
    let removed = false;
    for (const mutation of mutations) {
      if (ownNode(mutation.target)) continue;
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        if (writes.has(node) && writes.get(node).length === node.length && writes.get(node) === node.data) continue;
        writes.delete(node);
        const record = records.get(node);
        if (record && (node.length !== record.expected.length || node.data !== record.expected)) discard(record);
        dirty = true;
      } else if (mutation.type === 'childList') {
        let external = false;
        for (const nodes of [mutation.addedNodes, mutation.removedNodes]) {
          for (const node of nodes) if (!ownNode(node)) { external = true; break; }
        }
        dirty ||= external;
        removed ||= external && mutation.removedNodes.length > 0;
      } else dirty = true;
    }
    if (removed) prune();
    if (dirty) scheduleScan();
  }
  function observe() {
    observer.observe(doc.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'inert', 'translate', 'class', 'style', 'contenteditable', 'role', 'open'],
    });
  }
  function eligibleElement(element, cache) {
    if (!element || doc.designMode === 'on') return false;
    const chain = [];
    let allowed = true;
    for (let current = element; current; current = current.parentElement) {
      if (cache.has(current)) { allowed = cache.get(current); break; }
      if (chain.length >= PAGE_LIMITS.ancestorDepth) throw fail('PAGE_TOO_LARGE');
      chain.push(current);
      if (current.matches(EXCLUDED) || current.isContentEditable) { allowed = false; break; }
      const style = scope.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden' || style.opacity === '0') { allowed = false; break; }
    }
    for (const current of chain) cache.set(current, allowed);
    return allowed;
  }
  function eligibleText(node, cache) {
    if (!node?.isConnected || node.getRootNode() !== doc || !doc.body?.contains(node) || !eligibleElement(node.parentElement, cache)) return false;
    if (!records.has(node) && node.length > PAGE_LIMITS.sourceChars) throw fail('PAGE_TOO_LARGE');
    const range = doc.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) return true;
    return false;
  }
  function current(record, cache = new WeakMap()) {
    const node = record.node;
    if (!node) return false;
    if (node.length !== record.expected.length) { discard(record); scheduleScan(); return false; }
    if (!eligibleText(node, cache)) { discard(record, true); return false; }
    if (node.data !== record.expected) { discard(record); scheduleScan(); return false; }
    return true;
  }
  function present(record) {
    if (record.translation === null || !current(record)) return;
    if (status.mode === 'replace') {
      removeSpan(record);
      write(record.node, record.translation);
      record.expected = record.translation;
    } else {
      write(record.node, record.original);
      record.expected = record.original;
      if (!record.span) {
        record.span = doc.createElement('span'); owned.add(record.span);
        record.span.setAttribute(MARKER, 'translation');
        record.span.setAttribute('translate', 'no');
        record.span.style.whiteSpace = 'pre-wrap';
      }
      record.span.lang = status.targetLanguage;
      const text = ` ${record.translation}`;
      if (record.span.textContent !== text) record.span.textContent = text;
      if (record.node.nextSibling !== record.span) record.node.after(record.span);
    }
  }
  function scheduleScan(delay = 180) {
    if (!active || (status.state === 'error' && status.errorCode !== 'PAGE_NO_TEXT')) return;
    if (scanTimer === null) scanStarted = Date.now();
    else scope.clearTimeout(scanTimer);
    // Debounce bursts, but do not starve pages with continuous small updates.
    const wait = Math.min(delay, Math.max(0, 600 - (Date.now() - scanStarted)));
    scanTimer = scope.setTimeout(() => {
      scanTimer = null;
      try { scan(); } catch (error) { setError(errorCode(error)); }
    }, wait);
  }
  function scan() {
    if (!active || (status.errorCode && status.errorCode !== 'PAGE_NO_TEXT')) return;
    if (!doc.body) { prune(); setError('PAGE_NO_TEXT'); return; }
    const cache = new WeakMap();
    for (const record of records.values()) current(record, cache);
    let visited = 0;
    const walker = doc.createTreeWalker(doc.body, 1 | 4, {
      acceptNode(node) {
        if (++visited > PAGE_LIMITS.scanNodes) throw fail('PAGE_TOO_LARGE');
        return node.nodeType === 1 && !eligibleElement(node, cache) ? 2 : 1;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType !== 3 || records.has(node) || !eligibleText(node, cache)) continue;
      if (node.length > PAGE_LIMITS.sourceChars) throw fail('PAGE_TOO_LARGE');
      const original = node.data;
      if (!original.trim()) continue;
      if (records.size >= PAGE_LIMITS.textNodes || sourceChars + original.length > PAGE_LIMITS.sourceChars) throw fail('PAGE_TOO_LARGE');
      const id = `page-${++serial}`;
      records.set(node, {
        node, original, expected: original, span: null, translation: null, outputSize: 0,
        parts: splitPageText(original).map((source, index) => ({ id: `${id}-${index}`, source, text: source.trim(), result: null })),
      });
      sourceChars += original.length;
    }
    count();
    if (status.errorCode === 'PAGE_NO_TEXT' && records.size) delete status.errorCode;
    if (!status.errorCode) kick();
  }
  function selectBatch() {
    const units = [];
    const cache = new WeakMap();
    let chars = 0;
    for (const record of records.values()) {
      if (record.translation !== null || !current(record, cache)) continue;
      for (const part of record.parts) {
        if (!part.text || part.result !== null) continue;
        if (units.length === PAGE_LIMITS.batchEntries || chars + part.text.length > PAGE_LIMITS.batchChars) return units;
        units.push({ record, part }); chars += part.text.length;
      }
    }
    return units;
  }
  function pending(units) {
    const cache = new WeakMap();
    return units.filter(({ record, part }) => part.result === null && current(record, cache));
  }
  function complete(record) {
    if (record.parts.some((part) => part.text && part.result === null)) return;
    record.translation = record.parts.map((part) => part.text
      ? part.source.match(/^\s*/u)[0] + part.result + part.source.match(/\s*$/u)[0]
      : part.source).join('');
    present(record);
  }
  // Cancels the local wait only. Chrome messaging cannot abort a model request
  // already accepted by the background; the epoch gate forbids applying it.
  function waitFor(promise, signal, timeout) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => { scope.clearTimeout(timer); signal.removeEventListener('abort', cancel); fn(value); };
      const cancel = () => finish(reject, fail('CANCELLED'));
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      if (timeout) timer = scope.setTimeout(() => finish(reject, fail('MODEL_TIMEOUT')), timeout);
      promise.then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  }
  async function translateBatch(units, token, signal) {
    for (let attempt = 0; attempt < 3 && alive(token); attempt++) {
      units = pending(units);
      if (!units.length) return;
      try {
        const cues = units.map(({ part }) => ({ id: part.id, text: part.text }));
        const response = await waitFor(Promise.resolve().then(() => {
          if (!alive(token)) throw fail('CANCELLED');
          return chrome.runtime.sendMessage({ type: 'PAGE_TRANSLATE', payload: { sourceLanguage: 'auto', targetLanguage: status.targetLanguage, cues } });
        }), signal, 115000);
        if (!alive(token)) return;
        if (!response?.ok) throw fail(errorCode(response?.error));
        const results = validatePageTranslations(response.data?.translations, cues);
        const cache = new WeakMap();
        for (const { record, part } of units) {
          if (!results.has(part.id) || !current(record, cache)) continue;
          const text = results.get(part.id);
          if (translatedChars + text.length > PAGE_LIMITS.translatedChars) throw fail('PAGE_TOO_LARGE');
          part.result = text; record.outputSize += text.length; translatedChars += text.length;
          complete(record);
        }
        count();
        units = pending(units);
        if (!units.length) return;
        throw fail('MODEL_OUTPUT_INCOMPLETE');
      } catch (error) {
        if (!alive(token)) return;
        if (attempt === 2 || !retryable(errorCode(error))) throw error;
        await new Promise((resolve) => {
          const finish = () => { scope.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
          const timer = scope.setTimeout(finish, 600 * 2 ** attempt);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    }
  }
  function kick() {
    if (!active || status.errorCode || job) return;
    const token = epoch;
    const signal = controller.signal;
    status.state = 'translating';
    job = token;
    (async () => {
      while (alive(token) && !status.errorCode) {
        const units = selectBatch();
        if (!units.length) break;
        await translateBatch(units, token, signal);
      }
      if (!alive(token) || status.errorCode) return;
      count();
      if (scanTimer !== null) return;
      if (!status.total) setError('PAGE_NO_TEXT');
      else status.state = status.completed === status.total ? 'ready' : 'translating';
    })().catch((error) => { if (alive(token)) setError(errorCode(error)); }).finally(() => {
      if (job === token) job = null;
    });
  }
  function cancel() {
    active = false; epoch++; controller?.abort(); controller = null; job = null;
    scope.clearTimeout(scanTimer); scanTimer = null; observer.disconnect();
  }
  function restore() {
    cancel();
    for (const record of records.values()) discard(record, true);
    status.state = 'idle'; delete status.errorCode; count();
  }
  function mode(value) {
    if (!['replace', 'bilingual'].includes(value)) throw fail('INVALID_REQUEST');
    status.mode = value;
    for (const record of records.values()) present(record);
    count();
  }
  function start(message) {
    if (!TARGETS.has(message.targetLanguage)) throw fail('INVALID_LANGUAGE');
    if (!['replace', 'bilingual'].includes(message.mode)) throw fail('INVALID_REQUEST');
    if (!/^https?:$/.test(scope.location?.protocol) || scope.top !== scope.self
      || !doc.body || !['text/html', 'application/xhtml+xml'].includes(doc.contentType)) {
      cancel(); setError('PAGE_UNSUPPORTED'); return;
    }
    if (active && status.targetLanguage === message.targetLanguage && !status.errorCode) {
      mode(message.mode); return;
    }
    cancel();
    if (status.targetLanguage !== message.targetLanguage) for (const record of records.values()) discard(record, true);
    status.targetLanguage = message.targetLanguage;
    status.state = 'translating'; delete status.errorCode;
    active = true; controller = new scope.AbortController();
    mode(message.mode); observe(); scheduleScan(0);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id || !['PAGE_START', 'PAGE_STATUS', 'PAGE_RESTORE', 'PAGE_MODE'].includes(message?.type)) return false;
    try {
      if (message.type === 'PAGE_START') start(message);
      else if (message.type === 'PAGE_RESTORE') restore();
      else if (message.type === 'PAGE_MODE') mode(message.mode);
      else prune();
      sendResponse({ ok: true, data: snapshot() });
    } catch (error) { sendResponse({ ok: false, error: { code: errorCode(error) } }); }
    return false;
  });
  const api = Object.freeze({ status: snapshot });
  scope.__captionBridgePageV2 = api;
  return api;
}

if (typeof chrome !== 'undefined' && typeof document !== 'undefined') installPageTranslator();
