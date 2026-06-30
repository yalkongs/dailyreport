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
  const todayMarker = e.date === todayDate ? " (오늘)" : "";
  const desc = e.description ? ` — ${e.description}` : "";
  return `${md}(${dow}) ${stars} ${e.name}${todayMarker}${desc}`;
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
