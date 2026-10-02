#!/usr/bin/env bash
# Builds the zip to upload to the Chrome Web Store, with only the files the extension needs.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="spoilerguard-$version.zip"
rm -f "$out"
zip -qr "$out" manifest.json icons src models packs -x '*.DS_Store'
echo "$out ($(du -h "$out" | cut -f1))"
