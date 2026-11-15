import { activeCueIndex, parseCaptions, toSubtitleFile } from './subtitles.js';

const DEFAULTS = {
  enabled: true, targetLanguage: 'zh-Hans', sourceLanguage: 'auto', locale: 'zh-CN',
  serverUrl: 'http://127.0.0.1:8787', clientToken: '',
};
const LABELS = {
  en: {
    captions: 'Original and translated captions', original: 'Original caption', translated: 'Translated caption',
    translating: 'Translating', unavailable: 'Translation unavailable',
  },
  zh: {
    captions: '原文与翻译字幕', original: '原文字幕', translated: '翻译字幕',
    translating: '正在翻译', unavailable: '翻译暂不可用',
  },
};
const BATCH_SIZE = 20;
const BATCH_CHARS = 6000;
let settings = { ...DEFAULTS };
let initialized = false;
const earlySettings = {};
let generation = 0;
let controller = new AbortController();
let cues = [];
let preferredTrack = null;
let status = emptyStatus(null, 'idle');
let video = null;
let player = null;
let host = null;
let originalLine;
let translatedLine;
let progressLine;
let frame = 0;
let lastFrame = 0;
let rendered = '';
let navigating = false;
let navigationTimer = 0;
const bridgeRequests = new Map();

function emptyStatus(videoId, state) {
  return { videoId, title: '', state, total: 0, completed: 0, tracks: [], selectedTrack: null };
}

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function errorCode(error, fallback = 'SERVER_UNREACHABLE') {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code) ? error.code : fallback;
}

function currentVideoId() {
  const url = new URL(location.href);
  const id = url.pathname === '/watch' ? url.searchParams.get('v')
    : /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[1];
  return typeof id === 'string' && /^[\w-]{6,64}$/.test(id) ? id : null;
}

function assertJob(job) {
  if (job.generation !== generation || job.signal.aborted || currentVideoId() !== job.videoId) throw fail('VIDEO_CHANGED');
}

function invalidate() {
  generation += 1;
  controller.abort();
  controller = new AbortController();
  for (const request of bridgeRequests.values()) request.reject(fail('VIDEO_CHANGED'));
  bridgeRequests.clear();
  cues = [];
  cancelAnimationFrame(frame);
  frame = 0;
  clearOverlay();
}

function requestBridge(type, job, trackIndex) {
  assertJob(job);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, fail('BRIDGE_TIMEOUT')), 22000);
    function finish(callback, result) {
      clearTimeout(timer);
      bridgeRequests.delete(requestId);
      callback(result);
    }
    bridgeRequests.set(requestId, {
      videoId: job.videoId, generation: job.generation,
      resolve: (data) => finish(resolve, data), reject: (error) => finish(reject, error),
    });
    window.postMessage({
      source: 'CAPTIONBRIDGE_REQUEST', type, requestId, videoId: job.videoId,
      ...(trackIndex === undefined ? {} : { trackIndex }),
    }, location.origin);
  });
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const response = event.data;
  if (!response || response.source !== 'CAPTIONBRIDGE_RESPONSE' || typeof response.requestId !== 'string') return;
  const request = bridgeRequests.get(response.requestId);
  if (!request || request.videoId !== response.videoId) return;
  if (request.generation !== generation || currentVideoId() !== request.videoId) {
    request.reject(fail('VIDEO_CHANGED'));
  } else if (response.ok === true) request.resolve(response.data);
  else request.reject(fail(errorCode(response.error, 'CAPTIONS_UNAVAILABLE')));
});

function pauseFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(fail('VIDEO_CHANGED')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
    function aborted() {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      reject(fail('VIDEO_CHANGED'));
    }
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function translateRequest(payload, job) {
  assertJob(job);
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(reject, fail('SERVER_UNREACHABLE')), 115000);
    const aborted = () => finish(reject, fail('VIDEO_CHANGED'));
    function finish(callback, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      job.signal.removeEventListener('abort', aborted);
      callback(value);
    }
    job.signal.addEventListener('abort', aborted, { once: true });
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: 'TRANSLATE', payload })).then((response) => {
        try { assertJob(job); } catch (error) { finish(reject, error); return; }
        if (response?.ok === true) finish(resolve, response.data);
        else finish(reject, fail(errorCode(response?.error)));
      }, () => finish(reject, fail('SERVER_UNREACHABLE')));
    } catch {
      finish(reject, fail('SERVER_UNREACHABLE'));
    }
  });
}

