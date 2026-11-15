# CaptionBridge

**Good stories. Beyond language.**

[English](README.en.md) · [简体中文](README.md)

## What is CaptionBridge?

CaptionBridge is a local-first Chrome translation extension for understanding videos without losing the original language. It reads existing YouTube captions, displays time-aligned original text and translations, and exports complete bilingual SRT or WebVTT subtitle files.

The project ships a **Manifest V3 extension**, a **Node.js translation server**, and a **Chinese/English setup interface**. Credentials stay on the server, not in the extension. Connect a model provider you are authorized to use; no free, embedded, or transferable model token is included.

This is independent software, not an Immersive Translate product or a clone of its entire paid feature set.

## Version 1 features

- Automatically translates existing manual and auto-generated YouTube captions.
- Shows bilingual captions synchronized with playback, seeking, and playback rate.
- Exports original text + translation + precise timestamps as SRT or WebVTT.
- Downloads are enabled only after the complete caption track is translated.
- Chinese/English interface switch persists the choice without resetting translation progress.
- Localhost-only backend, independent pairing token, bounded requests, and in-memory translation cache.
- Model authentication stays on the server. No video, browsing history, or YouTube cookie uploads to the translation service.

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

The API and actual model were tested. A real Chromium MV3 extension with a controlled playing-video/caption fixture verified the complete bridge → server → model → overlay → bilingual download path, along with desktop/mobile-width Chinese/English layouts.

**Live YouTube was not fully verified:** the isolated browser discovered 65 tracks on the test video, but both native CC and extension caption requests returned empty HTTP 200 bodies. This is not represented as a passing live-site test. In your normal browser, enable CC, play briefly, then retry. Sign in normally if required by the video. Access restrictions are not bypassed.

Supported scope is desktop `www.youtube.com` with readable existing captions. There is no audio transcription, live transcription, dubbing, DRM/paywall bypass, or Chrome Web Store publishing. Responsive layouts do not imply Chrome mobile can install extensions. YouTube's internal caption behavior may change.

## Security and privacy

- The backend binds only to `127.0.0.1` and checks Host, Origin, and a random local pairing token.
- Request size, batch size, concurrency, and rate are bounded.
- Subtitle and model output use `textContent`, never executable HTML.
- Page-world code has no extension APIs or model credentials.
- Captions are sent to your configured model provider; its data-retention terms apply.
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
node scripts/youtube-check.mjs --translate
```

Set `BROWSER_EXECUTABLE` to an installed Chromium binary when needed. Browser checks create separate empty profiles, not your personal Chrome profile. Controlled fixtures and live-site results are reported separately.
