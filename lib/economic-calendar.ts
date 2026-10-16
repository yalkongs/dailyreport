/**
 * 경제 캘린더 수집기
 * Primary: FRED releases API (안정적, API키 재사용)
 * 중요 지표 발표 일정 수집
 */

import { fetchWithTimeout } from "./fetch-utils";
import type { EconomicEvent } from "./types";
import { etToKst, describeKrSession } from "./release-time";

// 2026-10-16: 예전 구현은 전체 릴리스 일정(releases/dates)을 한 번에 받았는데, GitHub 러너에서 30초에도
// 응답이 없어 매일 타임아웃으로 비었다(응답 필드도 release_dates가 아닌 releases를 읽었다). 또 ID 표의 절반이
// 다른 지표였다(21=H.6 통화량, 19=H.3, 18=H.15 일간 금리, 83=없음). 운영 러너에서 ID·이름·다음 발표일을
// 확인한 주요 지표만 릴리스별(release/dates)로 병렬 조회한다. 진단: scripts/dev/fred-calendar-probe.ts
export interface ImportantRelease {
  id: number;
  name: string;
  importance: number;
  timeEt: string; // 공식 발표 시각(미국 동부 현지)
}

export const IMPORTANT_RELEASES: ImportantRelease[] = [
  { id: 10, name: "Consumer Price Index", importance: 5, timeEt: "08:30" },
  { id: 50, name: "Employment Situation", importance: 5, timeEt: "08:30" },
  { id: 46, name: "Producer Price Index", importance: 4, timeEt: "08:30" },
  { id: 53, name: "Gross Domestic Product", importance: 4, timeEt: "08:30" },
  { id: 9, name: "Retail Sales", importance: 3, timeEt: "08:30" },
  { id: 13, name: "Industrial Production (G.17)", importance: 3, timeEt: "09:15" },
  { id: 27, name: "Housing Starts", importance: 3, timeEt: "08:30" },
];

interface FredReleaseDatesResponse {
  release_dates?: Array<{ release_id?: number; date: string }>;
}

/** 릴리스별 발표일 → 기간 안의 일정(한국시간 환산). */
export function buildReleaseEvents(
  results: Array<{ release: ImportantRelease; dates: string[] }>,
  fromDate: string,
  toDate: string,
): EconomicEvent[] {
  const events: EconomicEvent[] = [];
  for (const { release, dates } of results) {
    for (const date of dates) {
      if (date < fromDate || date > toDate) continue;
      const kst = etToKst(date, release.timeEt);
      events.push({ date, country: "US", event: release.name, importance: release.importance, time: kst.time, kstDate: kst.date });
    }
  }
  return events.sort((a, b) => (a.kstDate ?? a.date).localeCompare(b.kstDate ?? b.date) || b.importance - a.importance).slice(0, 10);
}

/** 프롬프트용 한 줄 — 한국시간 날짜·시각과 한국 정규장과의 관계. */
export function formatEconomicEventLine(e: EconomicEvent): string {
  const when = e.time ? `${(e.kstDate ?? e.date).slice(5).replace("-", "/")} ${e.time} KST · ${describeKrSession(e.time)}` : `${e.date.slice(5).replace("-", "/")} (시각 미상)`;
  return `[${e.country}] ${e.event} — ${when}`;
}

type Fetcher = <T>(url: string, options: { timeoutMs: number }) => Promise<T>;

export async function collectEconomicCalendar(fetcher: Fetcher = fetchWithTimeout): Promise<EconomicEvent[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log("  ⏭️ FRED_API_KEY 없음 — 경제 캘린더 건너뜀");
    return [];
  }

  // 오늘부터 7일간(미국 동부 날짜 기준 FRED 일정)
  const today = new Date();
  const weekLater = new Date(today);
  weekLater.setDate(weekLater.getDate() + 7);
  const fromDate = formatDate(today);
  const toDate = formatDate(weekLater);

  const settled = await Promise.allSettled(
    IMPORTANT_RELEASES.map(async (release) => {
      const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${release.id}&api_key=${apiKey}&file_type=json&realtime_start=${fromDate}&realtime_end=9999-12-31&include_release_dates_with_no_data=true&sort_order=asc&limit=5`;
      const data = await fetcher<FredReleaseDatesResponse>(url, { timeoutMs: 12000 });
      return { release, dates: (data.release_dates ?? []).map((d) => d.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) };
    }),
  );
  const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = settled.length - ok.length;
  if (failed > 0) console.log(`  ⚠️ 경제 캘린더: 릴리스 ${failed}/${settled.length}건 조회 실패(나머지로 진행)`);
  return buildReleaseEvents(ok, fromDate, toDate);
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
