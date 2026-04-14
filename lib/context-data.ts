/**
 * 컨텍스트 데이터 오케스트레이터
 * 모든 컨텍스트 소스를 병렬 수집하고, 실패해도 계속 진행
 * Fear & Greed API도 여기서 인라인 처리
 */

import { collectNews } from "./news-collector";
import { collectEconomicCalendar } from "./economic-calendar";
import { collectFredData } from "./fred-data";
import { collectEcosData } from "./ecos-data";
import { collectInvestorFlow } from "./krx-investor-flow";
import { collectHistoricalData, collectVix } from "./market-data";
import { fetchWithTimeout } from "./fetch-utils";
import type { ContextData, ContextError, MarketSentiment } from "./types";

interface FearGreedResponse {
  fear_and_greed?: {
    score?: number;
    rating?: string;
    previous_close?: number;
  };
}

async function collectFearGreed(): Promise<MarketSentiment["fearGreed"] | undefined> {
  try {
    const data = await fetchWithTimeout<FearGreedResponse>(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        timeoutMs: 5000,
        headers: { "User-Agent": "Mozilla/5.0" },
      }
    );
    const fg = data.fear_and_greed;
    if (fg?.score != null) {
      return {
        value: Math.round(fg.score),
        label: fg.rating || "N/A",
        previousClose: fg.previous_close ?? fg.score,
      };
    }
  } catch (err) {
    console.log(`  ⚠️ Fear & Greed 수집 실패: ${(err as Error).message}`);
  }
  return undefined;
}

export async function collectContextData(): Promise<ContextData> {
  console.log("📰 컨텍스트 데이터 수집 시작...");
  const errors: ContextError[] = [];

  // 모든 소스 병렬 수집 — 개별 실패는 전체를 중단하지 않음
  const [news, calendar, fred, ecos, investorFlow, vix, fearGreed, historical] =
    await Promise.all([
      collectNews().catch((err) => {
        errors.push({ source: "news", status: "error", message: (err as Error).message });
        return [] as Awaited<ReturnType<typeof collectNews>>;
      }),
      collectEconomicCalendar().catch((err) => {
        errors.push({ source: "calendar", status: "error", message: (err as Error).message });
        return [] as Awaited<ReturnType<typeof collectEconomicCalendar>>;
      }),
      collectFredData().catch((err) => {
        errors.push({ source: "fred", status: "error", message: (err as Error).message });
        return [] as Awaited<ReturnType<typeof collectFredData>>;
      }),
      collectEcosData().catch((err) => {
        errors.push({ source: "ecos", status: "error", message: (err as Error).message });
        return [] as Awaited<ReturnType<typeof collectEcosData>>;
      }),
      collectInvestorFlow().catch((err) => {
        errors.push({ source: "krx", status: "error", message: (err as Error).message });
        return null;
      }),
      collectVix().catch((err) => {
        errors.push({ source: "vix", status: "error", message: (err as Error).message });
        return undefined;
      }),
      collectFearGreed().catch((err) => {
        errors.push({ source: "feargreed", status: "error", message: (err as Error).message });
        return undefined;
      }),
      collectHistoricalData().catch((err) => {
        errors.push({ source: "historical", status: "error", message: (err as Error).message });
        return [] as Awaited<ReturnType<typeof collectHistoricalData>>;
      }),
    ]);

  const sentiment: MarketSentiment = {};
  if (vix) sentiment.vix = vix;
  if (fearGreed) sentiment.fearGreed = fearGreed;

  const contextData: ContextData = {
    news,
    economicCalendar: calendar,
    fredIndicators: fred,
    sentiment,
    investorFlow,
    koreanBonds: ecos,
    historicalComparison: historical,
    contextErrors: errors,
  };

  // 수집 결과 로그
  console.log(`  📰 뉴스: ${news.length}건`);
  console.log(`  📅 캘린더: ${calendar.length}건`);
  console.log(`  📊 FRED: ${fred.length}건`);
  console.log(`  🏦 ECOS: ${ecos.length}건`);
  console.log(`  💰 투자자 수급: ${investorFlow ? "OK" : "없음"}`);
  console.log(`  😨 VIX: ${vix ? vix.value.toFixed(2) : "없음"}`);
  console.log(`  🎭 Fear & Greed: ${fearGreed ? fearGreed.value : "없음"}`);
  console.log(`  📈 과거 비교: ${historical.length}건`);
  if (errors.length > 0) {
    console.log(`  ⚠️ 수집 에러: ${errors.map((e) => e.source).join(", ")}`);
  }
  console.log(`✅ 컨텍스트 데이터 수집 완료`);

  return contextData;
}
