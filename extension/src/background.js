import { getSettings, normalizeServerUrl } from './settings.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (!['TRANSLATE', 'HEALTH', 'CONNECTION_TEST'].includes(message?.type)) return false;
  // Pages cannot trigger privileged traffic directly; only our own extension messages can.
  if (message.type === 'TRANSLATE' && (!sender.tab || !sender.url?.startsWith('https://www.youtube.com/'))) {
    sendResponse({ ok: false, error: { code: 'FORBIDDEN' } }); return false;
  }
  (async () => {
    const settings = await getSettings();
    const serverUrl = normalizeServerUrl(settings.serverUrl);
    if (!settings.clientToken && message.type !== 'HEALTH') return { ok: false, error: { code: 'UNAUTHORIZED' } };
    const path = message.type === 'TRANSLATE' ? '/api/translate' : message.type === 'HEALTH' ? '/api/health' : '/api/status';
    const response = await fetch(serverUrl + path, {
      method: message.type === 'TRANSLATE' ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(settings.clientToken ? { Authorization: `Bearer ${settings.clientToken}` } : {}) },
      ...(message.type === 'TRANSLATE' ? { body: JSON.stringify(message.payload) } : {}),
      signal: AbortSignal.timeout(110000), redirect: 'error', credentials: 'omit',
    });
    const data = await response.json();
    if (typeof data.ok !== 'boolean') throw new Error('SERVER_UNREACHABLE');
    return data;
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: { code: error.message === 'INVALID_SERVER' ? 'INVALID_SERVER' : error.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'SERVER_UNREACHABLE' } }));
  return true;
});
