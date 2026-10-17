// lib/etf/etf-mode.ts
//
// Phase E1 (2026-05-24): ETF 리포트 모드 분기. Market 의 market-mode.ts
// 패턴을 ETF 에 이식해 매일 같은 10 슬롯이 채워지는 wallpaper 효과 완화.
//
// 모드:
//   - event:  큰 변동·이상 신호 다발 — 요약에 사건의 무게, 근거 있는 reason 빠짐없이
//   - normal: 평이한 날 — 현재 동작
//   - quiet:  잠잠한 날 — 무리한 의미 부여 금지 + 다음 영업일 미리보기
//   (2026-10-17 출력 스키마 개편으로 분량 지시는 필드 길이 한도가 대신한다.)
//
// 우선순위: event > normal > quiet
//
// 본 모듈은 순수 함수. 외부 호출 없음.

import type { CollectedData, EtfQuote, Anomaly } from "./types";

export type EtfMode = "event" | "normal" | "quiet";

export interface EtfModeAnalysis {
  mode: EtfMode;
  reason: string;
  metrics: {
    soxxChange: number | null;
    spyChange: number | null;
    kospiProxy: number | null;   // 핵심 한국 ETF 평균 |Δ|
    vix: number | null;
    anomalyCount: number;
    coreAvgAbs: number;
  };
}

const EVENT_THRESHOLDS = {
  soxx: 3.0,         // SOXX |Δ| ≥ 3%
  spy: 2.0,          // SPY |Δ| ≥ 2%
  kospi: 2.0,        // KOSPI proxy |Δ| ≥ 2%
  vix: 25,           // VIX ≥ 25
  anomalies: 5,      // 유의미 이상 탐지(괴리율 제외) ≥ 5건. 초안값 — 운영 보정 대상.
} as const;

const QUIET_THRESHOLDS = {
  avgMax: 0.5,       // 핵심 ETF 평균 |Δ| < 0.5%
  anomMax: 3,        // 이상 탐지 ≤ 3건
} as const;

function findChange(quotes: EtfQuote[], ticker: string): number | null {
  return quotes.find(q => q.ticker === ticker)?.changePercent ?? null;
}

function kospiProxyChange(quotes: EtfQuote[]): number | null {
  // 국내 대표 ETF (KODEX 200·TIGER 200 등) 의 평균 |Δ| 로 KOSPI 변동 근사.
  const tickers = ["069500.KS", "102110.KS", "278530.KS"]; // KODEX 200, TIGER 200, KODEX 200TR
  const changes = tickers
    .map(t => findChange(quotes, t))
    .filter((v): v is number => typeof v === "number");
  if (changes.length === 0) return null;
  return changes.reduce((a, b) => a + Math.abs(b), 0) / changes.length;
}

export function analyzeEtfMode(data: CollectedData, anomalies: Anomaly[] = [], failedSources: string[] = []): EtfModeAnalysis {
  const soxx = findChange(data.quotes, "SOXX");
  const spy = findChange(data.quotes, "SPY");
  // 주: USD/KRW 변동률은 별도 데이터원이 필요해 현재 모드 판정에 미사용.
  // 데이터원 확보 시 event 트리거에 추가 (현재는 SOXX·SPY·KOSPI proxy·VIX·이상탐지로 판정).
  const vix = data.macro?.vix ?? null;
  const kospiProxy = kospiProxyChange(data.quotes);
  const anomalyCount = anomalies.length;
  // B4 (2026-05-29): 괴리율은 일상적 NAV 갭으로 흔해 mode를 왜곡 → 유의미 이상치만 트리거에 사용.
  const significantAnomalies = anomalies.filter(a => a.type !== "premiumDiscount").length;

  const coreAbs = [soxx, spy].filter((v): v is number => typeof v === "number").map(Math.abs);
  const coreAvgAbs = coreAbs.length > 0
    ? coreAbs.reduce((a, b) => a + b, 0) / coreAbs.length
    : 0;

  const metrics = { soxxChange: soxx, spyChange: spy, kospiProxy, vix, anomalyCount, coreAvgAbs };

  // ─── event 우선 ──────────────────────
  const eventTriggers: string[] = [];
  if (soxx !== null && Math.abs(soxx) >= EVENT_THRESHOLDS.soxx) {
    eventTriggers.push(`SOXX ${soxx >= 0 ? "+" : ""}${soxx.toFixed(2)}%`);
  }
  if (spy !== null && Math.abs(spy) >= EVENT_THRESHOLDS.spy) {
    eventTriggers.push(`SPY ${spy >= 0 ? "+" : ""}${spy.toFixed(2)}%`);
  }
  if (kospiProxy !== null && kospiProxy >= EVENT_THRESHOLDS.kospi) {
    eventTriggers.push(`KOSPI proxy ${kospiProxy.toFixed(2)}%`);
  }
  if (vix !== null && vix >= EVENT_THRESHOLDS.vix) {
    eventTriggers.push(`VIX ${vix.toFixed(2)}`);
  }
  if (significantAnomalies >= EVENT_THRESHOLDS.anomalies) {
    eventTriggers.push(`유의미 이상 ${significantAnomalies}건`);
  }
  if (eventTriggers.length > 0) {
    return {
      mode: "event",
      reason: `이벤트 트리거: ${eventTriggers.join(", ")}`,
      metrics,
    };
  }

  // ─── quiet 판정 ──────────────────────
  // KRX 실패면 낮은 anomalyCount가 데이터 누락 탓일 수 있어 quiet 강등 보류.
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && significantAnomalies <= QUIET_THRESHOLDS.anomMax && !failedSources.includes('krx-nav')) {
    return {
      mode: "quiet",
      reason: `잠잠: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 유의미 이상 ${significantAnomalies}건(전체 ${anomalyCount})`,
      metrics,
    };
  }

  return {
    mode: "normal",
    reason: `표준: 핵심 ETF 평균 |Δ| ${coreAvgAbs.toFixed(2)}% / 유의미 이상 ${significantAnomalies}건(전체 ${anomalyCount})`,
    metrics,
  };
}

export function describeEtfModeForPrompt(mode: EtfMode): string {
  switch (mode) {
    case "event":
      // 2026-10-17 출력 스키마 개편: 분량은 필드 길이 한도가 정하므로 모드는 무게·초점만 조절한다.
      return `오늘은 **이벤트 모드** 입니다. 큰 시장 변동·이상 신호 다발.
- summary 세 줄은 사건의 무게와 배경이 바로 전달되게 씁니다(수치 나열 지양).
- assetCards 의 reason 은 입력 근거가 있는 자산군마다 빠짐없이 씁니다.
- todayChecks 는 변동성이 진정되는지 판단할 기준 위주로 고릅니다.
- 헤드라인은 [cover.headline 작성 규칙]을 따르되, 사건의 무게가 즉시 전달되도록 씁니다 (수치만 나열 지양).`;
    case "quiet":
      return `오늘은 **잠잠한 모드** 입니다. 시장 변동이 매우 작고 이상 신호도 드뭅니다.
- 무리해서 의미를 만들지 마십시오. 근거가 없는 자산군의 reason 은 생략합니다.
- todayChecks 에 **"다음 영업일 또는 이번 주 후반에 살펴볼 자리"** 를 하나 넣어도 좋습니다.
- 헤드라인은 [cover.headline 작성 규칙]을 따르되 차분한 톤으로. 횡보 자체를 명시하는 것도 좋음.`;
    case "normal":
    default:
      return `오늘은 **표준 모드** 입니다. 일상적 ETF 흐름이며 평소 분량 유지.`;
  }
}
