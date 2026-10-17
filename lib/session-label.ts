// lib/session-label.ts
// M6 (Ruling 26): 두 리포트 화면의 고정 라벨에 쓰는 '직전 한국 거래일' 이름.
// "어제"는 화~금 평일에만 맞다 — 월요일에는 지난 금요일, 휴장을 건너뛴 날은 직전 거래일이다.
// 모델이 쓴 문장은 바꾸지 않는다(프롬프트의 시점 블록이 따로 다룬다). KR 휴일 달력(market-calendar)을 쓴다.

import { dayOfWeek, getPrevTradingDay } from "./market-calendar";

export type PreviousSessionLabel = "어제" | "지난 금요일" | "직전 거래일";

function calendarDaysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * reportDate(YYYY-MM-DD, KST 발행일)의 직전 한국 거래일을 화면 라벨로.
 *  - 직전 거래일이 바로 전날 → '어제'
 *  - 월요일이고 직전 거래일이 그 주 금요일(3일 전) → '지난 금요일'
 *  - 그 밖(휴장을 건너뜀) → '직전 거래일'
 */
export function previousSessionLabel(reportDate: string): PreviousSessionLabel {
  const gap = calendarDaysBetween(getPrevTradingDay(reportDate, "kr"), reportDate);
  if (gap === 1) return "어제";
  if (dayOfWeek(reportDate) === 1 && gap === 3) return "지난 금요일";
  return "직전 거래일";
}
