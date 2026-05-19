// lib/market-mode.ts
//
// Market Phase 1 (2026-05-19): 시장 분위기에 따라 리포트 모드를 자동 분기.
//
// 6주간 리포트가 매일 같은 6섹션 골격으로 발행되어 wallpaper 효과가
// 누적됨. 시장 데이터 자체가 같은 무게로 흘러가지 않는데도 형태는 일정.
// 시장 분위기에 따라 섹션 구성과 분량을 자동 조정해 매일 다른 색조를 만든다.
//
// 모드 정의:
//   - event:  큰 변동 / 큰 사건 — 한 주제 deep + 곁가지 섹션 축약
//   - normal: 평이한 날 — 현재 6섹션 골격 유지
//   - quiet:  잠잠한 날 — 짧은 회고 + 다음 이벤트 미리보기
//
// 우선순위: event > normal > quiet (큰 변동이 평균에 묻혀 quiet으로
// 잘못 분류되는 모순 방지)
//
// 딥다이브(에세이) 모드는 자동 분기에서 제외하고 Phase 3 운영자 트리거로 이관.
// 기존 sideways-detector 는 그대로 유지(독립 모듈), 본 모드 시스템과 직교.

import type { MarketDataCollection } from "./types";

export type MarketMode = "event" | "normal" | "quiet";

export interface MarketModeAnalysis {
  mode: MarketMode;
  reason: string; // 운영 로그용 사람이 읽는 설명
  metrics: {
    kospiChange: number | null;
    sp500Change: number | null;
    nasdaqChange: number | null;
    usdKrwChange: number | null;
    vix: number | null;
    coreAvgAbs: number;   // 핵심 4지표 평균 |Δ|
    coreMaxAbs: number;   // 핵심 4지표 최대 |Δ|
  };
}

// ─── 임계값 (옵션 A + β) ──────────────────────────────
// 1주일 운영 후 실측 분포 보고 조정 가능.
const EVENT_THRESHOLDS = {
  kospi: 2.0,      // KOSPI |Δ| ≥ 2%
  sp500: 1.5,      // S&P500 |Δ| ≥ 1.5%
  usdKrw: 1.0,     // USD/KRW |Δ| ≥ 1%
  vix: 25,         // VIX ≥ 25
} as const;

const QUIET_THRESHOLDS = {
  avgMax: 0.5,     // 평균 |Δ| < 0.5%
  maxMax: 1.0,     // 최댓값 < 1%
} as const;

function findChange(
  data: MarketDataCollection,
  group: "koreaStocks" | "usStocks" | "forex",
  symbol: string
): number | null {
  const arr = data[group] as Array<{ symbol: string; changePercent?: number | null }> | undefined;
  const item = arr?.find((x) => x.symbol === symbol);
  return item?.changePercent ?? null;
}

function findValue(
  data: MarketDataCollection,
  group: "usStocks",
  symbol: string
): number | null {
  const arr = data[group] as Array<{ symbol: string; price?: number | null; value?: number | null }> | undefined;
  const item = arr?.find((x) => x.symbol === symbol);
  return item?.price ?? item?.value ?? null;
}