function readTracks(data, videoId) {
  if (!data || data.videoId !== videoId || typeof data.title !== 'string'
    || !Array.isArray(data.tracks) || data.tracks.length > 200) throw fail('CAPTIONS_UNAVAILABLE');
  const indexes = new Set();
  const tracks = data.tracks.map((track) => {
    if (!track || !Number.isInteger(track.index) || track.index < 0 || track.index >= 200
      || indexes.has(track.index) || typeof track.languageCode !== 'string'
      || !/^[\w-]{1,40}$/.test(track.languageCode) || typeof track.name !== 'string') throw fail('CAPTIONS_UNAVAILABLE');
    indexes.add(track.index);
    return {
      index: track.index, languageCode: track.languageCode,
      name: track.name.slice(0, 200), kind: track.kind === 'asr' ? 'asr' : '', isDefault: track.isDefault === true,
    };
  });
  if (!tracks.length) throw fail('NO_CAPTIONS');
  return { title: data.title.slice(0, 500), tracks };
}

function chooseTrack(tracks) {
  const selected = tracks.find((track) => track.index === preferredTrack);
  if (selected) return selected;
  if (settings.sourceLanguage !== 'auto') {
    const desired = settings.sourceLanguage.toLowerCase();
    const matching = tracks.find((track) => track.languageCode.toLowerCase() === desired)
      || tracks.find((track) => track.languageCode.toLowerCase().split('-')[0] === desired.split('-')[0]);
    if (matching) return matching;
  }
  return tracks.find((track) => track.isDefault) || tracks.find((track) => track.kind !== 'asr') || tracks[0];
}

function translationUnits() {
  const units = [];
  const parts = new Map();
  for (const cue of cues) {
    const chunks = [];
    let text = cue.text;
    while (text.length > 2000) {
      let end = 1900;
      const boundary = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf(' ', end));
      if (boundary > 950) end = boundary + 1;
      // Do not split a UTF-16 surrogate pair at a hard boundary.
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      chunks.push(text.slice(0, end));
      text = text.slice(end);
    }
    if (text.trim()) chunks.push(text);
    const cueUnits = chunks.filter((chunk) => chunk.trim()).map((chunk, index) => ({
      id: chunks.length === 1 ? cue.id : `${cue.id}-part-${index + 1}`,
      text: chunk, start: cue.start, owner: cue,
    }));
    parts.set(cue.id, cueUnits);
    units.push(...cueUnits);
  }
  return { units, parts };
}

function batchAtPlayback(remaining, units) {
  const time = video?.currentTime || 0;
  const active = activeCueIndex(cues, time);
  const desired = active >= 0 ? cues[active].start : time;
  let low = 0;
  let high = remaining.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (units[remaining[mid]].start < desired) low = mid + 1;
    else high = mid;
  }
  // The queue is kept sorted. Each new batch re-evaluates playback time, so a
  // seek prioritizes the new location after at most one in-flight batch.
  const start = low < remaining.length ? low : 0;
  const batch = [];
  let length = 0;
  for (let i = start; i < remaining.length && batch.length < BATCH_SIZE; i += 1) {
    const cue = units[remaining[i]];
    if (batch.length && length + cue.text.length > BATCH_CHARS) break;
    batch.push(cue);
    length += cue.text.length;
  }
  return batch;
}

function retryable(code) {
  return code === 'INCOMPLETE' || /UNREACHABLE|TIMEOUT|RATE_LIMIT|BUSY|UPSTREAM_ERROR|TRANSLATION_FAILED/.test(code);
}

