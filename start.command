#!/bin/zsh
set -eu
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null; then
  printf '请安装 Node.js 22.9 或更新版本。 / Install Node.js 22.9 or later.\n'
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci --ignore-scripts; fi
if [[ ! -f dist/extension/manifest.json ]]; then npm run build; fi
if [[ ! -f releases/captionbridge-extension.zip ]]; then npm run package; fi
node --env-file-if-exists=.env scripts/launcher.mjs start
