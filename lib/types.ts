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
  collectedAt: string; // KST ISO 8601 (e.g. 2026-04-13T07:00:00+09:00)
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
  headline: string; // 커버 헤드라인 (OG용)
  subline: string; // 서브라인 (OG description용)
  generatedAt: string; // KST ISO 8601
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

// --- 컨텍스트 데이터 (맥락 제공용) ---

export interface NewsHeadline {
  title: string;
  source: string;
  category: "global" | "korea" | "economy";
  pubDate?: string;
}

export interface EconomicEvent {
  date: string;
  time?: string;
  country: string;
  event: string;
  importance: number; // 1-5
  actual?: string;
  forecast?: string;
  previous?: string;
}

export interface FredIndicator {
  seriesId: string;
  name: string;
  value: number;
  date: string;
  unit: string;
}

export interface MarketSentiment {
  vix?: { value: number; change: number; changePercent: number };
  fearGreed?: { value: number; label: string; previousClose: number };
}

export interface InvestorFlow {
  date: string;
  foreign: { buy: number; sell: number; net: number };
  institution: { buy: number; sell: number; net: number };
  individual: { buy: number; sell: number; net: number };
}

export interface KoreanBondYield {
  name: string;
  yield: number;
  change: number;
  date: string;
}

export interface HistoricalComparison {
  symbol: string;
  nameKo: string;
  current: number;
  oneWeekAgo?: number;
  oneMonthAgo?: number;
  threeMonthsAgo?: number;
  oneYearAgo?: number;
}

export interface ContextError {
  source: string;
  status: number | string;
  message: string;
}

export interface ContextData {
  news: NewsHeadline[];
  economicCalendar: EconomicEvent[];
  fredIndicators: FredIndicator[];
  sentiment: MarketSentiment;
  investorFlow: InvestorFlow | null;
  koreanBonds: KoreanBondYield[];
  historicalComparison: HistoricalComparison[];
  contextErrors: ContextError[];
}

// --- Claude JSON 출력 인터페이스 (콘텐츠/구조 분리) ---

export interface ReportContentBlock {
  type: "paragraph" | "pullQuote" | "dataCard";
  text?: string; // paragraph, pullQuote
  title?: string; // dataCard
  rows?: Array<{ label: string; value: string }>; // dataCard
}

export interface ReportWatchPoint {
  badge: string; // "오전", "오후", "이번 주"
  title: string;
  description: string;
}

export interface ReportCompassSection {
  label: string; // "자산군별 온도계"
  title: string;
  items: Array<{
    asset: string; // "주식", "채권" 등
    body: string; // 분석 텍스트 (HTML 인라인 태그 허용)
    gaugePercent: number; // 0~100
    gaugeType: "cautious" | "neutral" | "positive" | "strong";
  }>;
  paragraphs?: string[]; // 추가 본문 (items 없는 서브섹션용)
}

export interface ReportSoWhat {
  title: string;
  body: string;
}

export interface ReportCalendarItem {
  date: string;
  country: string;
  event: string;
  importance: number; // 1~5
}

export interface ReportContent {
  cover: {
    headline: string;
    subline: string;
  };
  bigStory: {
    content: ReportContentBlock[];
  };
  watchPoints: ReportWatchPoint[];
  compass: ReportCompassSection[];
  soWhat: ReportSoWhat[];
  calendar: ReportCalendarItem[];
  closingMessage: string;
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
