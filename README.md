# CaptionBridge

**Good stories. Beyond language. / 让好内容，不再有语言边界。**

[简体中文](README.md) · [English](README.en.md)

## 项目介绍

CaptionBridge 是一款本地优先的 Chrome 翻译扩展：将 YouTube 已有字幕转换为可自由拖动、跟随时间轴的双语字幕，导出 SRT / WebVTT 文件，也能按需翻译整个网页并一键恢复原文。项目包含 Manifest V3 客户端、Node.js 翻译服务，以及完整的中英文安装与配置界面。模型凭证只保留在服务端，用户可接入自己有权使用的模型服务。

## Project overview

CaptionBridge is a local-first Chrome translation extension with draggable, time-aligned bilingual YouTube captions, SRT/WebVTT exports, and on-demand full-page translation with one-click restoration. It includes a Manifest V3 client, a Node.js translation backend, and a fully localized Chinese/English setup experience. Model credentials stay on the server, and users connect their own authorized model provider.

Independent software; not affiliated with Immersive Translate. 本项目不是沉浸式翻译官方产品，也不宣称覆盖其 Pro / Max 的全部功能。

## v2：字幕随你移动，网页随时读懂

### 自由拖动字幕

- 拖动字幕框或顶部的 `⠿` 手柄，上下左右调整；暂停播放时字幕保持可见，也能拖动。
- 位置以播放器比例保存，刷新页面和下个视频继续使用，适应播放器缩放和全屏。
- 手柄获得键盘焦点后：方向键微调，Shift + 方向键大步移动，Home 重置。插件「视频字幕」页也有「重置字幕位置」。
- 仅改变显示位置，不会重新翻译或增加模型调用。

### 全页面翻译

1. 在普通 HTTP/HTTPS 网页上点击 Chrome 工具栏的插件图标。
2. 切换「网页翻译」，选择目标语言和「只显示译文 / 原文 + 译文」。
3. 点击「翻译整个页面」才开始读取当前页面；不需要所有网站的常驻读取权限。
4. 动态加载的新文字自动加入翻译；点击「恢复原文」停止并还原。切换显示方式或界面语言不会重新调用模型。

保留原有 DOM 元素、按钮事件和表单值；跳过密码、表单输入值、编辑区域、代码、隐藏内容以及 `translate="no"`。网页正文中的个人信息仍属于可见正文，点击翻译会将它发送至你配置的模型；敏感页面请勿开启。只翻译主文档的普通可见文本节点，不支持属性文本（如 placeholder/alt）、跨域 iframe、Shadow DOM、PDF、图片 OCR、Canvas、Chrome 内部页或 Chrome Web Store。上限为 5,000 个文本节点 / 500,000 个源文本 UTF-16 字符；超过上限明确显示错误，不冒充整页完成。

从 v1 更新：重新构建或下载 v2，进入 `chrome://extensions` 点击刷新，再刷新目标网页。新增权限只有 `scripting`；通用页面使用用户点击产生的临时 `activeTab` 权限。

## 本次交付与验证状态

- ✅ v2 实际浏览器验证：鼠标拖动、键盘移动、全屏、暂停保留字幕、位置持久化、真实模型全页面翻译与恢复。
- ✅ 受控异常测试：表单/编辑区/隐藏文字排除、DOM 事件保留、动态更新、原文恢复、迟到响应取消、模型 HTML 文本不执行、超大页面明确报错。
- 本地版本标签：`v1.0.0` 保留升级前基线，`v2.0.0` 为本次升级；GitHub 创建/推送需获得当前执行环境授权。

