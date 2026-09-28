#!/bin/bash
# 맥미니 아침 트리거(launchd) 설치/제거.
#   ops/macmini/install.sh            설치(재설치 포함)
#   ops/macmini/install.sh uninstall  제거
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LABELS=(com.yalkongs.dailyreport.market com.yalkongs.dailyreport.etf)
DOMAIN="gui/$(id -u)"

for label in "${LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done

if [ "${1:-}" = "uninstall" ]; then
  echo "제거 완료"
  exit 0
fi

# launchd는 job 시작 전에 로그 파일을 연다 — 디렉터리가 먼저 있어야 한다.
mkdir -p "$HOME/Library/Logs/dailyreport"
for label in "${LABELS[@]}"; do
  plutil -lint "$HERE/$label.plist" >/dev/null
  cp "$HERE/$label.plist" "$AGENTS/"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
  echo "설치: $label"
done
launchctl list | grep dailyreport || true
