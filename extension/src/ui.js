import { DEFAULTS, getSettings, normalizeServerUrl } from './settings.js';
import { t, errorText } from './i18n.js';
const $ = id => document.getElementById(id);
let settings = { ...DEFAULTS }; let status = null; let tabId = null; let health = null; let action = null; let trackSignature = ''; let disposed = false;
const isOptions = location.pathname.endsWith('options.html');
if (isOptions) { document.body.classList.add('options'); $('connection').open = true; }
function showAction(key, error = false) { action = { key, error }; renderAction(); }
function renderAction() { $('action-message').textContent = action ? (action.error ? errorText(settings.locale, action.key) : t(settings.locale, action.key)) : ''; $('action-message').classList.toggle('success', !!action && !action.error); }
function renderLanguage() {
  document.documentElement.lang = settings.locale;
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(settings.locale, el.dataset.i18n));
  $('locale').value = settings.locale; $('locale').setAttribute('aria-label', t(settings.locale, 'language'));
  $('client-token').placeholder = t(settings.locale, 'tokenPlaceholder'); $('show-token').setAttribute('aria-label', t(settings.locale, 'tokenShow'));
  renderStatus(); renderHealth(); renderAction();
}
function renderHealth() {
  $('connection-state').textContent = t(settings.locale, health === null ? 'checking' : health.ok ? 'connected' : 'offline');
  $('connection-dot').classList.toggle('connected', !!health?.ok);
  $('model-name').textContent = health?.ok ? `${t(settings.locale, 'model')}: ${health.data.model}` : '';
}
function renderStatus() {
  $('video-title').textContent = status?.title || t(settings.locale, 'openVideo');
  $('video-state').textContent = t(settings.locale, status?.state || 'idle');
  $('cue-count').textContent = status?.total ? t(settings.locale, 'progress', { done: status.completed || 0, total: status.total }) : '';
  $('video-error').textContent = status?.errorCode ? errorText(settings.locale, status.errorCode) : '';
  const complete = !!status?.total && status.completed === status.total && status.state === 'ready';
  $('download-srt').disabled = !complete; $('download-vtt').disabled = !complete;
  $('retry').disabled = tabId === null;
  const signature = JSON.stringify([status?.videoId, status?.tracks, settings.locale]);
  if (signature !== trackSignature) {
    trackSignature = signature;
    $('track').replaceChildren(new Option(t(settings.locale, 'auto'), '-1'));
    for (const track of status?.tracks || []) {
      let name = track.name || track.languageCode;
      try { name = new Intl.DisplayNames([settings.locale], { type: 'language' }).of(track.languageCode) || name; } catch { /* Retain the source label for nonstandard tags. */ }
      $('track').add(new Option(`${name}${track.kind === 'asr' ? (settings.locale === 'zh-CN' ? ' · 自动生成' : ' · Auto-generated') : ''}`, String(track.index)));
    }
  }
  if (document.activeElement !== $('track')) $('track').value = String(status?.selectedTrack ?? -1);
  $('track').disabled = !status?.tracks?.length;
}
async function background(type) { try { return await chrome.runtime.sendMessage({ type }); } catch { return { ok: false, error: { code: 'SERVER_UNREACHABLE' } }; } }
async function refreshHealth() { health = await background('CONNECTION_TEST'); if (health.ok && !health.data.configured) health = { ok: false, error: { code: 'MODEL_NOT_CONFIGURED' } }; renderHealth(); }
async function refreshStatus() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = tabs[0];
    if (isOptions && !tab?.url?.startsWith('https://www.youtube.com/')) {
      const youtubeTabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }); tab = youtubeTabs[0];
    }
    tabId = tab?.url?.startsWith('https://www.youtube.com/') ? tab.id : null;
    if (tabId === null) status = null;
    else { const result = await chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' }); status = result.ok ? result.data : null; }
  } catch { status = null; tabId = null; }
  renderStatus();
}
async function command(type, payload = {}) {
  if (tabId === null) return { ok: false, error: { code: 'NO_VIDEO' } };
  try { return await chrome.tabs.sendMessage(tabId, { type, ...payload }); } catch { return { ok: false, error: { code: 'NO_VIDEO' } }; }
}
async function download(format) {
  const result = await command('DOWNLOAD', { format });
  if (!result?.ok) { showAction(result?.error?.code || 'INCOMPLETE', true); return; }
  const blob = new Blob([result.data.text], { type: result.data.mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = result.data.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  showAction('successDownload');
}
$('locale').addEventListener('change', async e => { settings.locale = e.target.value; renderLanguage(); await chrome.storage.local.set({ locale: settings.locale }); });
$('enabled').addEventListener('change', async e => { settings.enabled = e.target.checked; await chrome.storage.local.set({ enabled: settings.enabled }); await refreshStatus(); });
$('target').addEventListener('change', async e => { settings.targetLanguage = e.target.value; await chrome.storage.local.set({ targetLanguage: settings.targetLanguage }); });
$('track').addEventListener('change', async e => { const result = await command('SELECT_TRACK', { index: Number(e.target.value) }); if (!result?.ok) showAction(result?.error?.code || 'NO_VIDEO', true); await refreshStatus(); });
$('retry').addEventListener('click', async () => { const result = await command('RETRY'); if (!result?.ok) showAction(result?.error?.code || 'NO_VIDEO', true); await refreshStatus(); });
$('download-srt').addEventListener('click', () => download('srt'));
$('download-vtt').addEventListener('click', () => download('vtt'));
$('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('show-token').addEventListener('click', () => { $('client-token').type = $('client-token').type === 'password' ? 'text' : 'password'; });
$('settings-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const serverUrl = normalizeServerUrl($('server-url').value.trim()); const clientToken = $('client-token').value.trim();
    if (!/^[a-f0-9]{64}$/.test(clientToken)) throw new Error('UNAUTHORIZED');
    await chrome.storage.local.set({ serverUrl, clientToken }); settings = { ...settings, serverUrl, clientToken };
    $('setup-link').href = serverUrl; health = null; renderHealth(); await refreshHealth();
    showAction(health.ok ? 'connected' : health.error.code, !health.ok);
  } catch (error) { showAction(error.message, true); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, value] of Object.entries(changes)) if (key in DEFAULTS) settings[key] = value.newValue ?? DEFAULTS[key];
  $('enabled').checked = settings.enabled; $('target').value = settings.targetLanguage;
  renderLanguage();
});
(async () => {
  settings = await getSettings(); $('enabled').checked = settings.enabled; $('target').value = settings.targetLanguage;
  $('server-url').value = settings.serverUrl; $('client-token').value = settings.clientToken; $('setup-link').href = normalizeServerUrl(settings.serverUrl);
  if (!settings.clientToken) $('connection').open = true;
  renderLanguage(); await Promise.all([refreshStatus(), refreshHealth()]);
  const timer = setInterval(() => { if (!disposed) refreshStatus(); }, 1200);
  window.addEventListener('pagehide', () => { disposed = true; clearInterval(timer); }, { once: true });
})();