- ✅ 可加载的 Manifest V3 插件、双语字幕叠加、完整双语 SRT / WebVTT 下载。
- ✅ 本机服务真实调用已配置网关的 `claude-gpt-6-astra`，不是模拟翻译。该名称是当前网关返回的模型标识，不是 Anthropic 官方公开模型 ID。
- ✅ 使用实际 Chromium 扩展、真实播放的视频、受控字幕源及真实模型，验证消息桥接、翻译、时间轴、暂停/跳转、下载和语言切换。
- ✅ 简体中文 / English 全局界面切换，选择持久化，切换界面语言不丢翻译进度；桌面和 390px 窄屏布局已检查。
- ⚠️ 真实 YouTube 页面能够读取字幕轨道；在本次独立、未登录测试浏览器里，测试视频的原生 CC 请求和插件请求均返回 HTTP 200 空正文，完整实站字幕获取未验证成功。不要把受控联调等同于所有 YouTube 视频实测通过。
- ⚠️ 当前运行进程继承了现有环境变量中的模型凭证。安全限制禁止自动持久化这些凭证，磁盘 `.env` **只写入非敏感模型名称和端口**。独立重启 / 重启电脑后，要由你配置可供应用调用的凭证。本项目没有可分发的“内置免费 Token”。

## 快速开始（当前 Mac）

需要 Node.js **22.9 或更新版本**、Chrome 111+。

1. 双击 `start.command`，安装向导会在浏览器打开。如果本次服务已经运行，双击 `open-setup.command` 即可。
2. 安装页下载 `captionbridge-extension.zip` 并解压；也可直接使用本项目的 `dist/extension/`。
3. Chrome 打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择**包含 `manifest.json` 的目录**。
4. 从安装页复制本地服务**配对码**；点击插件图标，展开「连接设置」，填写 `http://127.0.0.1:8787` 和配对码，点击「保存并检测」。配对码仅用于本机服务，不是模型 API Key。
5. 打开或刷新一个带字幕的 YouTube 视频，插件会自动读取并翻译。可在弹窗选择字幕轨道和目标语言。
6. 所有字幕翻译完成后，点击「下载 SRT」或「下载 WebVTT」。文件每条包含原文和译文，并保留时间轴。未完成时按钮不可用，不会把半成品冒充完整双语字幕。

如果出现 `CAPTIONS_UNAVAILABLE`：正常登录 YouTube（如该视频要求）、开启原生 CC、播放几秒后点「重新读取 / 重试」。原生 CC 也不可用时，插件不会绕过网站限制；可尝试另一视频 / 轨道。新增或更新插件后需刷新已打开的 YouTube 页。

如果 macOS 阻止双击脚本，可以在终端进入本目录执行：

```bash
npm ci --ignore-scripts
npm run build
npm run package
npm start
```

随后在另一个终端执行 `node --env-file-if-exists=.env scripts/launcher.mjs open` 打开带配对码的向导。

`stop.command` 只停止由本项目启动器创建、且 PID 命令行仍匹配本项目路径的进程。用 `npm start` 启动时在相应终端按 Ctrl+C 停止。

## 模型凭证与重启

模型凭证只存在服务端环境变量或**你自行填写**的 `.env` 中；不应出现在插件代码、安装包、Git、日志或聊天中。此会话的内部认证不能作为应用的可分发 Token。

### 官方 Anthropic API

以 `.env.example` 为模板，在本机 `.env` 中自行填写：

```dotenv
PORT=8787
TRANSLATION_MODEL=claude-opus-5-5
ANTHROPIC_API_KEY=YOUR_OWN_API_KEY
```

不要同时配置无关的 `ANTHROPIC_AUTH_TOKEN`。官方直连使用官方 SDK、流式响应与服务端默认 refusal fallback；可涉及替代模型，需按提供方规则计费。

### 已有兼容网关

本服务也可用官方 SDK 接入现有 **Anthropic Messages 协议兼容网关**：

```dotenv
PORT=8787
TRANSLATION_MODEL=YOUR_GATEWAY_MODEL_ID
ANTHROPIC_BASE_URL=http://127.0.0.1:YOUR_GATEWAY_PORT
ANTHROPIC_AUTH_TOKEN=YOUR_AUTHORIZED_GATEWAY_TOKEN
```

这是协议兼容网关，不代表网关背后就是 Anthropic 模型。模型名称必须来自该网关自己的列表。本次验证选择列表中实际存在的 `claude-gpt-6-astra`。本地网关本身也必须保持运行。

