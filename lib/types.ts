// 시장 데이터 타입 정의

export interface MarketIndex {
  symbol: string;
  name: string;
  nameKo: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
}

export interface ForexData {
  symbol: string;
  name: string;
  nameKo: string;
  rate: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface CommodityData {
  symbol: string;
  name: string;
  nameKo: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface BondData {
  symbol: string;
  name: string;
  nameKo: string;
  yield: number | null;
  change: number | null;
}

export interface CryptoData {
  symbol: string;
  name: string;
  nameKo: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
}

export interface MarketDataCollection {
  collectedAt: string; // ISO 8601
  date: string; // YYYY-MM-DD
  dayOfWeek: string; // 월, 화, 수, 목, 금
  koreaStocks: MarketIndex[];
  usStocks: MarketIndex[];
  europeStocks: MarketIndex[];
  japanStocks: MarketIndex[];
  chinaStocks: MarketIndex[];
  forex: ForexData[];
  commodities: CommodityData[];
  bonds: BondData[];
  crypto: CryptoData[];
  collectionErrors: string[];
}

export interface VolatilityScore {
  category: string;
  score: number; // 변동률 절대값 평균
  items: { name: string; changePercent: number }[];
}

export interface ReportMeta {
  date: string; // YYYY-MM-DD
  title: string;
  generatedAt: string; // ISO 8601
  filePath: string;
}

export interface ReportsIndex {
  reports: ReportMeta[];
  lastUpdated: string;
}

// --- 내러티브 반복 방지 시스템 ---

export interface NarrativeLogEntry {
  date: string;
  headline: string;
  bigStoryTopic: string;
  narrativeAngle: string;
  walletTopics: string[];
  metaphors: string[];
  lookingAhead: string;
}

export interface NarrativeLog {
  entries: NarrativeLogEntry[];
}

export interface NarrativeAngle {
  id: string;
  name: string;
  description: string;
  promptGuide: string;
}

export interface SidewaysAnalysis {
  isSideways: boolean;
  avgAbsChange: number;
  deepDiveTopic: string | null;
}

// --- 시장 데이터 스냅샷 (홈 페이지 표시용) ---

export interface MarketSnapshotItem {
  name: string;
  value: string;
  change: string;
  changePercent: number;
  direction: "up" | "down" | "flat";
}

export interface MarketSnapshot {
  date: string;
  dayOfWeek: string;
  collectedAt: string;
  headline: string;
  items: MarketSnapshotItem[];
}
