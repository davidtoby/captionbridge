export const DEFAULTS = { enabled: true, targetLanguage: 'zh-Hans', sourceLanguage: 'auto', locale: 'zh-CN', serverUrl: 'http://127.0.0.1:8787', clientToken: '' };
export function normalizeServerUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('INVALID_SERVER'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('INVALID_SERVER');
  return url.origin;
}
export async function getSettings() { return chrome.storage.local.get(DEFAULTS); }
