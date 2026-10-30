// lib/kr-macro-calendar.ts
//
// 한국 매크로 이벤트 캘린더 reader.
// (Phase F1 — 2026-05-24 설계)
//
// 데이터는 별도 weekly cron(scripts/refresh-kr-macro.ts)이 Anthropic
// web_search 로 갱신해 data/kr-macro-calendar.json 에 캐시한다.
// 본 모듈은 그 캐시를 안전하게 읽어 일일 Market 파이프라인에 제공한다.
//
// **graceful fallback 원칙**: 캐시 파일이 없거나 형식이 깨져 있어도
// 절대 throw 하지 않고 빈 배열을 반환. 결과적으로 프롬프트 블록이
// 빈 문자열이 되어 기존 동작과 100% 동일하게 작동.

import * as fs from "fs";
import * as path from "path";
import { koreanWeekday } from "./market-calendar";

export type KrMacroCategory =
  | "bok_mpb"       // 한국은행 금통위
  | "cpi"           // 소비자물가지수
  | "employment"    // 고용지표
  | "gdp"           // 국내총생산
  | "trade"         // 수출입·무역수지
  | "industrial"    // 산업생산
  | "bok_outlook"   // 한국은행 경제전망
  | "futures_expiry" // 선물·옵션 만기
  | "other";

export interface KrMacroEvent {
  date: string;            // YYYY-MM-DD (KST)
  category: KrMacroCategory;
  name: string;            // "한국은행 금융통화위원회"
  importance: 1 | 2 | 3 | 4 | 5;
  description?: string;    // 짧은 컨텍스트
  source?: string;         // 출처 URL 또는 라벨 (운영자 검증용)
  // C03 (2026-10-16): 공식 기관 일정에서 날짜를 확인했으면 true, 관례·패턴 추정이면 false.
  confirmed?: boolean;
  time?: string;           // 발표 시각 "HH:MM" (KST, 확인된 경우만)
}

/**
 * 추정 일정 판정. confirmed 필드가 없던 옛 캐시는 description 의 추정 표기로 판단한다.
 * (10/15 고용동향: 설명엔 '입력예정일 10-16 · 추정'인데 date 10-15 로 들어가 '오늘'로 승격됐다.)
 */
export function isEstimatedKrMacroEvent(e: KrMacroEvent): boolean {
  if (e.confirmed === true) return false;
  if (e.confirmed === false) return true;
  return /추정|잠정|관례|예상일|전후/.test(e.description ?? "");
}

