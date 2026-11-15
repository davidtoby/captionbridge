// Dependency-free caption parsing. Parsed cue timing/order is immutable; translation may
// add a `translated` property without invalidating the playback index below.
const MAX_RAW_LENGTH = 8 * 1024 * 1024;
const MAX_CUES = 50000;
const indexes = new WeakMap();
const entities = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', lrm: '', rlm: '',
};

function fail(code = 'CAPTIONS_PARSE') {
  throw Object.assign(new Error(code), { code });
}

function decodeEntities(value) {
  let result = String(value);
  for (let pass = 0; pass < 2; pass += 1) {
    result = result.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, name) => {
      if (name[0] !== '#') return entities[name.toLowerCase()] ?? match;
      const hex = name[1].toLowerCase() === 'x';
      const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '�';
    });
  }
  return result;
}

function cleanText(value, markup = false) {
  let text = String(value ?? '');
  if (markup) {
    text = text.replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/?[a-z][^>]*>|<!--[^]*?-->|<\d{2,}:\d{2}[^>]*>/gi, '');
    text = decodeEntities(text);
  }
  return text.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\t ]+\n/g, '\n').trim();
}

function numeric(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const result = Number(value);
  return Number.isFinite(result) ? result : NaN;
}

function milliseconds(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function normalize(entries) {
  if (entries.length > MAX_CUES) fail();
  const cues = [];
  for (const entry of entries) {
    const start = milliseconds(Math.max(0, entry.start));
    const end = milliseconds(Math.max(0, entry.end));
    const text = cleanText(entry.text);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  // Only remove identical duplicates at identical timings, never arbitrary overlaps.
  const seen = new Set();
  const unique = cues.filter((cue) => {
    const key = JSON.stringify([cue.start, cue.end, cue.text]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!unique.length) fail();
  return unique.map((cue, i) => ({ id: `cue-${i + 1}`, ...cue }));
}

function json3(raw) {
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.events) || data.events.length > MAX_CUES * 4) fail();
  const events = data.events.filter((event) => event && Array.isArray(event.segs)
    && event.segs.some((seg) => typeof seg?.utf8 === 'string' && seg.utf8.trim()));
  const cues = [];
  const windows = new Map();
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const base = numeric(event.tStartMs);
    if (!Number.isFinite(base)) continue;
    const text = event.segs.map((seg) => typeof seg?.utf8 === 'string' ? seg.utf8 : '').join('');
    const first = event.segs.find((seg) => typeof seg?.utf8 === 'string' && seg.utf8.trim());
    const offset = Math.max(0, numeric(first?.tOffsetMs) || 0);
    const start = (base + offset) / 1000;
    const duration = numeric(event.dDurationMs);
    if (event.dDurationMs !== undefined && (!Number.isFinite(duration) || duration <= 0)) continue;
    const nextStart = numeric(events[i + 1]?.tStartMs);
    const lastOffset = Math.max(0, ...event.segs.slice(0, 10000).map((seg) => numeric(seg?.tOffsetMs) || 0));
    const end = Number.isFinite(duration) && duration > 0
      ? (base + duration) / 1000
      : (Number.isFinite(nextStart) && nextStart > base + offset
        ? nextStart / 1000 : (base + lastOffset + 2000) / 1000);
    const key = event.wWinId ?? 'default';
    const previous = windows.get(key);
    const cue = { start, end, text: cleanText(text) };
    if (previous && previous.end > start && previous.start <= start) {
      if (event.aAppend === 1) {
        // Split at an actual append: words must not appear before their arrival.
        // Preserve a leading space/newline from the append payload.
        cue.text = cleanText(previous.text + text);
        cue.end = Math.max(previous.end, end);
        previous.end = start;
      } else if (cue.text === previous.text) {
        previous.end = Math.max(previous.end, end);
        continue;
      } else if (cue.text.startsWith(`${previous.text} `) || cue.text.startsWith(`${previous.text}\n`)) {
        // Rolling ASR snapshots replace only their known prefix, not other overlaps.
        previous.end = start;
      }
    }
    cues.push(cue);
    windows.set(key, cue);
  }
  return cues;
}

function attributes(raw) {
  const result = Object.create(null);
  for (const match of raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]] = decodeEntities(match[2] ?? match[3]);
  }
  return result;
}

