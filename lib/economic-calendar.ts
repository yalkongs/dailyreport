/**
 * 경제 캘린더 수집기
 * Primary: FRED releases API (안정적, API키 재사용)
 * 중요 지표 발표 일정 수집
 */

import { fetchWithTimeout } from "./fetch-utils";
import type { EconomicEvent } from "./types";

interface FredRelease {
  id: number;
  name: string;
  date: string;
}

interface FredReleaseResponse {
  releases?: FredRelease[];
}

// 주요 FRED 릴리즈 ID와 중요도 매핑
const IMPORTANT_RELEASES: Record<number, number> = {
  10: 5,   // Consumer Price Index
  50: 5,   // Employment Situation
  46: 4,   // Producer Price Index
  53: 4,   // Gross Domestic Product
  21: 4,   // Federal Open Market Committee (FOMC)
  19: 3,   // Industrial Production and Capacity Utilization
  13: 3,   // G.17 Industrial Production
  83: 3,   // Retail Sales
  18: 3,   // Housing Starts
};

export async function collectEconomicCalendar(): Promise<EconomicEvent[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log("  ⏭️ FRED_API_KEY 없음 — 경제 캘린더 건너뜀");
    return [];
  }

  try {
    // 오늘부터 7일간의 릴리즈 일정
    const today = new Date();
    const weekLater = new Date(today);
    weekLater.setDate(weekLater.getDate() + 7);

    const fromDate = formatDate(today);
    const toDate = formatDate(weekLater);

    const url = `https://api.stlouisfed.org/fred/releases/dates?api_key=${apiKey}&file_type=json&realtime_start=${fromDate}&realtime_end=${toDate}&include_release_dates_with_no_data=true`;
    const data = await fetchWithTimeout<FredReleaseResponse>(url, { timeoutMs: 10000 });

    if (!data.releases || !Array.isArray(data.releases)) return [];

    const events: EconomicEvent[] = [];

    for (const release of data.releases) {
      const importance = IMPORTANT_RELEASES[release.id] || 0;
      if (importance >= 3) {
        events.push({
          date: release.date,
          country: "US",
          event: release.name,
          importance,
        });
      }
    }

    return events.slice(0, 10);
  } catch (err) {
    console.log(`  ⚠️ 경제 캘린더 수집 실패: ${(err as Error).message}`);
    return [];
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
