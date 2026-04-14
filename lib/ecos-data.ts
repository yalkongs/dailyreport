/**
 * 한국은행 ECOS API — 한국 국채 수익률
 * 3년물, 10년물 수집
 * API 키 optional — 없으면 skip
 */

import { fetchWithTimeout } from "./fetch-utils";
import type { KoreanBondYield } from "./types";

interface EcosResponse {
  StatisticSearch?: {
    row?: { TIME: string; DATA_VALUE: string; ITEM_NAME1: string }[];
  };
}

const BOND_ITEMS: { code: string; name: string }[] = [
  { code: "010200000", name: "국고채 3년" },
  { code: "010200001", name: "국고채 10년" },
];

export async function collectEcosData(): Promise<KoreanBondYield[]> {
  const apiKey = process.env.ECOS_API_KEY;
  if (!apiKey) {
    console.log("  ⏭️ ECOS_API_KEY 없음 — ECOS 데이터 건너뜀");
    return [];
  }

  const results: KoreanBondYield[] = [];

  // 최근 5영업일 데이터를 가져와 최신값과 전일값 비교
  const today = new Date();
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const fromDate = `${twoWeeksAgo.getFullYear()}${String(twoWeeksAgo.getMonth() + 1).padStart(2, "0")}${String(twoWeeksAgo.getDate()).padStart(2, "0")}`;
  const toDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  for (const item of BOND_ITEMS) {
    try {
      // ECOS API: 817Y002 = 시장금리(일별)
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/10/817Y002/D/${fromDate}/${toDate}/${item.code}`;
      const data = await fetchWithTimeout<EcosResponse>(url, { timeoutMs: 10000 });

      const rows = data.StatisticSearch?.row;
      if (rows && rows.length >= 2) {
        const latest = rows[rows.length - 1];
        const previous = rows[rows.length - 2];
        const currentYield = parseFloat(latest.DATA_VALUE);
        const prevYield = parseFloat(previous.DATA_VALUE);

        results.push({
          name: item.name,
          yield: currentYield,
          change: +(currentYield - prevYield).toFixed(3),
          date: latest.TIME,
        });
      } else if (rows && rows.length === 1) {
        results.push({
          name: item.name,
          yield: parseFloat(rows[0].DATA_VALUE),
          change: 0,
          date: rows[0].TIME,
        });
      }
    } catch (err) {
      console.log(`  ⚠️ ECOS ${item.name} 수집 실패: ${(err as Error).message}`);
    }
  }

  return results;
}
