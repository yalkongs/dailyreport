#!/bin/bash
# 맥미니 아침 트리거·도착 감시(launchd) 설치/제거.
#   ops/macmini/install.sh            설치(재설치 포함) — 옛 라벨은 모두 내리고 새 라벨 2개만 설치
#   ops/macmini/install.sh uninstall  제거(옛 라벨 + 새 라벨 전부)
# morning = 06:40·07:20 월~금 리포트 생성 dispatch(dispatch.sh both),
# monitor = 07:45 월~금 도착 감시 dispatch(monitor.sh all).
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
# 제거 대상: 개편 전 4개(market·etf·monitor.market·monitor.etf) + 새 2개. 재설치 때도 전부 내린다.
OLD_LABELS=(com.yalkongs.dailyreport.market com.yalkongs.dailyreport.etf
            com.yalkongs.dailyreport.monitor.market com.yalkongs.dailyreport.monitor.etf
            com.yalkongs.dailyreport.morning com.yalkongs.dailyreport.monitor)
# 설치 대상: 새 2개뿐.
INSTALL_LABELS=(com.yalkongs.dailyreport.morning com.yalkongs.dailyreport.monitor)
DOMAIN="gui/$(id -u)"

for label in "${OLD_LABELS[@]}"; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done

if [ "${1:-}" = "uninstall" ]; then
  echo "제거 완료"
  exit 0
fi

# launchd는 job 시작 전에 로그 파일을 연다 — 디렉터리가 먼저 있어야 한다.
mkdir -p "$HOME/Library/Logs/dailyreport"
for label in "${INSTALL_LABELS[@]}"; do
  plutil -lint "$HERE/$label.plist" >/dev/null
  cp "$HERE/$label.plist" "$AGENTS/"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
  echo "설치: $label"
done
launchctl list | grep dailyreport || true
