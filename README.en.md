# CaptionBridge

**Good stories. Beyond language.**

[English](README.en.md) · [简体中文](README.md)

## What is CaptionBridge?

CaptionBridge is a local-first Chrome translation extension for understanding videos and web pages without losing the original context. It displays draggable, time-aligned bilingual YouTube captions, exports complete SRT/WebVTT subtitle files, and translates entire web pages on demand with one-click restoration.

The project ships a **Manifest V3 extension**, a **Node.js translation server**, and a **Chinese/English setup interface**. Credentials stay on the server, not in the extension. Connect a model provider you are authorized to use; no free, embedded, or transferable model token is included.

This is independent software, not an Immersive Translate product or a clone of its entire paid feature set.

## Features (v2)

- Drag captions vertically or horizontally, including while paused; the position is remembered relative to the player and adapts to fullscreen and resizing.
- Keyboard-accessible caption handle: arrow keys move, Shift + arrows makes larger adjustments, Home resets. Moving never retriggers translation.
- Translate visible page text on demand, choose translation-only or bilingual mode, and restore originals without replacing page element identities or form values.
- Dynamically added text is translated while page translation is active; restoring originals cancels future work and ignores late results.
- Automatically translates existing manual and auto-generated YouTube captions.
- Shows bilingual captions synchronized with playback, seeking, and playback rate.
- Exports original text + translation + precise timestamps as SRT or WebVTT.
- Downloads are enabled only after the complete caption track is translated.
- Chinese/English interface switch persists the choice without resetting translation progress.
- Localhost-only backend, independent pairing token, bounded requests, and in-memory translation cache.
- Model authentication stays on the server. No video, browsing history, or YouTube cookie uploads to the translation service.

## Full-page translation

Click the extension's **toolbar icon on the target HTTP/HTTPS page**, choose **Web pages**, select your target language and display mode, then click **Translate entire page**. No page text is collected until this action. **Restore original** stops processing and restores exact originals; newer changes made by the page itself are preserved. Switching display mode or interface language reuses translations.

The extension adds `scripting`, not permanent access to all sites. General page injection uses temporary `activeTab` access granted by clicking the toolbar icon. Chrome internal pages and the Web Store block injection. Form values/passwords, editable areas, code, hidden content, and `translate="no"` are skipped. Visible personal information in ordinary prose is still sent to your configured model when you activate translation; do not enable it on sensitive pages.

Supported content is ordinary visible main-document light-DOM text. Attribute values (such as placeholders/alt text), frames, Shadow DOM, images/OCR, PDF, and canvas are not translated. Caps are 5,000 text nodes / 500,000 source UTF-16 characters. Oversized pages report an error instead of claiming complete translation. Dynamic content processing stops when you restore originals; accepted model requests may still be billed.

For v1 upgrades, load/build v2, reload the extension in `chrome://extensions`, and refresh the target page. The subtitle interface includes **Reset caption position**.

## Quick start

Requirements: **Node.js 22.9+**, desktop **Chrome 111+**.

```bash
npm ci --ignore-scripts
npm run build
npm run package
```

Create your private `.env` from `.env.example` and configure an authorized API credential. Then run:

```bash
npm start
```

On macOS, `start.command` installs dependencies if needed, builds the extension, starts the service, and opens setup. `open-setup.command` opens setup for an already running service. `stop.command` stops a launcher-managed service.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked**, selecting `dist/extension/` or an unzipped extension release.
3. Open the local setup page through the launcher and copy its **pairing code**.
4. Paste the code into the extension's **Connection settings**, with server address `http://127.0.0.1:8787`, and save/test.
5. Open or refresh a captioned YouTube video. Select your target language. Download SRT or WebVTT when all cues finish translating.

## Model configuration

Official Anthropic API:

```dotenv
PORT=8787
TRANSLATION_MODEL=claude-opus-5-5
ANTHROPIC_API_KEY=YOUR_OWN_API_KEY
```

Existing Anthropic Messages-compatible gateway:

```dotenv
PORT=8787
TRANSLATION_MODEL=YOUR_GATEWAY_MODEL_ID
ANTHROPIC_BASE_URL=http://127.0.0.1:YOUR_GATEWAY_PORT
ANTHROPIC_AUTH_TOKEN=YOUR_AUTHORIZED_GATEWAY_TOKEN
```

Gateway model names are specific to that gateway; compatibility does not imply the underlying model is an Anthropic model. The development environment verified its available `claude-gpt-6-astra` gateway identifier. Configure your own credentials independently; development-session credentials are not distributed or automatically persisted.

Environment variables take precedence over `.env`. Clear unrelated old provider variables when switching providers. API charges may apply, particularly for long videos. Disable automatic subtitles to stop subsequent batches; already issued requests may still finish and incur charges.

## Architecture

```text
YouTube player → page bridge → isolated caption engine
                                      ↓
                              extension service worker
                                      ↓
                          localhost API + pairing token
                                      ↓
                            configured model provider
```

`extension/` contains the browser client, `server/` the API and model adapter, `web/` the setup UI, `scripts/` build and verification utilities, and `tests/` automated checks. `dist/extension/` is loadable in Chrome. `releases/` contains client-only and full-source archives.

Generated archives exclude `.env`, `.local`, browser profiles, logs, screenshots, and `node_modules`. Do not zip your entire working directory for distribution after adding credentials.

## Validation and known limitations

Local version tags preserve the v1 baseline (`v1.0.0`) and this upgrade (`v2.0.0`); GitHub repository creation/push is pending execution-environment authorization.

V2 browser tests verified mouse dragging, keyboard movement, fullscreen bounds, pause visibility, and real-model page translation/restoration. Deterministic adverse-provider tests separately cover private-field exclusions, retained handlers, modes, dynamic text, cancellation, literal markup, and explicit size caps.

The API and actual model were tested. A real Chromium MV3 extension with a controlled playing-video/caption fixture verified the complete bridge → server → model → overlay → bilingual download path, along with desktop/mobile-width Chinese/English layouts.

**Live YouTube was not fully verified:** the isolated browser discovered 65 tracks on the test video, but both native CC and extension caption requests returned empty HTTP 200 bodies. This is not represented as a passing live-site test. In your normal browser, enable CC, play briefly, then retry. Sign in normally if required by the video. Access restrictions are not bypassed.

Video captions support desktop `www.youtube.com` with readable existing tracks; page translation supports ordinary HTTP/HTTPS main documents. There is no audio transcription, live transcription, dubbing, DRM/paywall bypass, or Chrome Web Store publishing. Responsive layouts do not imply Chrome mobile can install extensions. YouTube's internal caption behavior may change.

## Security and privacy

- The backend binds only to `127.0.0.1` and checks Host, Origin, and a random local pairing token.
- Request size, batch size, concurrency, and rate are bounded.
- Subtitle and model output use `textContent`, never executable HTML.
- Page-world code has no extension APIs or model credentials.
- Captions or explicitly selected page text are sent to your configured model provider; its data-retention terms apply. No browsing history or cookies are collected; visible page prose can itself contain personal information.
- Translations are cached only in memory, bounded to 500 batches and 24 hours; restart clears them.
- Never share your pairing URL or model credentials.

## Development checks

```bash
npm test
npm run check
npm run build
npm run package
```

With a configured running server, the following checks invoke the actual model and can incur API usage:

```bash
node scripts/smoke-live.mjs
npm run test:browser
npm run test:page
node scripts/youtube-check.mjs --translate
```

Set `BROWSER_EXECUTABLE` to an installed Chromium binary when needed. Browser checks create separate empty profiles, not your personal Chrome profile. Controlled fixtures and live-site results are reported separately.