// 국가데이터처 「2026년 물가, 고용, 산업활동동향 보도계획」(https://sri.kostat.go.kr/ansk/file/schedule_2026.pdf).
// 웹 검색은 이 세 지표의 날짜를 틀리게 가져온 적이 있다(10월 CPI: 공식 11/3인데 캐시 11/2, confirmed:true).
// 표가 덮는 연도에서는 이 표가 유일한 출처다. 새해 보도계획이 나오면 행을 추가할 것.
const KOSTAT_SOURCE = "mods.go.kr (국가데이터처 공식 보도계획)";
const KOSTAT_PLAN: Array<[date: string, category: "cpi" | "employment" | "industrial", refMonth: string]> = [
  ["2026-01-14", "employment", "2025년 12월 및 연간"],
  ["2026-01-30", "industrial", "2025년 12월 및 연간"],
  ["2026-02-03", "cpi", "2026년 1월"],
  ["2026-02-11", "employment", "2026년 1월"],
  ["2026-03-04", "industrial", "2026년 1월"],
  ["2026-03-06", "cpi", "2026년 2월"],
  ["2026-03-18", "employment", "2026년 2월"],
  ["2026-03-31", "industrial", "2026년 2월"],
  ["2026-04-02", "cpi", "2026년 3월"],
  ["2026-04-15", "employment", "2026년 3월"],
  ["2026-04-30", "industrial", "2026년 3월"],
  ["2026-05-06", "cpi", "2026년 4월"],
  ["2026-05-13", "employment", "2026년 4월"],
  ["2026-05-29", "industrial", "2026년 4월"],
  ["2026-06-02", "cpi", "2026년 5월"],
  ["2026-06-11", "employment", "2026년 5월"],
  ["2026-06-30", "industrial", "2026년 5월"],
  ["2026-07-02", "cpi", "2026년 6월"],
  ["2026-07-15", "employment", "2026년 6월"],
  ["2026-07-31", "industrial", "2026년 6월"],
  ["2026-08-04", "cpi", "2026년 7월"],
  ["2026-08-12", "employment", "2026년 7월"],
  ["2026-08-31", "industrial", "2026년 7월"],
  ["2026-09-02", "cpi", "2026년 8월"],
  ["2026-09-09", "employment", "2026년 8월"],
  ["2026-09-30", "industrial", "2026년 8월"],
  ["2026-10-02", "cpi", "2026년 9월"],
  ["2026-10-16", "employment", "2026년 9월"],
  ["2026-10-30", "industrial", "2026년 9월"],
  ["2026-11-03", "cpi", "2026년 10월"],
  ["2026-11-11", "employment", "2026년 10월"],
  ["2026-11-30", "industrial", "2026년 10월"],
  ["2026-12-02", "cpi", "2026년 11월"],
  ["2026-12-16", "employment", "2026년 11월"],
  ["2026-12-30", "industrial", "2026년 11월"],
  ["2026-12-31", "cpi", "2026년 12월 및 연간"],
];
const KOSTAT_TITLE = { cpi: "소비자물가동향", employment: "고용동향", industrial: "산업활동동향" } as const;
const KOSTAT_IMPORTANCE = { cpi: 5, employment: 4, industrial: 3 } as const;
const KOSTAT_YEARS = new Set(KOSTAT_PLAN.map(([d]) => d.slice(0, 4)));
const KOSTAT_REF_MONTHS = new Set(KOSTAT_PLAN.map(([, category, refMonth]) => `${category}:${refMonth.match(/^\d{4}년 \d{1,2}월/)![0]}`));
// 같은 캐시에 미국 CPI·고용보고서도 들어온다(category가 cpi·employment일 수 있음) — 카테고리가 아니라 이름으로 시리즈를 가린다.
const FOREIGN_RE = /미국|美|\bUS\b|중국|일본|유로|ECB|BLS/i;

function kostatSeries(name: string): "cpi" | "employment" | "industrial" | null {
  if (FOREIGN_RE.test(name)) return null;
  if (/소비자물가|CPI/i.test(name)) return "cpi";
  if (/고용동향/.test(name)) return "employment";
  if (/산업활동|산업생산/.test(name)) return "industrial";
  return null;
}

/** 공식표가 이 검색 결과를 덮는가 — 이름의 대상 월이 표에 있거나, 대상 월이 없으면 발표 연도가 표에 있을 때. */
function coveredByKostatPlan(e: KrMacroEvent): boolean {
  const series = kostatSeries(e.name);
  if (!series) return false;
  const ref = e.name.match(/(\d{4})년\s*(\d{1,2})월/);
  if (ref) return KOSTAT_REF_MONTHS.has(`${series}:${ref[1]}년 ${Number(ref[2])}월`);
  return KOSTAT_YEARS.has(e.date.slice(0, 4));
}

/**
 * 웹 검색 결과에서 국가데이터처 3대 지표(CPI·고용·산업활동)를 공식 보도계획으로 교체한다.
 * 공식표가 덮는 검색 결과는 버리고 [start, end] 안의 공식 일정을 넣는다.
 * 덮지 않는 대상 월(새해 계획 미등록)은 검색 결과를 그대로 둔다.
 */
