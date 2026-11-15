import { parseCaptions } from './subtitles.js';

// This bundle runs in MAIN at document_start. Everything on this channel is
// untrusted page data. No extension APIs, tokens or permission-bearing requests.
(() => {
  const marker = Symbol.for('CaptionBridge.main.v1');
  if (window[marker]) return;
  window[marker] = true;
  const MAX_RAW = 8 * 1024 * 1024;
  const originalFetch = window.fetch.bind(window);
  const cache = new Map();
  const inflight = new Set();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const failure = (code) => Object.assign(new Error(code), { code });

  function currentVideoId() {
    const url = new URL(location.href);
    const id = url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(url.pathname)?.[1];
    return typeof id === 'string' && /^[\w-]{6,64}$/.test(id) ? id : null;
  }

  function assertCurrent(videoId) {
    if (currentVideoId() !== videoId) throw failure('VIDEO_CHANGED');
  }

  function timedtextUrl(value, videoId) {
    try {
      const url = new URL(value, location.origin);
      return url.protocol === 'https:' && !url.username && !url.password
        && (!url.port || url.port === '443')
        && ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)
        && url.pathname === '/api/timedtext' && url.searchParams.get('v') === videoId
        ? url : null;
    } catch {
      return null;
    }
  }

  function playerResponse(videoId) {
    let player;
    try { player = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch { /* Player initializing. */ }
    const candidates = [player, window.ytInitialPlayerResponse];
    let matching = null;
    for (let candidate of candidates) {
      try {
        if (typeof candidate === 'string') candidate = JSON.parse(candidate);
        if (candidate?.videoDetails?.videoId !== videoId) continue;
        matching ??= candidate;
        if (candidate.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) return candidate;
      } catch { /* Page-owned values need not be valid. */ }
    }
    return matching;
  }

  function trackName(track) {
    const name = track.name?.simpleText ?? track.name?.runs?.map((run) => run.text || '').join('');
    return String(name || track.languageCode || '').slice(0, 200);
  }

  function isLive(response) {
    return response.videoDetails?.isLive === true
      || response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true;
  }

  function loadedNativeTracks(videoId, response) {
    // Dynamically-fed TextTracks can contain only the recent/live segment. They
    // must NOT masquerade as a complete transcript. Only a fully loaded <track>
    // resource belonging to this video qualifies for the native fallback.
    if (!response || isLive(response)) return [];
    const video = document.querySelector('#movie_player video');
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return [];
    return Array.from(video.querySelectorAll('track')).filter((element) => {
      const track = element.track;
      return element.readyState === 2 && timedtextUrl(element.src, videoId)
        && ['subtitles', 'captions'].includes(track?.kind)
        && track.cues?.length > 0 && track.cues.length <= 50000;
    }).map((element) => ({
      languageCode: element.srclang || element.track.language || '',
      name: element.label || element.track.label || element.srclang || '',
      kind: '', native: element.track,
    }));
  }

  function snapshot(videoId) {
    assertCurrent(videoId);
    const response = playerResponse(videoId);
    if (!response) return null;
    const rawTracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const tracks = Array.isArray(rawTracks) ? rawTracks.slice(0, 200).map((track) => ({
      languageCode: String(track.languageCode || '').slice(0, 40),
      name: trackName(track), kind: track.kind === 'asr' ? 'asr' : '',
      url: timedtextUrl(track.baseUrl, videoId),
    })) : [];
    if (!tracks.length) tracks.push(...loadedNativeTracks(videoId, response));
    return {
      videoId, title: String(response.videoDetails.title || '').slice(0, 500),
      tracks, response,
    };
  }

  async function getSnapshot(videoId) {
    let latest;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      latest = snapshot(videoId);
      if (latest?.tracks.length) return latest;
      if (attempt < 13) await wait(400);
    }
    assertCurrent(videoId);
    throw failure(latest ? 'NO_CAPTIONS' : 'CAPTIONS_UNAVAILABLE');
  }

  function detectFormat(raw) {
    const value = raw.trimStart();
    if (value.startsWith('{')) return 'json3';
    if (value.startsWith('WEBVTT')) return 'vtt';
    if (value.startsWith('<') && /<(?:transcript|timedtext)\b/.test(value)) return 'xml';
    throw failure('CAPTIONS_UNAVAILABLE');
  }

  function validCaption(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_RAW) throw failure('CAPTIONS_UNAVAILABLE');
    const format = detectFormat(raw);
    parseCaptions(raw, format);
    return { raw, format };
  }

  function sameTrack(first, second) {
    return ['v', 'lang', 'kind', 'name'].every((key) => (first.searchParams.get(key) || '') === (second.searchParams.get(key) || ''))
      && !first.searchParams.has('tlang') && !second.searchParams.has('tlang');
  }

  function observeCaption(urlValue, raw) {
    try {
      const videoId = currentVideoId();
      const url = timedtextUrl(urlValue, videoId);
      if (!url || ['sq', 'seg', 'begin', 'end', 'tlang'].some((key) => url.searchParams.has(key))) return;
      const state = snapshot(videoId);
      if (!state || isLive(state.response)) return;
      const track = state.tracks.find((entry) => entry.url && sameTrack(entry.url, url));
      if (!track) return;
      const data = validCaption(raw);
      const key = track.url.href;
      cache.delete(key);
      cache.set(key, { ...data, videoId, saved: Date.now() });
      while (cache.size > 4) cache.delete(cache.keys().next().value);
    } catch { /* Observing native playback must never change it. */ }
  }

  async function boundedText(response) {
    if (Number(response.headers.get('content-length')) > MAX_RAW) throw failure('CAPTIONS_UNAVAILABLE');
    if (!response.body) {
      const text = await response.text();
      if (text.length > MAX_RAW) throw failure('CAPTIONS_UNAVAILABLE');
      return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => {});
    }, 12000);
    try {
      while (true) {
        const result = await reader.read();
        if (expired) throw failure('CAPTIONS_UNAVAILABLE');
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > MAX_RAW) throw failure('CAPTIONS_UNAVAILABLE');
        text += decoder.decode(result.value, { stream: true });
      }
      return text + decoder.decode();
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }

  // Observe successful *native* caption requests, including current signed
  // parameters supplied by YouTube itself. Never fabricate clients/tokens or
  // retry player API calls. Our own fetches use originalFetch, so no recursion.
  window.fetch = function (...args) {
    const result = originalFetch(...args);
    try {
      const value = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      if (timedtextUrl(value, currentVideoId())) {
        void result.then(async (response) => {
          if (!response.ok || !timedtextUrl(response.url, currentVideoId())) return;
          const copy = response.clone();
          observeCaption(value, await boundedText(copy));
        }).catch(() => {});
      }
    } catch { /* Preserve native request behavior. */ }
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const xhrUrls = new WeakMap();
  const observedXhrs = new WeakSet();
  XMLHttpRequest.prototype.open = function (...args) {
    const result = originalOpen.apply(this, args);
    xhrUrls.set(this, typeof args[1] === 'string' || args[1] instanceof URL ? String(args[1]) : '');
    if (!observedXhrs.has(this)) {
      observedXhrs.add(this);
      this.addEventListener('load', () => {
        try {
          if (this.status >= 200 && this.status < 300 && (!this.responseType || this.responseType === 'text')
            && timedtextUrl(this.responseURL, currentVideoId())) observeCaption(xhrUrls.get(this), this.responseText);
        } catch { /* Native requests may use other response types. */ }
      });
    }
    return result;
  };

  function nativeCaption(track, videoId, state) {
    const native = track.native || loadedNativeTracks(videoId, state.response).find((entry) =>
      entry.languageCode === track.languageCode && (!entry.name || !track.name || entry.name === track.name))?.native;
    if (!native?.cues?.length) return null;
    const events = Array.from(native.cues).map((cue) => ({
      tStartMs: Math.round(cue.startTime * 1000),
      dDurationMs: Math.round((cue.endTime - cue.startTime) * 1000),
      segs: [{ utf8: typeof cue.getCueAsHTML === 'function' ? cue.getCueAsHTML().textContent : cue.text }],
    }));
    return validCaption(JSON.stringify({ events }));
  }

  async function captions(videoId, trackIndex) {
    const state = await getSnapshot(videoId);
    const track = state.tracks[trackIndex];
    if (!track) throw failure('NO_CAPTIONS');
    // A live rolling window is not a complete subtitle file.
    if (isLive(state.response)) throw failure('CAPTIONS_UNAVAILABLE');
    const cached = track.url && cache.get(track.url.href);
    if (cached?.videoId === videoId && Date.now() - cached.saved < 180000) {
      return { raw: cached.raw, format: cached.format, languageCode: track.languageCode };
    }
    let lastError = failure('CAPTIONS_UNAVAILABLE');
    if (track.url) {
      const jsonUrl = new URL(track.url.href);
      jsonUrl.searchParams.set('fmt', 'json3');
      const urls = [...new Set([jsonUrl.href, track.url.href])];
      const deadline = Date.now() + 12000;
      for (const url of urls) {
        assertCurrent(videoId);
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.min(7000, remaining));
        try {
          const response = await originalFetch(url, {
            credentials: 'include', signal: controller.signal, redirect: 'error',
          });
          if (!response.ok || !timedtextUrl(response.url, videoId)) throw failure('CAPTIONS_UNAVAILABLE');
          const data = validCaption(await boundedText(response));
          assertCurrent(videoId);
          return { ...data, languageCode: track.languageCode };
        } catch (error) {
          lastError = error?.code === 'CAPTIONS_PARSE' ? error : failure('CAPTIONS_UNAVAILABLE');
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    assertCurrent(videoId);
    const native = nativeCaption(track, videoId, state);
    if (native) return { ...native, languageCode: track.languageCode };
    throw lastError;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const request = event.data;
    if (!request || request.source !== 'CAPTIONBRIDGE_REQUEST'
      || !['GET_TRACKS', 'GET_CAPTIONS'].includes(request.type)
      || typeof request.requestId !== 'string' || request.requestId.length > 100
      || typeof request.videoId !== 'string' || !/^[\w-]{6,64}$/.test(request.videoId)) return;
    if (request.type === 'GET_CAPTIONS' && (!Number.isInteger(request.trackIndex) || request.trackIndex < 0 || request.trackIndex >= 200)) return;
    if (inflight.has(request.requestId) || inflight.size >= 4) return;
    inflight.add(request.requestId);
    void (async () => {
      let result;
      try {
        assertCurrent(request.videoId);
        let data;
        if (request.type === 'GET_TRACKS') {
          const state = await getSnapshot(request.videoId);
          const renderer = state.response.captions?.playerCaptionsTracklistRenderer;
          const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0];
          const defaultIndex = audio?.defaultCaptionTrackIndex ?? renderer?.defaultCaptionTrackIndex;
          data = {
            videoId: state.videoId, title: state.title,
            tracks: state.tracks.map((track, index) => ({
              index, languageCode: track.languageCode, name: track.name, kind: track.kind,
              isDefault: index === defaultIndex,
            })),
          };
        } else data = await captions(request.videoId, request.trackIndex);
        assertCurrent(request.videoId);
        result = { ok: true, data };
      } catch (error) {
        const code = ['VIDEO_CHANGED', 'NO_CAPTIONS', 'CAPTIONS_UNAVAILABLE', 'CAPTIONS_PARSE'].includes(error?.code)
          ? error.code : 'CAPTIONS_UNAVAILABLE';
        result = { ok: false, error: { code } };
      } finally {
        inflight.delete(request.requestId);
      }
      window.postMessage({
        source: 'CAPTIONBRIDGE_RESPONSE', requestId: request.requestId,
        videoId: request.videoId, ...result,
      }, location.origin);
    })();
  });
  window.addEventListener('yt-navigate-start', () => cache.clear());
})();
