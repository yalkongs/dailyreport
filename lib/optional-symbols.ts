/**
 * 선택 지표 — 펼쳐 보기 카드·프롬프트에는 쓰지만 수집 실패율 가드·첫 화면 시장 요약 격자·횡보장 판정에는 넣지 않는다.
 * (업종 지수라 시장 전체 판정을 흔들고, 하나가 실패해도 리포트를 멈출 이유가 아니다. spec 2026-11-13-market-sox-design)
 */
export const OPTIONAL_SYMBOLS: ReadonlySet<string> = new Set(["^SOX"]);