export function analyzeMarketMode(data: MarketDataCollection): MarketModeAnalysis {
  const kospi = findChange(data, "koreaStocks", "^KS11");
  const sp500 = findChange(data, "usStocks", "^GSPC");
  const nasdaq = findChange(data, "usStocks", "^IXIC");
  const usdKrw = findChange(data, "forex", "KRW=X");
  const vix = findValue(data, "usStocks", "^VIX");

  const coreAbs = [kospi, sp500, nasdaq, usdKrw]
    .filter((v): v is number => typeof v === "number")
    .map(Math.abs);
  const coreAvgAbs = coreAbs.length > 0
    ? coreAbs.reduce((a, b) => a + b, 0) / coreAbs.length
    : 0;
  const coreMaxAbs = coreAbs.length > 0 ? Math.max(...coreAbs) : 0;

  const metrics = { kospiChange: kospi, sp500Change: sp500, nasdaqChange: nasdaq, usdKrwChange: usdKrw, vix, coreAvgAbs, coreMaxAbs };

  // ─── 1) event 우선 판정 ──────────────────────────────
  const eventTriggers: string[] = [];
  if (kospi !== null && Math.abs(kospi) >= EVENT_THRESHOLDS.kospi) {
    eventTriggers.push(`KOSPI ${kospi >= 0 ? "+" : ""}${kospi.toFixed(2)}%`);
  }
  if (sp500 !== null && Math.abs(sp500) >= EVENT_THRESHOLDS.sp500) {
    eventTriggers.push(`S&P500 ${sp500 >= 0 ? "+" : ""}${sp500.toFixed(2)}%`);
  }
  if (usdKrw !== null && Math.abs(usdKrw) >= EVENT_THRESHOLDS.usdKrw) {
    eventTriggers.push(`USD/KRW ${usdKrw >= 0 ? "+" : ""}${usdKrw.toFixed(2)}%`);
  }
  if (vix !== null && vix >= EVENT_THRESHOLDS.vix) {
    eventTriggers.push(`VIX ${vix.toFixed(2)}`);
  }
  if (eventTriggers.length > 0) {
    return {
      mode: "event",
      reason: `이벤트 트리거: ${eventTriggers.join(", ")}`,
      metrics,
    };
  }

  // ─── 2) quiet 판정 (평균 + 최댓값 둘 다 충족) ────────
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && coreMaxAbs < QUIET_THRESHOLDS.maxMax) {
    return {
      mode: "quiet",
      reason: `잠잠: 핵심 4지표 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 최댓값 ${coreMaxAbs.toFixed(2)}%`,
      metrics,
    };
  }

  // ─── 3) normal (default) ────────────────────────────
  return {
    mode: "normal",
    reason: `표준: 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 최댓값 ${coreMaxAbs.toFixed(2)}%`,
    metrics,
  };
}

/**
 * 프롬프트에 주입할 모드별 작성 가이드.
 * Claude 가 모드에 맞게 분량·섹션 비중을 조정하도록.
 */
export function describeModeForPrompt(mode: MarketMode): string {
  switch (mode) {
    case "event":
      return `오늘은 **이벤트 모드** 입니다. 시장에 의미 있는 변동이 발생했습니다.
- bigStory.content 는 평소(12블록)보다 더 깊게 **15~20블록** 으로 한 주제를 충실히 풀어내십시오.
- pullQuote 는 3~4개로 늘리고, 핵심 인사이트를 강조하세요.
- soWhat 은 5~6개를 유지하되, 이벤트의 파급 효과 중심으로 씁니다.
- watchPoints 는 2~3개로 압축하고 (양 줄이기), compass 도 핵심 1~2개만 남기십시오.
- 헤드라인은 사건의 무게가 즉시 전달되도록 단정형 + 구체 수치로 씁니다.`;
    case "quiet":
      return `오늘은 **잠잠한 모드** 입니다. 시장 변동이 매우 작아 일상적 해설 거리가 적습니다.
- bigStory.content 는 **6~8 블록**으로 짧게 씁니다. 무리해서 채우지 마십시오.
- pullQuote 는 1개, dataCard 는 1~2개로 압축.
- watchPoints 는 정확히 3개, compass 는 1~2개로 줄여 핵심만.
- soWhat 은 3~4개로 줄이되, **"다음 이벤트 미리보기"** 성격을 추가하십시오.
  (예: "이번 주 남은 일정에서 무엇이 변수가 될지", "다가오는 발표·지표가 의미하는 것")
- 헤드라인은 차분한 톤. "조용한 N일, 다음 변수는 X" 같은 형태를 시도해 보십시오.`;
    case "normal":
    default:
      return `오늘은 **표준 모드** 입니다. 일상적 시장 흐름이며 평소 분량과 구성을 유지합니다.
- bigStory.content 는 평소대로 **12블록 이상**, pullQuote 2~3, dataCard 2~3.
- watchPoints 3~4개, compass 3개, soWhat 5~6개 — 기존 비율 유지.`;
  }
}