async function translateAll(job) {
  // Long caption text is split only for transport. Original cue boundaries and
  // timestamps stay intact, and completion requires every real translated part.
  const { units, parts } = translationUnits();
  let remaining = units.map((_, index) => index);
  status.state = 'translating';
  renderOverlay();
  while (remaining.length) {
    assertJob(job);
    let batch = batchAtPlayback(remaining, units);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const data = await translateRequest({
          sourceLanguage: status.tracks.find((track) => track.index === status.selectedTrack)?.languageCode || settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          cues: batch.map(({ id, text }) => ({ id, text })),
        }, job);
        assertJob(job);
        if (!Array.isArray(data?.translations) || data.translations.length > BATCH_SIZE) throw fail('INCOMPLETE');
        const supplied = new Map();
        for (const result of data.translations) {
          if (typeof result?.id !== 'string' || typeof result.text !== 'string'
            || !result.text.trim() || result.text.length > 16000 || supplied.has(result.id)
            || !batch.some((cue) => cue.id === result.id)) throw fail('INCOMPLETE');
          supplied.set(result.id, result.text.trim());
        }
        // Only genuine, nonempty server results count toward completion.
        for (const unit of batch) {
          if (!unit.translated && supplied.has(unit.id)) unit.translated = supplied.get(unit.id);
        }
        for (const unit of batch) {
          const siblings = parts.get(unit.owner.id);
          if (!unit.owner.translated && siblings.every((part) => part.translated)) {
            unit.owner.translated = siblings.map((part) => part.translated).join('\n');
            status.completed += 1;
          }
        }
        renderOverlay();
        batch = batch.filter((cue) => !cue.translated);
        if (batch.length) throw fail('INCOMPLETE');
        break;
      } catch (error) {
        assertJob(job);
        if (attempt === 2 || !retryable(errorCode(error))) throw error;
        await pauseFor(800 * (2 ** attempt), job.signal);
      }
    }
    remaining = remaining.filter((index) => !units[index].translated);
  }
  assertJob(job);
  status.state = 'ready';
  delete status.errorCode;
  renderOverlay();
}

async function run(job) {
  try {
    // The bridge itself waits for the SPA player. Retry once if the document_start
    // registration raced with our first postMessage, not indefinitely.
    let metadata;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { metadata = await requestBridge('GET_TRACKS', job); break; }
      catch (error) {
        assertJob(job);
        if (attempt || !['BRIDGE_TIMEOUT', 'CAPTIONS_UNAVAILABLE'].includes(error?.code)) throw error;
        await pauseFor(500, job.signal);
      }
    }
    assertJob(job);
    const parsed = readTracks(metadata, job.videoId);
    status.title = parsed.title;
    status.tracks = parsed.tracks;
    const track = chooseTrack(parsed.tracks);
    status.selectedTrack = track.index;
    preferredTrack = track.index;
    updateLabels();
    const data = await requestBridge('GET_CAPTIONS', job, track.index);
    assertJob(job);
    if (!data || typeof data.raw !== 'string' || !['json3', 'xml', 'vtt'].includes(data.format)
      || data.languageCode !== track.languageCode) throw fail('CAPTIONS_UNAVAILABLE');
    cues = parseCaptions(data.raw, data.format);
    status.total = cues.length;
    bindVideo();
    await translateAll(job);
  } catch (error) {
    if (job.generation !== generation || job.signal.aborted || currentVideoId() !== job.videoId) return;
    status.state = 'error';
    status.errorCode = errorCode(error, 'CAPTIONS_UNAVAILABLE');
    renderOverlay();
  }
}

function restart({ resetTrack = false } = {}) {
  if (!initialized) return;
  const videoId = currentVideoId();
  if (videoId !== status.videoId || resetTrack) preferredTrack = null;
  invalidate();
  status = emptyStatus(videoId, settings.enabled ? 'idle' : 'disabled');
  bindVideo();
  if (!settings.enabled) return;
  if (!videoId) { status.errorCode = 'NO_VIDEO'; return; }
  if (typeof settings.clientToken !== 'string' || !settings.clientToken.trim()) return;
  status.state = 'loading';
  const job = { generation, videoId, signal: controller.signal };
  void run(job);
}

function labels() {
  return String(settings.locale).toLowerCase().startsWith('zh') ? LABELS.zh : LABELS.en;
}