环境变量优先于 Node `--env-file` 文件内容。迁移提供方时请清除终端里旧的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 或 API Key，避免新旧配置混用。不要把占位符当作真实密钥。配置完成后建议 `chmod 600 .env`。

翻译会产生模型提供方的调用用量；自动翻译会继续处理全片字幕。长视频可能较慢、较贵，关闭「自动双语字幕」会停止后续批次；已发出的批次可能仍完成并计费。无凭证时明确报 `MODEL_NOT_CONFIGURED`，不会用假翻译兜底。

## 目录与安装包

```text
extension/                插件源码、HTML、CSS、MV3 manifest
server/                   本机 HTTP 服务 / 模型适配 / 内存缓存
web/                      双语安装向导 + 真实翻译测试
scripts/                  构建、打包、启动、浏览器检查
 tests/                   Node 自动化测试
 dist/extension/          可直接「加载已解压扩展」的目录
 releases/
   captionbridge-extension.zip    仅客户端
   captionbridge-full.zip         完整源码 + 已构建客户端，无模型凭证
 .env.example             凭证配置模板（只有占位符）
 .env                     本机配置，不进入包
 .local/                  本地配对码、连接信息、测试截图、启动器日志
```

安装包采用明确文件白名单，不包含 `.env`、`.local`、浏览器配置、截图或 `node_modules`。不要手动把整个项目文件夹压缩分享，其中可能包含你后续填写的凭证。

## 字幕与限制

- 支持 YouTube 已有人工字幕和自动生成字幕，解析 JSON3、旧 XML、srv3 XML、WebVTT。
- 自动选择 YouTube 当前音轨的默认字幕轨道；也可手动切换。源语言跟随实际字幕轨道，目标语言与界面语言分开。
- 原文和译文随视频时间轴显示，支持跳转、倍速和播放器内全屏。暂停时保留字幕以便阅读和拖动；广告、跳转过程、时间轴空隙以及页面切换时清除过期字幕。
- 分批顺序翻译，优先当前播放位置；缓存包含模型 / 源语言 / 目标语言 / 整批上下文，服务重启即清空，内存最多保留 500 批、每批有效期 24 小时。
- 导出必须全部成功；长字幕仅为传输分段，导出仍保留原始时间轴。原生 CC 与插件字幕可能同时出现，可关闭原生 CC 显示以免重复；如果关闭后获取受限，再开启并重试。
- 视频字幕仅正式覆盖桌面 `www.youtube.com` 播放器；全页面文本翻译支持普通 HTTP/HTTPS 网页。Chrome 手机端通常不支持安装扩展；窄屏布局检查不等于手机版 Chrome 可以安装。
- 不包含无字幕音频转写、配音、实时直播转写、DRM 绕过、登录绕过、会员破解、其它网站视频字幕适配或 Chrome Web Store 上架。
- YouTube 的内部字幕接口可能变化或返回空内容。插件读取页面已有响应并观察原生字幕请求，不伪造客户端身份或访问凭证；当前访问条件拿不到完整字幕时会明确报错。

## 安全与隐私

