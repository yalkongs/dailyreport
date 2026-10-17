#!/bin/bash
# 맥미니 launchd가 호출하는 아침 트리거 — GitHub workflow_dispatch를 1회 요청한다.
# 실제 생성·발송은 GitHub Actions에서 돈다. 여기는 "알람 시계" 역할만.
#
#   dispatch.sh both                06:40 정시·07:20 2차 트리거 — 마켓·ETF 리포트를 한 번에(launchd plist: com.yalkongs.dailyreport.morning)
#   dispatch.sh market|etf          한쪽만 수동 점검·재발행용
#   DRY_RUN=1 dispatch.sh both      dry_run=true로 요청 (발송·커밋 없음, 점검용)
#
# 요청이 겹쳐도(정시·2차·3순위 schedule·수동) job concurrency와
# 중복 가드·발송 상태(scripts/delivery-state.ts)가 뒤 요청을 skip시킨다.
set -u

ONLY="${1:-}"
case "$ONLY" in
  market|etf|both) ;;
  *) echo "usage: dispatch.sh market|etf|both" >&2; exit 2 ;;
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
