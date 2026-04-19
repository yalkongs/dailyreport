export type Market = 'KR' | 'US'
// Evening edition was retired during the dailyreport merge. The alias is
// preserved to avoid rippling through every call site; `morning` is the
// only valid value in the integrated pipeline.
export type ReportType = 'morning'
export type AnomalyType = 'premiumDiscount' | 'aumChange' | 'trackingError' | 'volumeSpike' | 'consecutiveSell'

// ETF 유니버스 정의용
export interface EtfDefinition {
  ticker: string        // Yahoo Finance 심볼 (예: "005930.KS", "SPY")
  name: string          // 표시명
  market: Market
  category: string      // "섹터", "지수", "테마", "채권", "팩터"
  theme?: string        // "AI", "반도체" 등 (선택)
}

// 수집된 ETF 시세
export interface EtfQuote {
  ticker: string
  name: string
  market: Market
  price: number | null
  change: number | null          // 전일비 절대값
  changePercent: number | null   // 전일비 %
  volume: number | null
  aum: number | null             // 순자산 (KRW 또는 USD)
  nav: number | null             // KR 전용
  premiumDiscount: number | null // KR 전용: (가격-NAV)/NAV*100
  trackingError: number | null   // KR 전용
  prev20AvgVolume: number | null // 20일 평균 거래량
  tradingValue?: number | null   // 거래대금
  marketCap?: number | null      // 시가총액
  underlyingIndexName?: string | null
  underlyingIndexClose?: number | null
  underlyingIndexChangePercent?: number | null
  dailyIndexGap?: number | null  // ETF 등락률 - 기초지수 등락률
}

// StockAnalysis 자금 흐름
export interface EtfFlow {
  ticker: string
  flowDaily: number | null    // USD 백만
  flowWeekly: number | null
  flowMonthly: number | null
}

// KRX 투자자별 매매동향
export interface InvestorFlow {
  ticker: string
  foreign: number | null          // 외국인 순매수 (KRW)
  institution: number | null      // 기관 순매수
  retail: number | null           // 개인 순매수
  consecutiveForeignSell: number  // 외국인 연속 순매도 일수
}

// 거시 컨텍스트
export interface MacroContext {
  usdKrw: number | null
  dxy: number | null
  vix: number | null
  moveIndex: number | null
  us10y: number | null
  fearGreed: number | null
  wti: number | null
  gold: number | null
}

// 뉴스 아이템
export interface NewsItem {
  title: string
  source: string
  publishedAt: string
  url: string
}

// 이상 탐지 결과
export interface Anomaly {
  ticker: string
  market: Market
  type: AnomalyType
  value: number      // 실제 값
  threshold: number  // 기준 값
  severity: 'warning' | 'alert'
}

// 파이프라인 수집 데이터 전체
export interface CollectedData {
  reportType: ReportType
  date: string           // YYYY-MM-DD
  quotes: EtfQuote[]
  flows: EtfFlow[]
  investorFlows: InvestorFlow[]
  macro: MacroContext
  news: NewsItem[]
  analysisLens: string
}

export type StrategyStance = '선호' | '관찰' | '중립' | '경계'

export interface StrategyEvidence {
  label: string
  value: string
  interpretation: string
}

export interface StrategyScore {
  key: 'riskAppetite' | 'ratesPressure' | 'dollarPressure' | 'inflationPressure' | 'volatilityPressure' | 'koreaTransmission' | 'politicalRisk'
  label: string
  displayLabel: string
  score: -2 | -1 | 0 | 1 | 2
  stance: string
  displayLevel: string
  evidence: StrategyEvidence[]
}

export interface EtfGroupStrategy {
  group: string
  stance: StrategyStance
  tickers: string[]
  rationale: string
  actionGuide: string
  confirmSignal: string
  avoid: string
  evidence: StrategyEvidence[]
}

export interface RiskAlert {
  level: 'info' | 'watch' | 'caution'
  title: string
  body: string
}

export interface MorningStrategyInput {
  date: string
  generatedAt: string
  executiveSummary: {
    title: string
    tacticalStance: '공격' | '균형' | '방어' | '관망'
    preferredGroups: string[]
    watchGroups: string[]
    cautionGroups: string[]
    avoidToday: string
  }
  regime: {
    label: 'risk_on' | 'neutral' | 'risk_off'
    displayName: string
    confidence: number
    summary: string
  }
  scores: StrategyScore[]
  etfGroupStrategies: EtfGroupStrategy[]
  koreaWatch: EtfGroupStrategy[]
  riskAlerts: RiskAlert[]
  dataCoverage: {
    quoteCount: number
    usQuoteCount: number
    krQuoteCount: number
    hasRealFlowData: boolean
    newsCount: number
    sourceNote: string
  }
}

// Claude 출력 — Morning
export interface MorningReport {
  cover: { headline: string; subline: string }
  overnightBrief: { narrative: string; krImpact: string }
  usEtfHighlights: {
    topMover: { ticker: string; reason: string }
    bottomMover: { ticker: string; reason: string }
    sectorNarrative: string
  }
  todayWatch: { items: { title: string; body: string }[] }
  closingLine: string
}

export type ReportContent = MorningReport

// 리포트 메타 (인덱스용)
export interface ReportMeta {
  date: string
  type: ReportType
  headline: string
  url: string
  anomalyCount: number
  // 룰 종류별 카운트. 옛 인덱스 엔트리는 이 필드가 없을 수 있어 optional.
  // 키 누락 = 0건. 값이 0인 키는 직렬화 시 생략 가능.
  anomalyBreakdown?: Partial<Record<AnomalyType, number>>
  createdAt: string
}

// data/etf-reports-index.json
export interface ReportsIndex {
  reports: ReportMeta[]
}

// data/etf-snapshot.json (홈 화면용)
export interface EtfSnapshot {
  updatedAt: string
  morning: ReportMeta | null
  topMovers: { ticker: string; name: string; changePercent: number; market: Market }[]
  anomalyCount: number
}
