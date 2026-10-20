// lib/session-label.ts
// M6 (Ruling 26): 두 리포트 화면의 고정 라벨에 쓰는 '직전 한국 거래일' 이름.
// "어제"는 화~금 평일에만 맞다 — 월요일에는 지난 금요일, 휴장을 건너뛴 날은 직전 거래일이다.
// 모델이 쓴 문장은 바꾸지 않는다(프롬프트의 시점 블록이 따로 다룬다). KR 휴일 달력(market-calendar)을 쓴다.

import { dayOfWeek, getPrevTradingDay, koreanWeekday } from "./market-calendar";

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

/**
 * Ruling 40 (2026-10-20): 미국 직전 거래일(US 휴일 달력)이 한국 직전 거래일과 다른 날만 그 날짜 "M/D(요일)" — 같은 날은 null.
 * 위 라벨은 한국 달력이라, 미국만 휴장했거나(11/27: 한국 11/26 · 미국 11/25 추수감사절) 한국만 휴장한(10/12: 한국 10/08 · 미국 10/09)
 * 다음 날에는 미국 숫자가 다른 날 종가다. ETF Today가 미국 숫자 옆에 이 날짜를 밝힌다.
 */
export function usPreviousSessionDate(reportDate: string): string | null {
  const us = getPrevTradingDay(reportDate, "us");
  if (us === getPrevTradingDay(reportDate, "kr")) return null;
  return `${Number(us.slice(5, 7))}/${Number(us.slice(8, 10))}(${koreanWeekday(us)})`;
}

/** 미국 직전 거래일이 한국과 다른 날만 "미국은 M/D(요일) 종가" — 같은 날은 null. */
export function usPreviousSessionNote(reportDate: string): string | null {
  const date = usPreviousSessionDate(reportDate);
  return date ? `미국은 ${date} 종가` : null;
}
