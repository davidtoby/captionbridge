# Changelog / 更新记录

## 2.0.0 — 2026-11-15

### 中文
- 字幕框支持鼠标/触控拖动，暂停时保留显示，按播放器比例保存位置，兼容缩放与全屏。
- 增加键盘移动和位置重置；移动不重新调用翻译模型。
- 新增按需全页面文本翻译：译文模式/双语模式、一键恢复、动态文本更新、错误与进度提示。
- 保留页面 DOM 元素、事件处理器和表单状态；排除编辑区、表单值、代码、隐藏内容及翻译退出标记。
- 注入通用页面仅使用用户点击后的 activeTab 权限，不新增所有网站的常驻权限。
- 网页与字幕使用独立翻译提示词和缓存上下文；保留 v1 API 兼容性。
- 完整的中英文界面与项目介绍；48 项自动化测试及真实浏览器/模型联调。

### English
- Draggable captions with pause visibility, proportional position persistence, resizing and fullscreen support.
- Keyboard movement and reset, without retranslation.
- On-demand full-page text translation, bilingual/translation-only modes, restoration, and dynamic-content handling.
- Preserves DOM identities, event handlers and form state; excludes editable/form values, code, hidden content and opt-out markers.
- General pages use user-activated activeTab injection, not persistent access to all sites.
- Separate page/subtitle prompt and cache contexts; v1 API compatibility retained.
- Chinese/English interface and documentation; 48 automated checks plus actual-browser/model integration.

### Known limits / 已知限制

Main-document light-DOM text only: no attribute text, frames, Shadow DOM, PDF, image OCR or audio transcription. Existing live-YouTube caption availability remains dependent on site/access conditions; the isolated live-site test previously returned empty native caption responses and is not claimed as passing. Page text limits fail explicitly. No model credentials are distributed.

全页面翻译仅覆盖主文档普通可见文字，不含属性、框架、Shadow DOM、PDF、图片或音频转写。YouTube 实站字幕可读性仍受网站及访问条件影响；之前独立实站测试收到原生字幕空响应，未宣称验证成功。超大页面明确报错，不分发模型凭证。

## 1.0.0 — 2026-11-14

- Initial MV3 client, loopback Node.js translation service, Chinese/English setup UI, bilingual YouTube caption overlay and complete SRT/WebVTT export.
- 37 automated checks, actual model requests and controlled-video browser integration verified; live YouTube caption retrieval limitations documented.
- 首版 Chrome 插件、本机翻译服务、双语安装向导、YouTube 双语字幕与完整字幕下载；记录实站访问限制。
