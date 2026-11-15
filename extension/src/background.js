import { getSettings, normalizeServerUrl } from './settings.js';

const idlePage = () => ({ ok: true, data: { state: 'idle', completed: 0, total: 0, mode: 'replace' } });
const fail = code => ({ ok: false, error: { code } });
function webPage(url) { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } }

async function pageControl(message, sender) {
  // Only our popup/settings UI can inject the page reader. Page scripts cannot.
  if (!sender.url?.startsWith(chrome.runtime.getURL('')) || !Number.isInteger(message.tabId)) return fail('FORBIDDEN');
  if (!['PAGE_START', 'PAGE_STATUS', 'PAGE_RESTORE', 'PAGE_MODE'].includes(message.action)) return fail('INVALID_REQUEST');
  let tab;
  try { tab = await chrome.tabs.get(message.tabId); } catch { return fail('PAGE_UNSUPPORTED'); }
  if (!webPage(tab.url)) return fail('PAGE_UNSUPPORTED');
  const target = { tabId: tab.id, frameIds: [0] };
  if (message.action === 'PAGE_START') {
    const settings = await getSettings();
    if (!settings.clientToken) return fail('UNAUTHORIZED');
    try { await chrome.scripting.executeScript({ target, files: ['page-translator.js'] }); }
    catch { return fail('PAGE_PERMISSION_DENIED'); }
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: message.action, targetLanguage: message.targetLanguage, mode: message.mode }, { frameId: 0 });
  } catch {
    return message.action === 'PAGE_START' ? fail('PAGE_UNSUPPORTED') : idlePage();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'PAGE_CONTROL') {
    pageControl(message, sender).then(sendResponse).catch(() => sendResponse(fail('PAGE_UNSUPPORTED')));
    return true;
  }
  if (!['TRANSLATE', 'PAGE_TRANSLATE', 'HEALTH', 'CONNECTION_TEST'].includes(message?.type)) return false;
  const translating = ['TRANSLATE', 'PAGE_TRANSLATE'].includes(message.type);
  if (translating && (!sender.tab || !webPage(sender.url) || (message.type === 'TRANSLATE' && !sender.url.startsWith('https://www.youtube.com/')))) {
    sendResponse(fail('FORBIDDEN')); return false;
  }
  (async () => {
    const settings = await getSettings();
    const serverUrl = normalizeServerUrl(settings.serverUrl);
    if (!settings.clientToken && message.type !== 'HEALTH') return fail('UNAUTHORIZED');
    const path = translating ? '/api/translate' : message.type === 'HEALTH' ? '/api/health' : '/api/status';
    const payload = message.type === 'PAGE_TRANSLATE' ? { ...message.payload, kind: 'page' } : message.payload;
    const response = await fetch(serverUrl + path, {
      method: translating ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(settings.clientToken ? { Authorization: `Bearer ${settings.clientToken}` } : {}) },
      ...(translating ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(110000), redirect: 'error', credentials: 'omit',
    });
    const data = await response.json();
    if (typeof data.ok !== 'boolean') throw new Error('SERVER_UNREACHABLE');
    return data;
  })().then(sendResponse).catch(error => sendResponse(fail(error.message === 'INVALID_SERVER' ? 'INVALID_SERVER' : error.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'SERVER_UNREACHABLE')));
  return true;
});
