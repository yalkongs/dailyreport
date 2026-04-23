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
  // P0 (2026-04-24): 발행 시각 기준 경과 시간.
  // Claude 프롬프트에 전달되어 "24h 초과 기사는 배경 맥락으로만" 지시.
  publishedHoursAgo?: number
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
  // 최근 7일 헤드라인. 프롬프트에 주입하여 Claude가 동일·유사 문장 반복을 피하게 함.
  // optional — 비어있거나 undefined면 프롬프트에서 해당 블록 생략.
  recentHeadlines?: string[]
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
  // Tier 2 — 본문 내러티브를 Claude가 생성하는 선택적 필드.
  // 모든 필드 optional: Claude가 누락/형식 오류일 경우 renderer 가 기존
  // Tier 1 하드코딩 문구로 자동 fallback. 최악 시나리오도 Tier 1 수준 유지.
  narrativeNotes?: {
    // Story Spine — 오늘의 서사 3막
    storySpine?: {
      act1?: string  // 오늘의 주인공 ETF와 왜 주목받는가
      act2?: string  // 주인공이 마주한 제약·변수
      act3?: string  // 독자가 장 초반 무엇을 볼지
    }
    // Characters — 4개 ETF 페르소나, 왜 오늘 등장하는가
    characters?: {
      primary?: string
      gate?: string
      alternative?: string
      warning?: string
    }
    // Resolutions — 시나리오별 결말
    resolutions?: {
      connect?: string
      delay?: string
      overheat?: string
    }
    // Checklist — 오늘 특별히 지킬/피할 것
    checklist?: {
      actions?: string[]
      avoids?: string[]
    }
    // ETF군별 전략 지도 — 7개 그룹 prose (morning-strategy.ts는 데이터만 제공)
    strategyProse?: Array<{
      group: string
      rationale?: string
      actionGuide?: string
      avoid?: string
    }>
  }
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
