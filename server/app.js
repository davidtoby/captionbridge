import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppError, modelError } from './translator.js';
import packageInfo from '../package.json' with { type: 'json' };

const PUBLIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
function safeEqual(a, b) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function allowedOrigin(origin, port) {
  if (!origin) return true;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return true;
  try { const u = new URL(origin); return u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname) && u.port === String(port); } catch { return false; }
}
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new AppError('REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON'); }
}
export function createApp({ translator, clientToken, model, webDir, zipPath, port = 8787 }) {
  let windowAt = Date.now(); let requests = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const actualPort = server.address()?.port || port;
      const host = req.headers.host || '';
      if (!['127.0.0.1:' + actualPort, 'localhost:' + actualPort].includes(host)) throw new AppError('FORBIDDEN', 403);
      const origin = req.headers.origin;
      if (!allowedOrigin(origin, actualPort)) throw new AppError('FORBIDDEN', 403);
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.writeHead(204); res.end(); return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${actualPort}`);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(200, { ok: true, data: { service: 'CaptionBridge', version: packageInfo.version, configured: !!translator.provider, model } }); return;
      }
      if (req.method === 'GET' && PUBLIC_FILES.has(url.pathname)) {
        const [file, type] = PUBLIC_FILES.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(new URL(file, webDir))); return;
      }
      if (req.method === 'GET' && url.pathname === '/downloads/captionbridge-extension.zip') {
        let data; try { data = await readFile(zipPath); } catch { throw new AppError('PACKAGE_NOT_BUILT', 404); }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="captionbridge-extension.zip"' }); res.end(data); return;
      }
      if (!safeEqual(req.headers.authorization || '', `Bearer ${clientToken}`)) throw new AppError('UNAUTHORIZED', 401);
      if (req.method === 'GET' && url.pathname === '/api/status') {
        json(200, { ok: true, data: { configured: !!translator.provider, model, active: translator.active, cacheEntries: translator.cache.size } }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/translate') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 415);
        if (Date.now() - windowAt >= 60000) { windowAt = Date.now(); requests = 0; }
        if (++requests > 120) throw new AppError('RATE_LIMITED', 429);
        const data = await translator.translate(await readBody(req));
        json(200, { ok: true, data }); return;
      }
      throw new AppError('NOT_FOUND', 404);
    } catch (error) {
      const mapped = modelError(error);
      if (!res.headersSent) {
        if (mapped.status === 429) res.setHeader('Retry-After', '3');
        json(mapped.status, { ok: false, error: { code: mapped.code } });
      } else res.end();
      // No caption content, credential, upstream error payload or signed URLs in logs.
      if (mapped.status >= 500) console.warn(`[request] ${mapped.code}`);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
