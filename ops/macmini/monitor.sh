#!/bin/bash
# 맥미니 launchd가 호출하는 도착 감시 트리거 — GitHub delivery-monitor.yml을 workflow_dispatch로 1회 요청한다.
# 실제 판정은 GitHub Actions(scripts/check-delivery.ts)에서 돈다: 영업일인데 telegram 발송이
# success가 아니면 그 job이 실패하고 GitHub가 소유자에게 메일을 보낸다. 여기는 dispatch.sh와 같은
# "알람 시계" 역할만 한다(감사 F06).
#
#   monitor.sh all              07:45 KST 월~금 — 마켓·ETF 둘 다 판정, launchd plist(com.yalkongs.dailyreport.monitor)
#   monitor.sh market|etf       한쪽만 수동 점검용
#
# ⚠️ 파일명으로 dispatch한다 — delivery-monitor.yml이 main(기본 브랜치)에 머지된 뒤에만 동작한다.
#    맥미니가 죽은 날은 delivery-monitor.yml의 schedule(늦은 백업)이 대신한다.
set -u

KIND="${1:-}"
case "$KIND" in
  market|etf|all) ;;
  *) echo "usage: monitor.sh market|etf|all" >&2; exit 2 ;;
esac

REPO="yalkongs/dailyreport"
WORKFLOW="delivery-monitor.yml"
GH="${GH:-/opt/homebrew/bin/gh}"
LOG_DIR="$HOME/Library/Logs/dailyreport"
LOG="$LOG_DIR/monitor.log"
mkdir -p "$LOG_DIR"

log() { echo "$(date '+%F %T %Z') [monitor:$KIND] $*" >> "$LOG"; }

args=(workflow run "$WORKFLOW" --repo "$REPO" --ref main -f "kind=$KIND")

# 부팅 직후·네트워크 순단 대비 30초 간격 3회 (dispatch.sh와 동일).
for attempt in 1 2 3; do
  if out=$("$GH" "${args[@]}" 2>&1); then
    log "dispatch ok (attempt $attempt)"
    exit 0
  fi
  log "dispatch 실패 (attempt $attempt): $out"
  [ "$attempt" -lt 3 ] && sleep "${RETRY_SLEEP:-30}"
done
exit 1