- HTTP 服务只监听 `127.0.0.1`，不暴露公网，不是云端托管服务。
- 本地 API 使用独立随机配对码；检查 Host 与 Origin，防止跨站调用和 DNS rebinding。全局请求限速 120 次/分钟，同时最多 2 个模型请求，正文限制 64 KiB。
- 插件权限为 `storage`、`activeTab`、`scripting`、YouTube 与本机服务地址；没有所有网站的常驻权限、浏览历史、Cookies、调试器或视频下载权限。通用网页仅在用户点击后向当前主文档注入翻译脚本。
- YouTube 登录 Cookie 仅由该网页向原站请求字幕时使用，不发送给翻译服务。服务收到的是待翻译的字幕/网页文本、语言、文本类型及临时 ID，不额外采集视频标题、页面 URL、账号信息或浏览历史；网页正文自身包含的个人信息仍会随正文发送。
- 模型输出严格校验条数和 ID；字幕只通过 `textContent` 显示，不执行字幕里的 HTML 或脚本。主页面消息桥无模型密钥或扩展权限。
- 模型数据保留政策由你的模型提供方决定。本地字幕缓存仅在进程内存中，不写字幕到磁盘；主动下载的字幕文件由你保管。
- 配对页链接将本地配对码放在 URL fragment（不随 HTTP 请求发送），页面载入后移除 fragment，并仅保留在当前标签页 sessionStorage。不要分享该链接。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run check
npm run package
```

运行本地服务后，可选择真实模型检查（**会产生调用用量**）：

```bash
node scripts/smoke-live.mjs
npm run test:browser
npm run test:page
node scripts/youtube-check.mjs --translate
```

浏览器测试优先用环境变量 `BROWSER_EXECUTABLE` 指定 Chromium；本机已安装 Chromium 的缓存路径有一个回退。其它机器可 `npx playwright install chromium` 后指定或使用默认路径。不要使用个人 Chrome Profile 做自动化测试；脚本创建独立空白配置目录。

`browser-test.mjs` 的受控字幕源只存在测试脚本中，线上插件不包含 mock provider。实际 YouTube 检查与 fixture 联调分开报告。测试截图在 `.local/screenshots/`。无需网络或模型费用的测试用 `npm test`。

## HTTP 合同

- `GET /api/health`：公开健康检查，返回服务名、版本、模型、是否配置凭证，不验证凭证是否仍有效。
- `GET /api/status`：需 `Authorization: Bearer <本地配对码>`。
- `POST /api/translate`：同上，JSON 请求：

```json
{"sourceLanguage":"en","targetLanguage":"zh-Hans","cues":[{"id":"cue-1","text":"Hello."}]}
```

全页面翻译请求使用相同接口，增加 `"kind":"page"` 字段；其模型提示词和缓存与字幕分开。未传 `kind` 时仍兼容 v1 字幕请求。

成功：

```json
{"ok":true,"data":{"translations":[{"id":"cue-1","text":"你好。"}],"cached":0}}
```

失败：`{"ok":false,"error":{"code":"MODEL_NOT_CONFIGURED"}}`。前端按界面语言翻译错误码。每次最多 24 条、每条 2000 字符、整批 12000 字符；插件使用更保守的 20 条 / 6000 字符批次。

---

## English quick start

1. Install Node.js **22.9+**. On macOS run `start.command`, or run `npm ci --ignore-scripts && npm run build && npm run package && npm start`.
2. Open the paired setup page using `open-setup.command`. Download and unzip the extension, or use `dist/extension` directly.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Copy the local pairing code from setup into the extension's **Connection settings**. This is **not** a model API key.
5. Open or refresh a captioned YouTube video. Choose a target language; download bilingual SRT/WebVTT after the entire track finishes translating.

**Credentials:** no distributable built-in model token is included. The current development process uses existing environment credentials; automatic credential persistence was blocked. Configure your own authorized credentials in `.env` or the launch environment before independently restarting. Provider charges may apply. `ANTHROPIC_BASE_URL` + bearer token is for an existing Messages-compatible gateway; its model names are gateway-specific. Official API defaults to `claude-opus-5-5` via the official SDK, with default server-side refusal fallback enabled.

**Verification boundary:** the real server/model and real MV3 extension with a controlled, playing video fixture were verified. A live YouTube test discovered 65 tracks, but both native CC and extension caption requests returned empty HTTP 200 bodies in the isolated test browser. Full live-site operation is therefore not claimed as verified. Try normal sign-in, native CC, playback, and retry in your own Chrome; access restrictions are not bypassed.

**Scope:** draggable existing manual/auto-generated YouTube captions and on-demand visible main-document page text. No audio transcription, live transcription, dubbing or paywall/DRM bypass. Video captions support desktop `www.youtube.com`; page translation supports regular HTTP/HTTPS sites. A responsive UI does not imply Chrome mobile extension support.

**Privacy:** loopback-only backend, separate pairing token, model keys server-side, no subtitle HTML execution, no video/history uploads. Caption text is sent to your configured model provider. Release archives exclude all credentials and local browser data.
