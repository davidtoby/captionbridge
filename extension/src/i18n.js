export const strings = {
  'zh-CN': {
    tagline: '让每一个好故事，没有语言边界。', language: '界面语言', video: '当前视频', openVideo: '打开 YouTube 视频后，字幕会在这里就绪。', enabled: '自动双语字幕', enabledHint: '开始播放时，自动读取并翻译可用字幕。', target: '翻译为', source: '字幕轨道', auto: '自动选择', settings: '连接设置', connection: '本地翻译服务', server: '服务地址', token: '配对码', tokenHint: '从本地安装向导复制。不是模型 API Key。', tokenPlaceholder: '粘贴本地服务配对码', save: '保存并检测', saved: '设置已保存', connected: '服务已连接', offline: '服务未连接', checking: '正在检查连接…', download: '下载双语字幕', downloadHint: '全片翻译完成后可下载，保留原文、译文和时间轴。', retry: '重新读取 / 重试', srt: '下载 SRT', vtt: '下载 WebVTT', openSettings: '设置', setup: '安装向导', privacy: '字幕经本地服务发送至已配置的模型。模型密钥不会进入插件。', model: '当前模型', progress: '已翻译 {done} / {total} 条', original: '原文', translated: '译文', idle: '等待视频', loading: '正在读取字幕', translating: '正在翻译', ready: '双语字幕已就绪', disabled: '自动翻译已暂停', error: '需要处理', errorUnknown: '操作失败，请稍后重试。', formatNote: 'SRT · 通用字幕格式 / WebVTT · 网页播放器', openYoutube: '打开 YouTube', successDownload: '字幕已生成，正在下载。', trackNote: '更换轨道或目标语言会重新翻译，可能产生调用费用。', serverLocal: '默认仅连接本机 127.0.0.1 或 localhost。', enName: '英语', zhName: '简体中文', zhTraditional: '繁体中文', jaName: '日语', koName: '韩语', frName: '法语', deName: '德语', esName: '西班牙语', tokenShow: '显示 / 隐藏配对码',
  },
  en: {
    tagline: 'Good stories, beyond language.', language: 'Interface language', video: 'CURRENT VIDEO', openVideo: 'Open a YouTube video to get your subtitles ready here.', enabled: 'Automatic bilingual subtitles', enabledHint: 'Read and translate available captions when a video opens.', target: 'Translate into', source: 'Caption track', auto: 'Choose automatically', settings: 'Connection settings', connection: 'Local translation service', server: 'Server address', token: 'Pairing code', tokenHint: 'Copy from the local setup guide. Not your model API key.', tokenPlaceholder: 'Paste your local pairing code', save: 'Save & test connection', saved: 'Settings saved', connected: 'Service connected', offline: 'Service disconnected', checking: 'Checking connection…', download: 'Download bilingual subtitles', downloadHint: 'Available when the full video is translated. Includes original text, translation, and timestamps.', retry: 'Reload / retry', srt: 'Download SRT', vtt: 'Download WebVTT', openSettings: 'Settings', setup: 'Setup guide', privacy: 'Captions are sent through your local service to the configured model. Model keys never enter the extension.', model: 'Current model', progress: '{done} / {total} cues translated', original: 'Original', translated: 'Translation', idle: 'Waiting for a video', loading: 'Reading captions', translating: 'Translating', ready: 'Bilingual subtitles ready', disabled: 'Automatic translation paused', error: 'Action needed', errorUnknown: 'Something went wrong. Please try again.', formatNote: 'SRT · Universal subtitles / WebVTT · Web players', openYoutube: 'Open YouTube', successDownload: 'Subtitles generated. Download started.', trackNote: 'Changing tracks or target language starts a new translation and may incur API charges.', serverLocal: 'Connects only to 127.0.0.1 or localhost on this computer.', enName: 'English', zhName: 'Simplified Chinese', zhTraditional: 'Traditional Chinese', jaName: 'Japanese', koName: 'Korean', frName: 'French', deName: 'German', esName: 'Spanish', tokenShow: 'Show / hide pairing code',
  },
};
Object.assign(strings['zh-CN'], {
  subtitleTab: '视频字幕', pageTab: '网页翻译', translatePage: '翻译整个页面', restorePage: '恢复原文', pageTitle: '读懂整个页面', pageHint: '仅在你点击翻译后读取当前页面，不自动读取其他网站。', pageMode: '显示方式', replaceMode: '只显示译文', bilingualMode: '原文 + 译文', pageIdle: '尚未翻译', pageTranslating: '正在翻译页面', pageReady: '页面翻译已完成', pageError: '页面翻译需要处理', pageProgress: '已翻译 {done} / {total} 个文本段', pageNoTab: '请在要翻译的网页上点击插件图标。', pagePrivacy: '页面文本将发送至已配置的模型，可能产生费用。跳过表单输入值、编辑区、代码和隐藏内容。', pageDynamic: '开启期间会继续翻译新加载的文字；恢复原文即停止。', dragHint: '拖动字幕框可上下左右移动；暂停时也能调整。', resetPosition: '重置字幕位置', positionReset: '字幕位置已重置', privacy: '字幕或网页文本经本地服务发送至已配置的模型。密钥不进入插件。',
});
Object.assign(strings.en, {
  subtitleTab: 'Video captions', pageTab: 'Web pages', translatePage: 'Translate entire page', restorePage: 'Restore original', pageTitle: 'Understand the whole page', pageHint: 'Reads this page only after you click Translate. Other sites are not read automatically.', pageMode: 'Display mode', replaceMode: 'Translation only', bilingualMode: 'Original + translation', pageIdle: 'Not translated', pageTranslating: 'Translating this page', pageReady: 'Page translation complete', pageError: 'Page translation needs attention', pageProgress: '{done} / {total} text segments translated', pageNoTab: 'Click the extension icon on the page you want to translate.', pagePrivacy: 'Page text goes to your configured model and may incur charges. Form values, editable areas, code, and hidden content are skipped.', pageDynamic: 'Newly loaded text is translated while active. Restore original to stop.', dragHint: 'Drag the caption box up, down, or sideways, even while paused.', resetPosition: 'Reset caption position', positionReset: 'Caption position reset', privacy: 'Captions or page text go through your local service to the configured model. Keys stay out of the extension.',
});
const errors = {
  PAGE_TOO_LARGE: ['页面超过处理上限，部分文字未翻译；可恢复原文。', 'This page exceeds the processing limit. Some text was not translated; you can restore the original.'],
  PAGE_NO_TEXT: ['没有找到可翻译的页面文字。图片、PDF、代码和嵌入页面不在支持范围内。', 'No eligible page text found. Images, PDFs, code and embedded frames are not supported.'],
  PAGE_UNSUPPORTED: ['此页面不支持翻译。请在普通 HTTP/HTTPS 网页上点击插件图标。', 'This page cannot be translated. Open the extension on a regular HTTP/HTTPS web page.'],
  PAGE_PERMISSION_DENIED: ['请在目标网页上重新点击插件图标，以授予当前标签页访问权限。Chrome 内部页面和应用商店不支持注入。', 'Click the extension icon on the target page to grant active-tab access. Chrome internal pages and the Web Store block injection.'],
  NO_VIDEO: ['请先打开一个 YouTube 视频。', 'Open a YouTube video first.'],
  NO_CAPTIONS: ['此视频没有可读取字幕。本版本不包含音频转写。', 'No readable captions. Audio transcription is not included.'],
  CAPTIONS_UNAVAILABLE: ['YouTube 暂未提供可读取字幕。请开启 CC、播放几秒后重试；若仍失败，可能受登录或网站限制。', 'Captions are unavailable. Enable CC, play for a few seconds, and retry. Sign-in or site restrictions may apply.'],
  CAPTIONS_PARSE: ['无法解析字幕格式。请换一条字幕轨道。', 'Cannot parse these captions. Try a different track.'],
  BRIDGE_TIMEOUT: ['字幕读取超时，请刷新视频页面后重试。', 'Caption access timed out. Refresh the video and retry.'],
  INCOMPLETE: ['请等待全片字幕翻译完成，再下载。', 'Wait for all captions to finish translating before downloading.'],
  VIDEO_CHANGED: ['视频已切换，正在读取新字幕。', 'Video changed. Loading new captions.'],
  SERVER_UNREACHABLE: ['无法连接本地服务。请启动服务并检查地址。', 'Cannot reach the local service. Start it and check the address.'],
  UNAUTHORIZED: ['请在设置中填写正确的本地服务配对码。', 'Enter the correct local service pairing code in Settings.'],
  MODEL_NOT_CONFIGURED: ['服务端尚未配置模型凭证，请查看安装说明。', 'Model credentials are not configured on the server. See setup instructions.'],
  MODEL_AUTH_FAILED: ['模型凭证无效或已过期，请更新服务端配置。', 'Model credentials are invalid or expired. Update the server configuration.'],
  MODEL_NOT_FOUND: ['该模型不可用，请修改服务端模型配置。', 'This model is unavailable. Update the server model setting.'],
  MODEL_RATE_LIMIT: ['模型请求过于频繁，请稍后重试。', 'Model rate limit reached. Please retry shortly.'],
  MODEL_TIMEOUT: ['模型响应超时，请稍后重试。', 'The model timed out. Please try again.'],
  MODEL_UNREACHABLE: ['无法连接模型网关，请检查服务端网络。', 'Cannot reach the model gateway. Check the server connection.'],
  MODEL_REQUEST_FAILED: ['模型调用失败，请检查服务端模型配置。', 'Model request failed. Check the server configuration.'],
  MODEL_OUTPUT_INVALID: ['模型返回格式异常，请重试。', 'The model returned an invalid format. Retry the translation.'],
  MODEL_OUTPUT_INCOMPLETE: ['模型输出不完整，请重试。', 'Model output was incomplete. Please retry.'],
  MODEL_REFUSED: ['模型未能处理这段文字。', 'The model declined this translation request.'],
  SERVER_BUSY: ['翻译服务繁忙，请稍后重试。', 'The translation service is busy. Try again shortly.'],
  RATE_LIMITED: ['请求过于频繁，请稍后重试。', 'Too many requests. Please wait and retry.'],
  INVALID_SERVER: ['仅支持本机 HTTP 地址，不包含路径、用户名或密码。', 'Use a local HTTP address without a path, username, or password.'],
  INVALID_REQUEST: ['文本请求格式不正确或单段文字过长。', 'Invalid translation request or an excessively long text segment.'],
  INVALID_LANGUAGE: ['不支持此语言设置。', 'This language setting is not supported.'],
  REQUEST_TOO_LARGE: ['此批文字过长，无法发送。', 'This text batch is too large to send.'],
  FORBIDDEN: ['此请求不被允许。', 'This request is not allowed.'],
};
export function t(locale, key, args = {}) { let value = (strings[locale] || strings.en)[key] || key; for (const [k, v] of Object.entries(args)) value = value.replace(`{${k}}`, String(v)); return value; }
export function errorText(locale, code) { return errors[code]?.[locale === 'zh-CN' ? 0 : 1] || t(locale, 'errorUnknown'); }
