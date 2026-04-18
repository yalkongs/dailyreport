// lib/morning-strategy.ts
import type {
  CollectedData,
  EtfGroupStrategy,
  EtfQuote,
  MorningStrategyInput,
  RiskAlert,
  StrategyEvidence,
  StrategyScore,
} from './types'

function quoteMap(quotes: EtfQuote[]): Map<string, EtfQuote> {
  return new Map(quotes.map(q => [q.ticker, q]))
}

function pct(q: EtfQuote | undefined): number | null {
  return q?.changePercent ?? null
}

function fmtPct(value: number | null): string {
  if (value === null) return '미확보'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '미확보'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function clampScore(value: number): -2 | -1 | 0 | 1 | 2 {
  if (value >= 2) return 2
  if (value <= -2) return -2
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

function scoreLabel(score: number, positive: string, neutral: string, negative: string): string {
  if (score > 0) return positive
  if (score < 0) return negative
  return neutral
}

function benefitLevel(score: number): string {
  if (score >= 2) return '높음'
  if (score === 1) return '우호'
  if (score === -1) return '부담'
  if (score <= -2) return '높은 부담'
  return '보통'
}

function pressureLevel(score: number): string {
  if (score >= 2) return '부담'
  if (score === 1) return '주의'
  if (score === -1) return '우호'
  if (score <= -2) return '강한 우호'
  return '중립'
}

function transmissionLevel(score: number): string {
  if (score >= 2) return '높음'
  if (score === 1) return '보통 이상'
  if (score < 0) return '낮음'
  return '보통'
}

function ev(label: string, value: string, interpretation: string): StrategyEvidence {
  return { label, value, interpretation }
}

function buildScores(data: CollectedData): StrategyScore[] {
  const quotes = quoteMap(data.quotes)
  const spy = pct(quotes.get('SPY'))
  const qqq = pct(quotes.get('QQQ'))
  const iwm = pct(quotes.get('IWM'))
  const hyg = pct(quotes.get('HYG'))
  const tlt = pct(quotes.get('TLT'))
  const soxx = pct(quotes.get('SOXX'))
  const xle = pct(quotes.get('XLE'))
  const gld = pct(quotes.get('GLD'))

  const broadRisk = [spy, qqq, iwm].filter(v => v !== null) as number[]
  const broadAvg = broadRisk.length ? broadRisk.reduce((a, b) => a + b, 0) / broadRisk.length : 0

  let riskScore = broadAvg >= 0.6 ? 1 : broadAvg <= -0.6 ? -1 : 0
  if ((data.macro.vix ?? 0) >= 25) riskScore -= 1
  if (hyg !== null && hyg >= 0.4) riskScore += 1

  let ratesScore = 0
  if ((data.macro.us10y ?? 0) >= 4.5) ratesScore += 1
  if ((data.macro.us10y ?? 0) <= 4.0 && data.macro.us10y !== null) ratesScore -= 1
  if (tlt !== null && tlt <= -0.7) ratesScore += 1
  if (tlt !== null && tlt >= 0.7) ratesScore -= 1

  let dollarScore = 0
  if ((data.macro.usdKrw ?? 0) >= 1450) dollarScore += 2
  else if ((data.macro.usdKrw ?? 0) >= 1400) dollarScore += 1
  if ((data.macro.dxy ?? 0) >= 105) dollarScore += 1

  let inflationScore = 0
  if ((data.macro.wti ?? 0) >= 90) inflationScore += 1
  if (xle !== null && xle >= 1) inflationScore += 1
  if (gld !== null && gld >= 1.5) inflationScore += 1

  let volatilityScore = 0
  if ((data.macro.vix ?? 0) >= 25) volatilityScore += 2
  else if ((data.macro.vix ?? 0) >= 18) volatilityScore += 1
  if ((data.macro.moveIndex ?? 0) >= 120) volatilityScore += 1

  let koreaScore = 0
  if (soxx !== null && soxx >= 1) koreaScore += 1
  if (qqq !== null && qqq >= 0.7) koreaScore += 1
  if ((data.macro.usdKrw ?? 0) >= 1450) koreaScore += 1

  const politicalKeywords = /(tariff|sanction|war|election|fed|fomc|china|taiwan|관세|제재|전쟁|선거|연준|중국|대만|금리)/i
  const politicalHits = data.news.filter(n => politicalKeywords.test(n.title)).length
  const politicalScore = politicalHits >= 3 ? 2 : politicalHits >= 1 ? 1 : 0

  return [
    {
      key: 'riskAppetite',
      label: '위험선호',
      displayLabel: '위험자산 선호도',
      score: clampScore(riskScore),
      stance: scoreLabel(riskScore, '위험자산 우위', '중립', '방어 우위'),
      displayLevel: benefitLevel(riskScore),
      evidence: [
        ev('SPY', fmtPct(spy), '미국 대형주 ETF의 당일 방향입니다.'),
        ev('QQQ', fmtPct(qqq), '성장주 ETF의 위험선호 민감도입니다.'),
        ev('VIX', fmtNum(data.macro.vix), '변동성 부담을 함께 봅니다.'),
      ],
    },
    {
      key: 'ratesPressure',
      label: '금리압력',
      displayLabel: '금리 부담',
      score: clampScore(ratesScore),
      stance: scoreLabel(ratesScore, '금리 부담', '중립', '금리 완화'),
      displayLevel: pressureLevel(ratesScore),
      evidence: [
        ev('US 10Y', data.macro.us10y ? `${data.macro.us10y.toFixed(2)}%` : '미확보', '장기채와 성장주 ETF의 핵심 변수입니다.'),
        ev('TLT', fmtPct(tlt), '장기채 ETF의 가격 반응입니다.'),
      ],
    },
    {
      key: 'dollarPressure',
      label: '달러압력',
      displayLabel: '원화환율 부담',
      score: clampScore(dollarScore),
      stance: scoreLabel(dollarScore, '원화 투자자 환율 부담', '중립', '환율 부담 완화'),
      displayLevel: pressureLevel(dollarScore),
      evidence: [
        ev('USD/KRW', fmtNum(data.macro.usdKrw, 0), '환노출형 해외 ETF의 원화 성과에 직접 영향을 줍니다.'),
        ev('DXY', fmtNum(data.macro.dxy), '달러 전반의 강도를 봅니다.'),
      ],
    },
    {
      key: 'inflationPressure',
      label: '인플레압력',
      displayLabel: '원자재·물가 부담',
      score: clampScore(inflationScore),
      stance: scoreLabel(inflationScore, '원자재 부담', '중립', '물가 부담 완화'),
      displayLevel: pressureLevel(inflationScore),
      evidence: [
        ev('WTI', fmtNum(data.macro.wti, 1), '에너지 ETF와 물가 기대의 핵심 입력입니다.'),
        ev('GLD', fmtPct(gld), '금 ETF의 방어 수요를 확인합니다.'),
      ],
    },
    {
      key: 'volatilityPressure',
      label: '변동성',
      displayLabel: '가격 변동성',
      score: clampScore(volatilityScore),
      stance: scoreLabel(volatilityScore, '추격 진입 주의', '중립', '변동성 안정'),
      displayLevel: pressureLevel(volatilityScore),
      evidence: [
        ev('VIX', fmtNum(data.macro.vix), '주식 변동성 지표입니다.'),
        ev('MOVE', fmtNum(data.macro.moveIndex), '채권 변동성 지표입니다.'),
      ],
    },
    {
      key: 'koreaTransmission',
      label: '한국전이',
      displayLabel: '국내 ETF 영향도',
      score: clampScore(koreaScore),
      stance: scoreLabel(koreaScore, '국내 ETF 영향 큼', '중립', '국내 전이 제한'),
      displayLevel: transmissionLevel(koreaScore),
      evidence: [
        ev('SOXX', fmtPct(soxx), '국내 반도체 ETF 전이의 핵심 입력입니다.'),
        ev('USD/KRW', fmtNum(data.macro.usdKrw, 0), '국내 상장 해외 ETF의 환율 효과입니다.'),
      ],
    },
    {
      key: 'politicalRisk',
      label: '정치리스크',
      displayLabel: '정치경제 이벤트',
      score: clampScore(politicalScore),
      stance: scoreLabel(politicalScore, '뉴스 이벤트 점검', '제한적', '제한적'),
      displayLevel: politicalScore > 0 ? '점검' : '제한적',
      evidence: [
        ev('정치경제 뉴스', `${politicalHits}건`, '정치경제 키워드가 포함된 뉴스 제목 수입니다.'),
      ],
    },
  ]
}

function buildEtfGroupStrategies(data: CollectedData, scores: StrategyScore[]): EtfGroupStrategy[] {
  const score = (key: StrategyScore['key']) => scores.find(s => s.key === key)?.score ?? 0
  const quotes = quoteMap(data.quotes)
  const risk = score('riskAppetite')
  const rates = score('ratesPressure')
  const dollar = score('dollarPressure')
  const volatility = score('volatilityPressure')
  const korea = score('koreaTransmission')

  const strategies: EtfGroupStrategy[] = []

  strategies.push({
    group: '미국 대표지수 ETF',
    stance: risk >= 1 && volatility <= 1 ? '선호' : risk <= -1 ? '경계' : '관찰',
    tickers: ['SPY', 'VOO', 'VTI', 'QQQ'],
    rationale: risk >= 1 ? 'SPY와 QQQ가 함께 오르면 대표지수 ETF가 장 초반 기준이 됩니다.' : '위험선호가 약하면 지수 ETF는 관찰 비중을 높입니다.',
    actionGuide: risk >= 1 ? '갭 상승 뒤 거래대금이 동반될 때만 단계적으로 점검합니다.' : '지수 방향이 엇갈리면 추가 노출 확대를 보류합니다.',
    confirmSignal: 'SPY와 QQQ가 함께 강하고 HYG가 약하지 않아야 합니다.',
    avoid: '지수 갭 상승 직후 시장가 추격은 피합니다.',
    evidence: [ev('SPY', fmtPct(pct(quotes.get('SPY'))), '대형주 대표 ETF입니다.'), ev('QQQ', fmtPct(pct(quotes.get('QQQ'))), '성장주 대표 ETF입니다.')],
  })

  strategies.push({
    group: '반도체·AI ETF',
    stance: korea >= 2 || pct(quotes.get('SOXX')) !== null && (pct(quotes.get('SOXX')) ?? 0) >= 1 ? '선호' : volatility >= 2 ? '경계' : '관찰',
    tickers: ['SOXX', 'BOTZ', 'ARKK', '091160.KS', '364970.KS'],
    rationale: '나스닥 강세는 성장 ETF에 우호적이지만 SOXX가 약하면 국내 반도체 ETF로 이어지는 힘은 제한됩니다.',
    actionGuide: '개장 후 30분 거래대금이 동반될 때만 반도체·AI ETF를 검토합니다.',
    confirmSignal: 'SOXX 강세, QQQ 강세, 국내 반도체 ETF 거래대금 증가가 함께 확인되어야 합니다.',
    avoid: '미국 ETF 상승만 보고 국내 ETF를 장 시작 직후 추격하지 않습니다.',
    evidence: [ev('SOXX', fmtPct(pct(quotes.get('SOXX'))), '미국 반도체 ETF입니다.'), ev('QQQ', fmtPct(pct(quotes.get('QQQ'))), '미국 성장주 방향입니다.')],
  })

  strategies.push({
    group: '채권 ETF',
    stance: rates <= -1 ? '선호' : rates >= 1 ? '경계' : '중립',
    tickers: ['SHY', 'IEF', 'TLT', 'BND', '114820.KS', '148070.KS'],
    rationale: rates >= 1 ? '금리 부담이 높으면 장기채 ETF의 가격 변동성이 커집니다.' : '금리 부담이 완화되면 채권 ETF의 방어 역할이 커집니다.',
    actionGuide: rates >= 1 ? '금리 부담이 남아 있으면 장기채보다 단기채를 우선합니다.' : '미국 10년 금리가 내려갈 때만 장기채를 검토합니다.',
    confirmSignal: '미국 10년 금리 하락과 TLT 상승이 함께 확인되어야 합니다.',
    avoid: '금리 방향이 엇갈릴 때 장기채 ETF를 크게 늘리지 않습니다.',
    evidence: [ev('US 10Y', data.macro.us10y ? `${data.macro.us10y.toFixed(2)}%` : '미확보', '금리 압력입니다.'), ev('TLT', fmtPct(pct(quotes.get('TLT'))), '장기채 ETF 반응입니다.')],
  })

  strategies.push({
    group: '금·원자재 ETF',
    stance: (pct(quotes.get('GLD')) ?? 0) >= 1 || (pct(quotes.get('SLV')) ?? 0) >= 1 ? '선호' : '관찰',
    tickers: ['GLD', 'SLV', 'DBC', 'USO', '132030.KS', '261270.KS'],
    rationale: '금과 원자재 ETF는 달러·실질금리·지정학 뉴스가 함께 움직일 때 전략 가치가 커집니다.',
    actionGuide: '귀금속과 에너지 방향을 분리하고 같은 원자재로 묶어 추격하지 않습니다.',
    confirmSignal: 'GLD·SLV 강세와 USO·XLE 방향이 같은 흐름인지 확인합니다.',
    avoid: '금 ETF 강세를 원자재 ETF 전체 강세로 확대 해석하지 않습니다.',
    evidence: [ev('GLD', fmtPct(pct(quotes.get('GLD'))), '금 ETF 반응입니다.'), ev('WTI', fmtNum(data.macro.wti, 1), '원유 가격입니다.')],
  })

  strategies.push({
    group: '환노출 해외 ETF',
    stance: dollar >= 2 ? '관찰' : '중립',
    tickers: ['360750.KS', '133690.KS', '441680.KS'],
    rationale: dollar >= 2 ? '달러 강세는 보유분의 원화 수익률에는 우호적이지만 추가 편입 비용을 높입니다.' : '환율 부담이 제한적이면 기초지수 흐름을 더 우선해 볼 수 있습니다.',
    actionGuide: dollar >= 2 ? '보유분 평가는 환율 효과를 반영하고 추가 편입 판단은 속도를 낮춥니다.' : '환율보다 기초지수 방향을 우선 확인합니다.',
    confirmSignal: 'USD/KRW가 안정되고 기초지수가 강할 때 추가 편입 조건이 개선됩니다.',
    avoid: '원화 약세 구간에서 환노출 ETF를 한 번에 크게 늘리지 않습니다.',
    evidence: [ev('USD/KRW', fmtNum(data.macro.usdKrw, 0), '환노출 ETF의 원화 성과 변수입니다.')],
  })

  strategies.push({
    group: '레버리지·인버스 ETF',
    stance: volatility >= 1 ? '경계' : '관찰',
    tickers: ['122630.KS', '252670.KS'],
    rationale: '변동성이 높을수록 레버리지·인버스 ETF는 장중 가격 흔들림과 복리 효과 부담이 커집니다.',
    actionGuide: '당일 단기 전술 목적이 아니면 일반 장기투자 점검 대상에서 제외합니다.',
    confirmSignal: '기초지수 방향, NAV 괴리율, 손실 허용폭이 모두 맞을 때만 검토합니다.',
    avoid: '방향이 불명확한 구간에서 레버리지와 인버스를 동시에 다루지 않습니다.',
    evidence: [ev('VIX', fmtNum(data.macro.vix), '변동성 점검 지표입니다.')],
  })

  return strategies
}

function buildRiskAlerts(data: CollectedData, scores: StrategyScore[]): RiskAlert[] {
  const alerts: RiskAlert[] = []
  const volatility = scores.find(s => s.key === 'volatilityPressure')?.score ?? 0
  const dollar = scores.find(s => s.key === 'dollarPressure')?.score ?? 0
  const premiumCount = data.quotes.filter(q => q.market === 'KR' && q.premiumDiscount !== null && Math.abs(q.premiumDiscount) >= 0.5).length

  if (volatility >= 1) {
    alerts.push({
      level: volatility >= 2 ? 'caution' : 'watch',
      title: '변동성 점검',
      body: '장 초반 추격보다 가격 안정과 거래량 확인이 우선입니다.',
    })
  }

  if (dollar >= 2) {
    alerts.push({
      level: 'watch',
      title: '환율 부담',
      body: '환노출 해외 ETF는 보유분과 추가 편입 판단의 환율 효과를 분리해서 봅니다.',
    })
  }

  if (premiumCount > 0) {
    alerts.push({
      level: 'caution',
      title: '국내 ETF 괴리율',
      body: `괴리율 절대값 0.5% 이상인 국내 ETF가 ${premiumCount}개입니다. 지정가 주문과 NAV 점검을 우선합니다.`,
    })
  }

  return alerts
}

function buildExecutiveSummary(
  regime: MorningStrategyInput['regime'],
  strategies: EtfGroupStrategy[],
  scores: StrategyScore[]
): MorningStrategyInput['executiveSummary'] {
  const preferredGroups = strategies.filter(s => s.stance === '선호').map(s => s.group).slice(0, 3)
  const watchGroups = strategies.filter(s => s.stance === '관찰').map(s => s.group).slice(0, 3)
  const cautionGroups = strategies.filter(s => s.stance === '경계').map(s => s.group).slice(0, 3)
  const volatility = scores.find(s => s.key === 'volatilityPressure')?.score ?? 0
  const dollar = scores.find(s => s.key === 'dollarPressure')?.score ?? 0
  const tacticalStance = regime.label === 'risk_off'
    ? '방어'
    : volatility >= 2
      ? '관망'
      : regime.label === 'risk_on' && dollar <= 1
        ? '공격'
        : '균형'
  const avoidToday = dollar >= 2
    ? '환율이 높은 구간에서 환노출 해외 ETF를 장 초반에 한 번에 늘리는 행동입니다.'
    : volatility >= 1
      ? '변동성이 커진 구간에서 레버리지 ETF를 시장가로 추격하는 행동입니다.'
      : '상승률 상위 ETF를 근거 확인 없이 뒤따라가는 행동입니다.'
  const title = regime.label === 'risk_on' && dollar >= 2
    ? '위험자산은 열려 있지만 환율 때문에 추격보다 단계적 판단입니다.'
    : regime.label === 'risk_on'
      ? `위험자산 선호입니다. 오늘은 ${tacticalStance} 접근이 기준입니다.`
      : regime.label === 'risk_off'
        ? '방어 우위입니다. 추가 위험자산 노출 확대보다 손실 관리가 먼저입니다.'
        : `중립·선별 국면입니다. 오늘은 ${tacticalStance} 접근이 기준입니다.`

  return {
    title,
    tacticalStance,
    preferredGroups,
    watchGroups,
    cautionGroups,
    avoidToday,
  }
}

export function hasRealFundFlowData(data: Pick<CollectedData, 'flows'>): boolean {
  return data.flows.some(f => f.flowDaily !== null || f.flowWeekly !== null)
}

export function buildMorningStrategyInput(data: CollectedData): MorningStrategyInput {
  const scores = buildScores(data)
  const risk = scores.find(s => s.key === 'riskAppetite')?.score ?? 0
  const volatility = scores.find(s => s.key === 'volatilityPressure')?.score ?? 0
  const regimeScore = risk - Math.max(0, volatility - 1)
  const label: MorningStrategyInput['regime']['label'] = regimeScore >= 1 ? 'risk_on' : regimeScore <= -1 ? 'risk_off' : 'neutral'
  const displayName = label === 'risk_on' ? '위험자산 선호' : label === 'risk_off' ? '방어 우위' : '중립·선별'
  const confidence = Math.min(90, 50 + Math.abs(regimeScore) * 15 + Math.abs(volatility) * 5)
  const hasRealFlowData = hasRealFundFlowData(data)
  const etfGroupStrategies = buildEtfGroupStrategies(data, scores)
  const regime = {
    label,
    displayName,
    confidence,
    summary: `${displayName} 국면입니다. 핵심 변수는 ${scores.filter(s => s.score !== 0).slice(0, 3).map(s => s.displayLabel).join(', ') || '방향성 부재'}입니다.`,
  }

  return {
    date: data.date,
    generatedAt: new Date().toISOString(),
    executiveSummary: buildExecutiveSummary(regime, etfGroupStrategies, scores),
    regime,
    scores,
    etfGroupStrategies,
    koreaWatch: etfGroupStrategies.filter(s => s.tickers.some(t => t.endsWith('.KS'))).slice(0, 3),
    riskAlerts: buildRiskAlerts(data, scores),
    dataCoverage: {
      quoteCount: data.quotes.length,
      usQuoteCount: data.quotes.filter(q => q.market === 'US').length,
      krQuoteCount: data.quotes.filter(q => q.market === 'KR').length,
      hasRealFlowData,
      newsCount: data.news.length,
      sourceNote: 'ETF 가격·환율·금리·원자재는 조회 시점 기준입니다. KRX NAV·괴리율은 KRX 조회일 기준입니다. AUM은 순자산 규모 참고값입니다.',
    },
  }
}
