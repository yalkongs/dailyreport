/**
 * FRED 경제지표 수집기
 * 4개 시리즈: FEDFUNDS, CPIAUCSL, UNRATE, T10Y2Y
 * API 키 optional — 없으면 skip
 */

import { fetchWithTimeout } from "./fetch-utils";
import type { FredIndicator } from "./types";

const FRED_SERIES: { id: string; name: string; unit: string }[] = [
  { id: "FEDFUNDS", name: "연방기금금리", unit: "%" },
  { id: "CPIAUCSL", name: "소비자물가지수(CPI)", unit: "index" },
  { id: "UNRATE", name: "실업률", unit: "%" },
  { id: "T10Y2Y", name: "장단기 금리차(10Y-2Y)", unit: "%" },
];

interface FredApiResponse {
  observations?: { date: string; value: string }[];
}

export async function collectFredData(): Promise<FredIndicator[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log("  ⏭️ FRED_API_KEY 없음 — FRED 데이터 건너뜀");
    return [];
  }

  const indicators: FredIndicator[] = [];

  for (const series of FRED_SERIES) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
      const data = await fetchWithTimeout<FredApiResponse>(url, { timeoutMs: 10000 });

      const obs = data.observations?.[0];
      if (obs && obs.value !== ".") {
        indicators.push({
          seriesId: series.id,
          name: series.name,
          value: parseFloat(obs.value),
          date: obs.date,
          unit: series.unit,
        });
      }
    } catch (err) {
      console.log(`  ⚠️ FRED ${series.id} 수집 실패: ${(err as Error).message}`);
    }
  }

  return indicators;
}
