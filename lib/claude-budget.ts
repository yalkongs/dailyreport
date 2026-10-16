// lib/claude-budget.ts
// F07 (2026-10-16 감사): AI 호출의 시간 예산. SDK 기본값(요청당 10분·재시도 2회)에 파이프라인 재시도가
// 겹치면 job 상한(Market 20분·ETF 15분)을 넘겨 중간에 죽을 수 있었다. 요청 상한을 두고, 생성 단계 전체
// 예산을 넘기면 새 호출을 시작하지 않는다(다음 트리거가 새 runner에서 재시도한다).

export const CLAUDE_REQUEST_TIMEOUT_MS = 6 * 60_000
export const CLAUDE_MAX_RETRIES = 1
// 한 번의 생성 호출에 보통 걸리는 시간(관측 2~4분). 새 호출을 시작할지 판단할 때 쓴다.
export const TYPICAL_CALL_MS = 3 * 60_000

export const MARKET_GENERATION_BUDGET_MS = 14 * 60_000
export const ETF_GENERATION_BUDGET_MS = 10 * 60_000

export function makeDeadline(budgetMs: number, now: () => number = Date.now) {
  const start = now()
  return {
    elapsedMs: () => now() - start,
    canStartCall: (estimateMs: number = TYPICAL_CALL_MS) => now() - start + estimateMs <= budgetMs,
  }
}
