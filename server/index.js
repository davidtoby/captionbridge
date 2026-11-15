import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createProvider, Translator } from './translator.js';

const root = new URL('../', import.meta.url);
const localDir = new URL('.local/', root);
await mkdir(localDir, { recursive: true, mode: 0o700 });
await chmod(localDir, 0o700);
const tokenFile = new URL('client-token', localDir);
let clientToken;
try { clientToken = (await readFile(tokenFile, 'utf8')).trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (!clientToken || !/^[a-f0-9]{64}$/.test(clientToken)) {
  clientToken = randomBytes(32).toString('hex');
  await writeFile(tokenFile, clientToken, { mode: 0o600 });
}
await chmod(tokenFile, 0o600);
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT / 无效端口');
const model = process.env.TRANSLATION_MODEL || 'claude-opus-5-5';
const provider = createProvider({ model, apiKey: process.env.ANTHROPIC_API_KEY, authToken: process.env.ANTHROPIC_AUTH_TOKEN, baseURL: process.env.ANTHROPIC_BASE_URL });
const translator = new Translator({ provider, model });
const server = createApp({ translator, clientToken, model, port, webDir: new URL('web/', root), zipPath: new URL('releases/captionbridge-extension.zip', root) });
const setupUrl = `http://127.0.0.1:${port}/#token=${clientToken}`;
await writeFile(new URL('connection.json', localDir), JSON.stringify({ serverUrl: `http://127.0.0.1:${port}`, clientToken, setupUrl }, null, 2), { mode: 0o600 });
await writeFile(new URL('open-setup.html', localDir), `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>CaptionBridge</title><a href="${setupUrl}">打开安装向导 / Open setup</a>`, { mode: 0o600 });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use / 端口已占用` : 'Server failed to start / 服务启动失败'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`CaptionBridge listening at http://127.0.0.1:${port}`);
  console.log(`Model: ${model}; credentials: ${provider ? 'configured' : 'missing'}`);
  console.log(`Setup link is stored privately in ${fileURLToPath(new URL('connection.json', localDir))}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