function xml(raw) {
  // Parse only YouTube's two known text containers; never evaluate XML entities,
  // DTDs, external resources or markup. Reject truncated/foreign documents.
  const source = raw.replace(/^﻿/, '').trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail();
  if (!/^(?:<\?xml\b[^]*?\?>\s*)?<(transcript|timedtext)\b[^>]*>[^]*<\/\1\s*>\s*$/i.test(source)) fail();
  const cues = [];
  const expression = /<(text|p)\b([^>]*)>([^]*?)<\/\1\s*>/gi;
  const openings = [...source.matchAll(/<(?:text|p)\b[^>]*(?<!\/)\s*>/gi)].length;
  let parsed = 0;
  for (const match of source.matchAll(expression)) {
    parsed += 1;
    const attrs = attributes(match[2]);
    const legacy = match[1].toLowerCase() === 'text';
    const scale = legacy ? 1 : 1000;
    const start = numeric(attrs[legacy ? 'start' : 't']) / scale;
    const duration = numeric(attrs[legacy ? 'dur' : 'd']) / scale;
    cues.push({ start, end: start + duration, text: cleanText(match[3], true) });
  }
  if (parsed !== openings) fail();
  return cues;
}

function parseTimestamp(value) {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return NaN;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60
    + Number(match[3]) + Number(match[4]) / 1000;
}

function vtt(raw) {
  const source = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!/^WEBVTT(?:[\t ][^\n]*)?(?:\n|$)/.test(source)) fail();
  const blocks = source.split(/\n[\t ]*\n/);
  const cues = [];
  for (const block of blocks.slice(1)) {
    if (/^(?:NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) continue;
    const lines = block.split('\n');
    const timingIndex = lines[0]?.includes('-->') ? 0 : 1;
    const timing = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[timingIndex] || '');
    if (!timing) {
      if (block.includes('-->')) fail();
      continue;
    }
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail();
    cues.push({ start, end, text: cleanText(lines.slice(timingIndex + 1).join('\n'), true) });
  }
  return cues;
}

export function parseCaptions(raw, format) {
  try {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_RAW_LENGTH) fail();
    const parser = { json3, xml, vtt }[format];
    if (typeof parser !== 'function') fail();
    return normalize(parser(raw));
  } catch (error) {
    if (error?.code === 'CAPTIONS_PARSE') throw error;
    fail();
  }
}

function timestamp(seconds, format) {
  const total = Math.round(seconds * 1000);
  const ms = total % 1000;
  const secondsPart = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(ms).padStart(3, '0')}`;
}

function exportText(value, format) {
  // Also remove encoded tags; output is a subtitle document, not HTML.
  let text = cleanText(decodeEntities(value), true).replace(/\n{2,}/g, '\n');
  if (format === 'vtt') text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text;
}

export function toSubtitleFile(cues, format) {
  if (format !== 'srt' && format !== 'vtt') fail();
  if (!Array.isArray(cues) || !cues.length || cues.length > MAX_CUES) fail('INCOMPLETE');
  const blocks = cues.map((cue, index) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < 0 || cue.end <= cue.start
      || Math.round(cue.end * 1000) <= Math.round(cue.start * 1000)) fail();
    if (typeof cue.text !== 'string' || typeof cue.translated !== 'string') fail('INCOMPLETE');
    const original = exportText(cue.text, format);
    const translated = exportText(cue.translated, format);
    if (!original || !translated) fail('INCOMPLETE');
    return `${index + 1}\n${timestamp(cue.start, format)} --> ${timestamp(cue.end, format)}\n${original}\n${translated}`;
  });
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks.join('\n\n')}\n`;
}

export function activeCueIndex(cues, time) {
  if (!Array.isArray(cues) || !cues.length || !Number.isFinite(time) || time < 0) return -1;
  let index = indexes.get(cues);
  if (!index || index.length !== cues.length) {
    // A max-end segment tree finds an earlier overlapping cue after a shorter
    // later cue has ended. Query cost is logarithmic, even for long transcripts.
    let size = 1;
    while (size < cues.length) size *= 2;
    const tree = new Float64Array(size * 2).fill(-Infinity);
    for (let i = 0; i < cues.length; i += 1) tree[size + i] = cues[i].end;
    for (let i = size - 1; i > 0; i -= 1) tree[i] = Math.max(tree[i * 2], tree[i * 2 + 1]);
    index = { size, tree, length: cues.length };
    indexes.set(cues, index);
  }
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cues[mid].start <= time) low = mid + 1;
    else high = mid;
  }
  const upper = low - 1;
  function find(node, left, right) {
    if (left > upper || index.tree[node] <= time) return -1;
    if (left === right) return left < cues.length ? left : -1;
    const mid = (left + right) >>> 1;
    const later = find(node * 2 + 1, mid + 1, right);
    return later !== -1 ? later : find(node * 2, left, mid);
  }
  return upper < 0 ? -1 : find(1, 0, index.size - 1);
}
