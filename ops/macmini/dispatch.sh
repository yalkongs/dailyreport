#!/bin/bash
# 맥미니 launchd가 호출하는 아침 트리거 — GitHub workflow_dispatch를 1회 요청한다.
# 실제 생성·발송은 GitHub Actions에서 돈다. 여기는 "알람 시계" 역할만.
#
#   dispatch.sh market|etf          정시/2차 트리거
#   DRY_RUN=1 dispatch.sh market    dry_run=true로 요청 (발송·커밋 없음, 점검용)
#
# 같은 시각 cron-job.org(보험)도 같은 요청을 보낼 수 있다 — job concurrency와
# 중복 가드·발송 상태(scripts/delivery-state.ts)가 두 번째 요청을 skip시킨다.
set -u

ONLY="${1:-}"
case "$ONLY" in
  market|etf) ;;
  *) echo "usage: dispatch.sh market|etf" >&2; exit 2 ;;
esac

REPO="yalkongs/dailyreport"
WORKFLOW_ID="260067407"   # 파일명 대신 ID — README "아침 트리거"와 동일
GH="${GH:-/opt/homebrew/bin/gh}"
LOG_DIR="$HOME/Library/Logs/dailyreport"
LOG="$LOG_DIR/trigger.log"
mkdir -p "$LOG_DIR"

log() { echo "$(date '+%F %T %Z') [$ONLY] $*" >> "$LOG"; }

args=(workflow run "$WORKFLOW_ID" --repo "$REPO" --ref main -f "only=$ONLY")
[ "${DRY_RUN:-}" = "1" ] && args+=(-f "dry_run=true")

# 부팅 직후·네트워크 순단 대비 30초 간격 3회. 이후 재시도는 2차 트리거가 맡는다.
for attempt in 1 2 3; do
  if out=$("$GH" "${args[@]}" 2>&1); then
    log "dispatch ok (attempt $attempt${DRY_RUN:+, dry_run})"
    exit 0
  fi
  log "dispatch 실패 (attempt $attempt): $out"
  [ "$attempt" -lt 3 ] && sleep "${RETRY_SLEEP:-30}"
done
exit 1
