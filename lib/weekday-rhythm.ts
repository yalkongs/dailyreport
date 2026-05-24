// lib/weekday-rhythm.ts
//
// Phase E3 (2026-05-24): 요일 리듬 — 월·금이 화·수·목과 다른 톤을 갖도록.
// Market·ETF 양쪽에서 공유.
//
// 본 모듈은 순수 함수. dayOfWeek 만 받아 어울리는 가이드 문자열을 반환.

export type WeekdayRole = "monday_setup" | "midweek" | "friday_recap";

/**
 * YYYY-MM-DD 또는 Date 객체에서 KST 기준 요일 → 역할 결정.
 * 토·일은 (cron 이 안 돌지만) 안전상 midweek 로 처리.
 */
export function getWeekdayRole(date: string | Date): WeekdayRole {
  // YYYY-MM-DD 문자열은 캘린더 날짜로 결정론적 처리 (TZ 무관).
  let dow: number;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split("-").map(Number);
    dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  } else {
    dow = (date instanceof Date ? date : new Date(date)).getDay();
  }
  if (dow === 1) return "monday_setup";
  if (dow === 5) return "friday_recap";
  return "midweek";
}

/**
 * 프롬프트에 주입할 요일별 가이드.
 * Market·ETF 공통 톤 차이를 강제하는 줄거리만 명시. 세부 섹션 변형은
 * 각 클라이언트가 알아서.
 */
export function describeWeekdayRhythm(role: WeekdayRole, reportType: "market" | "etf"): string {
  if (role === "monday_setup") {
    const extra = reportType === "market"
      ? "주말 사이 발생한 해외 뉴스·정책 변화를 본문 앞부분에서 한 단락으로 정리하고, 이번 주 관전 포인트(주요 발표·결정 일정) 를 watchPoints 또는 caleandar 에서 강조."
      : "주말 사이 미국·유럽 시장 변동과 환율 야간 흐름을 bigPicture 첫 문장에 녹이고, 이번 주 관전 ETF군(반도체·환노출·채권 등 중 한 그룹) 을 closingLine 으로 명시."
    return `\n[요일 리듬 — 월요일 셋업]\n- 오늘은 한 주의 첫 영업일입니다. ${extra}\n- 헤드라인은 "주말 뒤 시작" 의 의미가 묻어나도록.\n`
  }
  if (role === "friday_recap") {
    const extra = reportType === "market"
      ? "한 주 동안의 winner/loser 자산군 한 줄씩, 다음 주에 살펴볼 변수(미국 지표 발표·한국 매크로 등) 를 soWhat 또는 calendar 에서 정리."
      : "한 주의 ETF winner/loser 를 closingLine 직전에 짧게 회고, 다음 주에 살펴볼 ETF 군이나 지표를 closingLine 으로 닫음."
    return `\n[요일 리듬 — 금요일 회수]\n- 오늘은 한 주의 마지막 영업일입니다. ${extra}\n- 헤드라인은 "한 주를 닫는" 톤. "이번 주 X를 정리한 X요일" 같은 회고 색을 입혀도 좋음.\n`
  }
  // midweek (화·수·목)
  return ""; // 별도 가이드 없음 — 표준 동작 유지
}
