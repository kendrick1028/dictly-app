#!/bin/bash
# Robust Dictly DMG build.
# Works around this Mac's financial security agents (nProtect/Delfino/TouchEn) which stamp
# com.apple.provenance on freshly-built files in the PROJECT dir, making codesign reject them
# ("...detritus not allowed"). Building in /tmp avoids their real-time scan, so signing succeeds.
# Requires electron-builder.yml to have: mac.timestamp: none, mac.icon, mac.afterPack (already set).
set -uo pipefail

# project root = one level up from this script (scripts/)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
if [ ! -f electron-builder.yml ]; then
  echo "ERROR: electron-builder.yml 없음 — Dictly 프로젝트 루트가 아님: $ROOT" >&2
  exit 1
fi

OUT=/tmp/dictly-dist
echo "▶ [1/6] 기존 빌드 프로세스 정리"
pkill -f "electron-builder" 2>/dev/null || true
pkill -f "app-builder" 2>/dev/null || true
sleep 1

echo "▶ [2/6] xattr 정리(보강) + /tmp 출력 준비"
xattr -cr python build 2>/dev/null || true
rm -rf "$OUT"
mkdir -p "$OUT" dist

echo "▶ [3/6] 렌더러 빌드 (electron-vite)"
npm run build || { echo "ERROR: electron-vite build 실패" >&2; exit 1; }

echo "▶ [4/6] /tmp 에 패키징 (보안 에이전트 스캔 회피, 서명 포함) — 10~20분 소요"
./node_modules/.bin/electron-builder --mac -c.directories.output="$OUT" || {
  echo "ERROR: electron-builder 실패 — 로그 확인. /tmp 빌드도 막히면 재부팅 후 재시도." >&2
  exit 1
}

echo "▶ [5/6] 코드서명 식별자 검증 (화면녹화/시스템오디오 권한의 핵심)"
APP="$OUT/mac-arm64/Dictly.app"
[ -d "$APP" ] || APP="$OUT/mac/Dictly.app"
# TCC binds the Screen-Recording grant to the app's designated requirement, which derives from the
# code-signing IDENTIFIER. It MUST be io.dictly.app on BOTH the bundle and the main executable.
BUNDLE_ID="$(codesign -dvv "$APP" 2>&1 | sed -n 's/^Identifier=//p')"
MAIN_ID="$(codesign -dvv "$APP/Contents/MacOS/Dictly" 2>&1 | sed -n 's/^Identifier=//p')"
echo "    bundle identifier = ${BUNDLE_ID:-(none)}"
echo "    main   identifier = ${MAIN_ID:-(none)}"
if [ "$BUNDLE_ID" != "io.dictly.app" ] || [ "$MAIN_ID" != "io.dictly.app" ]; then
  echo "ERROR: 코드서명 식별자가 io.dictly.app 가 아닙니다 (위 값 확인)." >&2
  echo "       → 화면녹화 권한(TCC)이 깨져 시스템 오디오 녹음이 안 됩니다. 배포 중단." >&2
  echo "       (디버깅용으로 $OUT 는 남겨둡니다.)" >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=1 "$APP" 2>&1 | tail -2 || true
codesign -dvv "$APP" 2>&1 | grep -iE "Authority=Apple Develop" | head -1 || true

echo "▶ [6/6] 릴리스 아티팩트 복사 + 정리"
DMG="$(find "$OUT" -name '*.dmg' | head -1)"
if [ -z "$DMG" ]; then
  echo "ERROR: DMG가 생성되지 않음" >&2
  exit 1
fi
# 자동 업데이트에는 ZIP + latest-mac.yml 이 필요하다 (Squirrel.Mac 은 DMG 를 못 씀).
# GitHub 릴리스에 dmg/zip/blockmap/latest-mac.yml 을 모두 올려야 업데이트가 동작한다.
ZIP="$(find "$OUT" -maxdepth 1 -name '*-mac.zip' | head -1)"
YML="$OUT/latest-mac.yml"
if [ -z "$ZIP" ] || [ ! -f "$YML" ]; then
  echo "WARN: ZIP 또는 latest-mac.yml 이 없습니다 — 자동 업데이트가 동작하지 않습니다." >&2
fi
for f in "$DMG" "$DMG.blockmap" "$ZIP" "${ZIP:+$ZIP.blockmap}" "$YML"; do
  [ -n "$f" ] && [ -f "$f" ] && cp "$f" dist/
done
SIZE=$(stat -f %z "$DMG")
rm -rf "$OUT"
echo ""
echo "🎉 완료 — dist/$(basename "$DMG")  (${SIZE} bytes, 식별자 io.dictly.app 검증됨)"
[ -n "$ZIP" ] && echo "   자동 업데이트용: dist/$(basename "$ZIP") + dist/latest-mac.yml"
echo ""
echo "── 설치 후 시스템 오디오 권한 재설정 (필요 시) ──"
echo "  새 앱을 /응용 프로그램 에 덮어쓴 뒤, 필요하면 터미널에서 한 번:"
echo "      tccutil reset ScreenCapture io.dictly.app"
echo "  그다음 Dictly 실행 → 권한 허용 → ⌘Q 로 완전 종료 후 재실행."