function createOverlay() {
  if (!player || host?.parentElement === player) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'captionbridge-overlay';
    host.hidden = true;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { position:absolute; bottom:12%; inset-inline:4%; z-index:2147480000;
        display:flex; justify-content:center; pointer-events:none; color:white;
        font:500 clamp(14px, 1.7vw, 25px)/1.4 system-ui, sans-serif; text-align:center; }
      :host([hidden]) { display:none !important; }
      .box { max-width:100%; max-height:35vh; overflow:hidden; box-sizing:border-box;
        padding:8px 14px; border-radius:7px; background:rgba(10,15,24,.86);
        text-shadow:0 1px 2px #000; overflow-wrap:anywhere; white-space:pre-line; }
      .original { font-size:.82em; color:#e0e5ed; }
      .translated { color:#fff; }
      .progress { font-size:12px; color:#c8d9f6; margin-top:3px; }
      [hidden] { display:none !important; }
      @media (max-width:480px) { .box { padding:6px 9px; } :host { inset-inline:3%; font-size:15px; } }
    `;
    const box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-live', 'off');
    originalLine = document.createElement('div');
    originalLine.className = 'original';
    translatedLine = document.createElement('div');
    translatedLine.className = 'translated';
    progressLine = document.createElement('div');
    progressLine.className = 'progress';
    box.append(originalLine, translatedLine, progressLine);
    shadow.append(style, box);
  }
  if (host.parentElement !== player) player.append(host);
  updateLabels();
}

function updateLabels() {
  if (!host) return;
  const text = labels();
  host.lang = String(settings.locale || 'en');
  host.shadowRoot.querySelector('.box').setAttribute('aria-label', text.captions);
  originalLine.setAttribute('aria-label', text.original);
  translatedLine.setAttribute('aria-label', text.translated);
  originalLine.lang = status.tracks.find((track) => track.index === status.selectedTrack)?.languageCode || '';
  translatedLine.lang = String(settings.targetLanguage || '');
}

function clearOverlay() {
  if (host) {
    host.hidden = true;
    originalLine.textContent = '';
    translatedLine.textContent = '';
    progressLine.textContent = '';
  }
  rendered = '';
}

function renderOverlay() {
  if (!settings.enabled || navigating || currentVideoId() !== status.videoId || !video
    || video.paused || video.ended || video.seeking || video.readyState < 2
    || player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting')) {
    clearOverlay();
    return;
  }
  const index = activeCueIndex(cues, video.currentTime);
  if (index < 0) { clearOverlay(); return; }
  createOverlay();
  if (!host) return;
  const cue = cues[index];
  const text = labels();
  const progress = status.state === 'translating'
    ? `${text.translating} · ${status.completed}/${status.total}`
    : (!cue.translated ? text.unavailable : '');
  const key = JSON.stringify([index, cue.translated, progress, settings.locale]);
  if (key !== rendered) {
    originalLine.textContent = cue.text;
    translatedLine.textContent = cue.translated || '';
    translatedLine.hidden = !cue.translated;
    progressLine.textContent = progress;
    progressLine.hidden = !progress;
    rendered = key;
  }
  host.hidden = false;
}

function animationTick(now) {
  frame = 0;
  if (!settings.enabled || !cues.length || !video || video.paused || video.ended) { clearOverlay(); return; }
  if (now - lastFrame >= 80) {
    lastFrame = now;
    renderOverlay();
  }
  frame = requestAnimationFrame(animationTick);
}

function onVideoEvent(event) {
  if (['pause', 'ended', 'emptied', 'seeking'].includes(event.type)) clearOverlay();
  else renderOverlay();
  if (settings.enabled && cues.length && video && !video.paused && !video.ended && !frame) frame = requestAnimationFrame(animationTick);
  if (video?.paused || video?.ended) { cancelAnimationFrame(frame); frame = 0; }
}

const VIDEO_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'seeking', 'seeked', 'timeupdate', 'ratechange', 'loadedmetadata'];
function bindVideo() {
  const nextPlayer = document.getElementById('movie_player');
  const nextVideo = nextPlayer?.querySelector('video.html5-main-video, video') || null;
  if (nextPlayer !== player) {
    clearOverlay();
    host?.remove();
    player = nextPlayer;
  }
  if (nextVideo !== video) {
    for (const event of VIDEO_EVENTS) video?.removeEventListener(event, onVideoEvent);
    cancelAnimationFrame(frame);
    frame = 0;
    clearOverlay();
    video = nextVideo;
    for (const event of VIDEO_EVENTS) video?.addEventListener(event, onVideoEvent);
  }
  if (settings.enabled && cues.length && video && !video.paused && !video.ended && !frame) frame = requestAnimationFrame(animationTick);
}

function checkNavigation() {
  if (!initialized || navigating) return;
  if (currentVideoId() !== status.videoId) restart();
  else bindVideo();
}

window.addEventListener('yt-navigate-start', () => {
  navigating = true;
  invalidate();
  status = emptyStatus(currentVideoId(), settings.enabled ? 'idle' : 'disabled');
  clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => {
    navigating = false;
    restart({ resetTrack: true });
  }, 1800);
});
window.addEventListener('yt-navigate-finish', () => {
  navigating = false;
  clearTimeout(navigationTimer);
  restart({ resetTrack: true });
});
window.addEventListener('popstate', checkNavigation);
window.addEventListener('yt-player-updated', checkNavigation);
document.addEventListener('DOMContentLoaded', checkNavigation, { once: true });
// A low-frequency fallback catches history/DOM replacements without patching
// page history or observing every mutation on a busy YouTube page.
setInterval(checkNavigation, 750);

function safeFilename(format) {
  let base = String(status.title || status.videoId || 'captions').normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '_')
    .replace(/\s+/g, ' ').replace(/^\.+|[. ]+$/g, '');
  let bytes = 0;
  base = Array.from(base).slice(0, 90).filter((character) => {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    return bytes <= 140;
  }).join('').replace(/[. ]+$/g, '') || 'captions';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  const language = String(settings.targetLanguage).replace(/[^\w-]/g, '_').slice(0, 30);
  return `${base}_${status.videoId}_${language}.${format}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;
  if (!['GET_STATUS', 'RETRY', 'SELECT_TRACK', 'DOWNLOAD'].includes(message.type)) return false;
  checkNavigation();
  try {
    if (message.type === 'GET_STATUS') {
      sendResponse({ ok: true, data: { ...status, tracks: status.tracks.map((track) => ({ ...track })) } });
    } else if (message.type === 'RETRY' || message.type === 'SELECT_TRACK') {
      if (!currentVideoId()) throw fail('NO_VIDEO');
      if (message.type === 'SELECT_TRACK') {
        if (!Number.isInteger(message.index)
          || (message.index !== -1 && !status.tracks.some((track) => track.index === message.index))) throw fail('NO_CAPTIONS');
        preferredTrack = message.index === -1 ? null : message.index;
      }
      restart();
      sendResponse({ ok: true, data: { ...status } });
    } else {
      if (currentVideoId() !== status.videoId || navigating) throw fail('VIDEO_CHANGED');
      if (!cues.length || status.completed !== cues.length) throw fail('INCOMPLETE');
      const text = toSubtitleFile(cues, message.format);
      sendResponse({ ok: true, data: {
        text, filename: safeFilename(message.format),
        mime: message.format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8',
      } });
    }
  } catch (error) {
    sendResponse({ ok: false, error: { code: errorCode(error, 'CAPTIONS_UNAVAILABLE') } });
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(DEFAULTS).filter((key) => Object.hasOwn(changes, key));
  if (!keys.length) return;
  for (const key of keys) {
    settings[key] = changes[key].newValue ?? DEFAULTS[key];
    if (!initialized) earlySettings[key] = settings[key];
  }
  if (!initialized) return;
  if (keys.some((key) => key !== 'locale')) restart({ resetTrack: keys.includes('sourceLanguage') });
  else {
    // Locale is purely presentational: never discard timings, progress or a
    // pending translation when the user switches the app-wide language.
    rendered = '';
    updateLabels();
    renderOverlay();
  }
});

void chrome.storage.local.get(DEFAULTS).then((stored) => {
  settings = { ...DEFAULTS, ...stored, ...earlySettings };
  initialized = true;
  restart();
}).catch(() => {
  initialized = true;
  status = { ...emptyStatus(currentVideoId(), 'error'), errorCode: 'SERVER_UNREACHABLE' };
});
