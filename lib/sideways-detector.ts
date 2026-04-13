import type { MarketDataCollection, SidewaysAnalysis, NarrativeLogEntry } from "./types";

const DEEP_DIVE_TOPICS = [
  "연금저축 ETF는 지금 어떻게 굴러가고 있을까 — 장기 투자자를 위한 현황 점검",
  "적금 금리 3%대 시대, 예금 vs 채권 vs 배당주 — 안전자산 비교 해부",
  "환율 1,400원대가 '뉴노멀'이 된 이유 — 구조적 변화 3가지",
  "미국 금리 인하가 진짜 시작되면 무슨 일이 벌어지나 — 시나리오 분석",
  "한국 반도체 산업의 현재 좌표 — 글로벌 공급망 속 우리의 위치",
  "부동산과 주식, 지금 어디에 무게를 둘 것인가 — 자산배분 재점검",
  "AI 시대의 투자 — 테마주 열풍 너머 진짜 수혜 산업은",
  "일본 엔화는 왜 계속 약할까 — 엔캐리 트레이드와 한국 투자자",
  "중국 경제 회복의 진실 — 숫자 이면의 이야기",
  "인플레이션이 끝난 줄 알았는데 — 서비스 물가가 말해주는 것",
  "달러 강세가 신흥국에 미치는 나비효과 — 한국은 안전한가",
  "글로벌 채권시장 재편 — 금리 역전이 풀리면 어떤 변화가 오나",
  "ESG 투자의 현재 성적표 — 이상과 수익의 간극",
  "한국 가계부채, 숫자 너머의 이야기 — 다른 나라와 비교하면",
  "배당주 vs 성장주, 지금 사이클은 어디에 있나",
];

export function analyzeSideways(data: MarketDataCollection): SidewaysAnalysis {
  // 핵심 4개 지표 변동률
  const coreChanges: number[] = [];

  // KOSPI
  const kospi = data.koreaStocks.find((s) => s.symbol === "^KS11");
  if (kospi?.changePercent != null) coreChanges.push(Math.abs(kospi.changePercent));

  // S&P 500
  const sp500 = data.usStocks.find((s) => s.symbol === "^GSPC");
  if (sp500?.changePercent != null) coreChanges.push(Math.abs(sp500.changePercent));

  // NASDAQ
  const nasdaq = data.usStocks.find((s) => s.symbol === "^IXIC");
  if (nasdaq?.changePercent != null) coreChanges.push(Math.abs(nasdaq.changePercent));

  // USD/KRW
  const usdkrw = data.forex.find((f) => f.symbol === "KRW=X");
  if (usdkrw?.changePercent != null) coreChanges.push(Math.abs(usdkrw.changePercent));

  if (coreChanges.length === 0) {
    return { isSideways: false, avgAbsChange: 0, deepDiveTopic: null };
  }

  const avgAbsChange = coreChanges.reduce((a, b) => a + b, 0) / coreChanges.length;
  const allCoreBelow03 = coreChanges.every((c) => c < 0.3);

  // 전체 지표 변동률도 체크
  const allChanges: number[] = [];
  for (const group of [data.koreaStocks, data.usStocks, data.europeStocks, data.japanStocks, data.chinaStocks]) {
    for (const item of group) {
      if (item.changePercent != null) allChanges.push(Math.abs(item.changePercent));
    }
  }
  for (const item of data.forex) {
    if (item.changePercent != null) allChanges.push(Math.abs(item.changePercent));
  }
  for (const item of data.commodities) {
    if (item.changePercent != null) allChanges.push(Math.abs(item.changePercent));
  }
  for (const item of data.crypto) {
    if (item.changePercent != null) allChanges.push(Math.abs(item.changePercent));
  }

  const below05Count = allChanges.filter((c) => c < 0.5).length;
  const broadSideways = allChanges.length > 0 && below05Count / allChanges.length >= 0.8;

  const isSideways = allCoreBelow03 || broadSideways;

  return {
    isSideways,
    avgAbsChange,
    deepDiveTopic: isSideways ? null : null, // 토픽은 selectDeepDiveTopic에서 선택
  };
}

export function selectDeepDiveTopic(recentLog: NarrativeLogEntry[]): string {
  // 최근 30일간 사용된 빅스토리 주제와 겹치지 않는 딥다이브 토픽 선택
  const recentTopics = recentLog.map((e) => e.bigStoryTopic.toLowerCase());

  const available = DEEP_DIVE_TOPICS.filter(
    (topic) => !recentTopics.some((rt) => topic.toLowerCase().includes(rt.split("→")[0].trim().toLowerCase()))
  );

  const pool = available.length > 0 ? available : DEEP_DIVE_TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}
