// lib/report-calendar.ts
//
// 마켓 리포트 '이번 주 주요 일정' 표를 코드가 만든다(2026-11-27).
// 전에는 미국 경제 캘린더가 비면 모델이 표를 썼고, 11-26 리포트가 "11/27 추수감사절 휴장"(실제 11/26)을 지어냈다.
// 출처: 미국 경제 캘린더(FRED 발표 일정) + 한국 매크로 일정(공식 일정표 덮어쓴 캐시, 추정 제외) + 휴장일 표.

import type { EconomicEvent, ReportCalendarItem } from "./types";
import { isEstimatedKrMacroEvent, type KrMacroEvent } from "./kr-macro-calendar";
import { marketHolidaysBetween } from "./market-calendar";

const US_HOLIDAY_KO: Record<string, string> = {
  "New Year's Day": "신정",
  "Martin Luther King Jr. Day": "마틴 루서 킹 데이",
  "Presidents' Day": "대통령의 날",
  "Good Friday": "성금요일",
  "Memorial Day": "메모리얼 데이",
  Juneteenth: "준틴스",
  "Independence Day": "독립기념일",
  "Independence Day (observed)": "독립기념일 대체 휴일",
  "Labor Day": "노동절",
  Thanksgiving: "추수감사절",
  Christmas: "성탄절",
};

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function md(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

interface Row extends ReportCalendarItem {
  sortKey: string;
}

export function buildReportCalendar(
  reportDate: string,
  economic: EconomicEvent[],
  krMacro: KrMacroEvent[],
  opts: { days?: number; max?: number } = {},
): ReportCalendarItem[] {
  const end = addDays(reportDate, opts.days ?? 7);
  const rows: Row[] = [];
  for (const e of economic) {
    const d = e.kstDate ?? e.date;
    if (d < reportDate || d > end || e.importance < 3) continue;
    rows.push({ date: md(d), country: e.country, event: e.time ? `${e.event} · ${e.time} KST` : e.event, importance: e.importance, sortKey: `${d} ${e.time ?? "99:99"}` });
  }
  for (const e of krMacro) {
    if (e.date < reportDate || e.date > end || e.importance < 3 || isEstimatedKrMacroEvent(e)) continue;
    rows.push({ date: md(e.date), country: "한국", event: e.time ? `${e.name} · ${e.time} KST` : e.name, importance: e.importance, sortKey: `${e.date} ${e.time ?? "99:99"}` });
  }
  for (const h of marketHolidaysBetween(reportDate, end)) {
    const name = h.market === "us" ? US_HOLIDAY_KO[h.name] ?? h.name : h.name;
    rows.push({
      date: md(h.date),
      country: h.market === "us" ? "미국" : "한국",
      event: `${name} — ${h.market === "us" ? "미국" : "국내"} 증시 휴장`,
      importance: 3,
      sortKey: `${h.date} 00:00`,
    });
  }
  return rows
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(0, opts.max ?? 8)
    .map((r) => ({ date: r.date, country: r.country, event: r.event, importance: r.importance }));
}
