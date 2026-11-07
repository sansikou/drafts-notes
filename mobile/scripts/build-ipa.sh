#!/usr/bin/env bash
# 在 macOS + Xcode 上运行，产出未签名/开发签名 IPA，再用全能签 + 个人 P12 重签安装。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run sync

SCHEME="App"
WORKSPACE="ios/App/App.xcworkspace"
if [[ ! -d "$WORKSPACE" ]]; then
  WORKSPACE="ios/App/App.xcodeproj"
fi

OUT="$ROOT/build"
ARCHIVE="$OUT/Drafts.xcarchive"
IPA_DIR="$OUT/ipa"
mkdir -p "$OUT" "$IPA_DIR"

# 不依赖付费开发者账号：先 archive，再手动打成 Payload IPA（全能签可重签）
xcodebuild \
  -project "ios/App/App.xcodeproj" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  archive

APP_PATH="$(find "$ARCHIVE/Products/Applications" -name "*.app" | head -n 1)"
if [[ -z "$APP_PATH" ]]; then
  echo "未找到 .app"
  exit 1
fi

STAGE="$OUT/PayloadStage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP_PATH" "$STAGE/Payload/"

IPA_OUT="$ROOT/../release/Drafts-ios-unsigned.ipa"
mkdir -p "$(dirname "$IPA_OUT")"
(
  cd "$STAGE"
  zip -r "$IPA_OUT" Payload >/dev/null
)

echo "IPA ready: $IPA_OUT"
echo "下一步：用全能签导入此 IPA，选择你的个人 P12 重签后安装。"