export function applyKostatOfficialPlan(events: KrMacroEvent[], start: string, end: string): KrMacroEvent[] {
  const kept = events.filter((e) => !coveredByKostatPlan(e));
  const official: KrMacroEvent[] = KOSTAT_PLAN
    .filter(([date]) => date >= start && date <= end)
    .map(([date, category, refMonth]) => ({
      date,
      category,
      name: `${KOSTAT_TITLE[category]} 발표 — ${refMonth}`,
      importance: KOSTAT_IMPORTANCE[category],
      description: "국가데이터처 공식 보도계획에 명시된 공표일.",
      source: KOSTAT_SOURCE,
      confirmed: true,
      time: "08:00",
    }));
  return [...kept, ...official].sort((a, b) => a.date.localeCompare(b.date));
}

export interface KrMacroCalendarCache {
  generatedAt: string;     // ISO 8601, refresh 시각
  weekRangeStart: string;  // YYYY-MM-DD
  weekRangeEnd: string;    // YYYY-MM-DD
  events: KrMacroEvent[];
}

const CACHE_PATH = path.join(process.cwd(), "data", "kr-macro-calendar.json");

/**
 * 캐시 파일을 안전하게 읽음. 파일 없음/parse 실패 시 null 반환.
 */
export function loadKrMacroCache(): KrMacroCalendarCache | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as KrMacroCalendarCache;
    // 최소 schema 검증
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 오늘 기준 ±daysAhead 일 윈도우 안의 이벤트를 반환.
 * (오늘 포함, 과거 1일은 포함하여 어제 발표된 지표도 포함 가능)
 */
export function getUpcomingKrMacroEvents(
  today: string,
  daysAhead = 7,
): KrMacroEvent[] {
  const cache = loadKrMacroCache();
  if (!cache) return [];

  const todayTs = Date.parse(today + "T00:00:00+09:00");
  const yesterdayTs = todayTs - 24 * 3600 * 1000;
  const futureTs = todayTs + daysAhead * 24 * 3600 * 1000;

  return cache.events
    .filter((e) => {
      try {
        // event 형식 검증
        if (!e || typeof e !== "object") return false;
        if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return false;
        if (typeof e.name !== "string" || !e.name.trim()) return false;
        const ts = Date.parse(e.date + "T00:00:00+09:00");
        if (!Number.isFinite(ts)) return false;
        return ts >= yesterdayTs && ts <= futureTs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 프롬프트용 한 줄 포맷.
 * 예: "5/30(금) ★★★★★ 한국은행 금융통화위원회"
 */
export function formatKrMacroEventLine(e: KrMacroEvent, todayDate?: string): string {
  const stars = "★".repeat(e.importance) + "☆".repeat(5 - e.importance);
  const md = e.date.slice(5).replace("-", "/"); // 05-30 → 05/30
  const dow = koreanWeekday(e.date);
  const estimated = isEstimatedKrMacroEvent(e);
  // 추정 일정에는 '(오늘)'을 붙이지 않는다 — 확정 당일 변수로 승격되는 것을 막는다.
  const todayMarker = e.date === todayDate && !estimated ? " (오늘)" : "";
  const status = estimated ? " [발표일 추정 — 확정 아님]" : e.time ? ` ${e.time} KST` : "";
  const desc = e.description ? ` — ${e.description}` : "";
  return `${md}(${dow}) ${stars} ${e.name}${todayMarker}${status}${desc}`;
}

/**
 * 캐시의 신선도를 사람이 읽기 좋게.
 */
export function describeCacheFreshness(cache: KrMacroCalendarCache | null): string {
  if (!cache) return "캐시 없음";
  try {
    const ts = Date.parse(cache.generatedAt);
    if (!Number.isFinite(ts)) return "생성 시각 불명";
    const hoursAgo = Math.round((Date.now() - ts) / 3_600_000);
    return `${hoursAgo}시간 전 갱신 (${cache.events.length}개 이벤트)`;
  } catch {
    return "캐시 정보 불명";
  }
}
