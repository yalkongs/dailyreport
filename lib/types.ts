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
  // 2026-10 개편: og:description·인덱스용 세 줄 요약 한 문장(summarySentence), 미리보기 카드의 제목 아래 한 줄.
  description?: string;
  cardLine?: string;
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
  url?: string; // C09 (2026-10-16): 기사 원문 링크(http/https만)
  category: "global" | "korea" | "economy" | "semiconductor";
  pubDate?: string;
  // Phase 1.5 (2026-05-21): 발행 경과 시간(시간 단위). 신선도 정렬·표시용.
  // pubDate 파싱 실패 시 undefined.
  publishedHoursAgo?: number;
  // Tier A A1 (2026-07-02): 실질 요약을 담는 소스(연합뉴스)의 기사 리드 발췌.
  // Google News 등 description이 링크 마크업뿐인 소스는 미설정.
  snippet?: string;
}

export interface EconomicEvent {
  date: string;
  time?: string; // C03: 한국시간 발표 시각 "HH:MM" (미국 지표는 ET 기준 공식 시각을 환산)
  kstDate?: string; // C03: 한국시간 발표 날짜 (FOMC처럼 한국시간으로 다음 날이 되는 경우)
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
  // C05 (2026-10-16): 각 기준값의 실제 종가 날짜(YYYY-MM-DD)와 주간 누적 기준(이번 주 월요일 이전 마지막 종가).
  oneWeekAgoDate?: string;
  oneMonthAgoDate?: string;
  threeMonthsAgoDate?: string;
  oneYearAgoDate?: string;
  weekToDateBase?: number;
  weekToDateBaseDate?: string;
}

export interface ContextError {
  source: string;
  status: number | string;
  message: string;
}

export interface PolicyRateChange {
  date: string; // 효력일 YYYY-MM-DD
  delta: number; // %p, 양수=인상
}

export interface PolicyRateSummary {
  label: string; // "미 연준 목표범위" | "한국은행 기준금리"
  currentText: string; // "3.75~4.00%" | "3.00%"
  current: number; // 판정용(연준은 상단)
  lastChange: PolicyRateChange | null;
  prevChange: PolicyRateChange | null;
  stance: string;
  stanceDirection: "hike" | "cut" | "hold";
  asOf: string;
}

export interface PolicyRates {
  fed: PolicyRateSummary | null;
  bok: PolicyRateSummary | null;
}

export interface ContextData {
  news: NewsHeadline[];
  economicCalendar: EconomicEvent[];
  fredIndicators: FredIndicator[];
  sentiment: MarketSentiment;
  investorFlow: InvestorFlow | null;
  koreanBonds: KoreanBondYield[];
  policyRates: PolicyRates;
  historicalComparison: HistoricalComparison[];
  contextErrors: ContextError[];
  // 코스피 최근 20거래일 일간 등락(미리보기 카드 스트라이프용). 수집 실패 시 [].
  // Task 3에서 lib/preview/data-card.ts 의 StripeSession 과 합칠 때까지 market-data 의 동일 형태를 쓴다.
  kospiSessions: import("./market-data").StripeSession[];
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

// 2026-10 개편: 페이지 상단 세 줄 요약(어제 / 오늘 볼 것 / 내 자산은).
export interface ReportSummary {
  yesterday: string; // 어제 한국·미국 시장 분위기와 배경을 말로 쓴 한 문장
  today: string; // 오늘 확인할 한 가지
  myAssets: string; // 자산군 관점은 ETF Today 안내 + 오늘 가장 영향이 큰 자산군 하나
}

// 미리보기 카드의 제목 아래 한 줄. cause = 근거 있는 배경 한 문장, watch = 근거가 약할 때 오늘 확인점.
export interface ReportCardLine {
  kind: "cause" | "watch";
  text: string;
}

export interface ReportContent {
  cover: {
    headline: string;
    subline: string;
    imageKeywords?: string[]; // 제목/본문 핵심 이미지·은유 단어 (반복 회피 로그용). 사실 모드면 빈 배열.
  };
  summary: ReportSummary;
  cardLine: ReportCardLine;
  bigStory: {
    content: ReportContentBlock[];
  };
  watchPoints: ReportWatchPoint[];
  // 개편으로 새 프롬프트는 생성하지 않는다(자산군 관점은 ETF Today). 과거 콘텐츠·렌더 호환용으로만 남긴다.
  compass?: ReportCompassSection[];
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
