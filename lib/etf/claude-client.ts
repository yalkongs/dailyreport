// lib/claude-client.ts
import Anthropic from '@anthropic-ai/sdk'
import type { CollectedData, MorningReport } from './types'
import { buildMorningStrategyInput } from './morning-strategy'
import { validateMorningReportQuality } from './report-quality'
import { normalizeMorningReportLanguage } from './report-language'
import { buildMorningNarrativePlan } from './morning-report-plan'
import { describeAngle, ETF_NARRATIVE_ANGLES, type EtfNarrativeAngle } from './narrative-angle'

// Lazy initialization: env vars may not be loaded at module parse time
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

const SYSTEM_PROMPT = `당신은 ETF 시장 분석 전문가입니다. 다음 원칙을 반드시 지키십시오.

[톤 & 스타일 — Plan B (2026-04-28) 완화 적용]
- 격식체 사용 ("~입니다", "~습니다")
- 차분한 보고서 문체를 유지하되, **한 호흡의 글이 되도록** 문장을 자연스럽게 연결하십시오.
- 수치를 먼저 제시한 뒤 해석을 붙이는 순서를 기본으로 하되, 글의 흐름이 자연스러우면 도치를 허용합니다.
- 짧은 문장과 자연스러운 복문을 섞어 씁니다. 단문만 나열하면 보고서가 단편 나열로 읽힙니다.
- 본문의 모든 문장은 서술어가 있는 완결문으로 씁니다. 명사로만 끝나는 조각 문장은 쓰지 마십시오. (예외: cover.headline 의 두 절 압축형 — 별도 규칙 참조)
- 중급 ETF 투자자 기준 (괴리율·추적오차·AUM 등 전문 용어 별도 설명 불필요)
- **사실을 정확히 만든다는 전제 하에 비유·은유 사용을 허용합니다.** 데이터를 기억하기 좋게 하는 좋은 비유는 보고서 가치를 높입니다.
- 독자를 압박하지 말고 확인 순서와 보류 조건을 친절하게 설명하십시오.

[ETF 특화 규칙 — 절대 어기지 마십시오]
- 매수/매도 권유 절대 금지 ("매수 후보", "신규 진입", "매수 검토", "분할 접근", "비중 확대", "선호 ETF군" 등)
- 이상 탐지 결과 과장 금지 ("폭락", "위험" 단어 자체 금지)
- 수치는 반드시 제공된 데이터에서만 인용, 임의 생성 절대 금지
- 가상의 인물, 가상의 사례, 날조된 통계 사용 금지

[금지 표현 — 흐린 표현·면피성 문구·AI 클리셰만 차단]
- "~할 수 있습니다" 같은 추측성 완화 어미 — 무엇이 가능하다는 뜻인지 직접 쓰십시오.
- "투자에 주의하시기 바랍니다" 같은 면피성 문구
- AI 가 자주 쓰는 뻔한 비유: "폭풍전야", "훈풍", "찬바람", "양날의 검", "나비효과", "신호탄", "뇌관"
- "확인이 필요합니다" 반복 금지. 대신 무엇을 확인할지(거래대금·NAV·USD/KRW 등) 직접 쓰십시오.
- "가능성이 있습니다", "판단됩니다", "보입니다" 같은 흐린 문장 — 본 것을 본 그대로 쓰십시오.

(주: "관문/장면/불씨/온도/속도전/붙으면/풀리면/받아내다" 같은 표현은 데이터를 명확히 만드는 한 사용을 허용합니다.)

반드시 지정된 JSON 형식으로만 응답하십시오. 다른 텍스트는 일절 포함하지 마십시오.`

function extractJsonFromResponse(response: Anthropic.Message, reportType: string): string {
  if (response.content.length === 0) {
    throw new Error(`[claude-client] ${reportType} 응답이 비어 있습니다`)
  }
  const block = response.content[0]
  if (block.type !== 'text') {
    throw new Error(`[claude-client] ${reportType} 응답 타입이 text가 아닙니다: ${block.type}`)
  }
  // Strip markdown code fences. Tolerate:
  //  - leading/trailing whitespace
  //  - missing closing fence (happens if max_tokens truncates mid-response)
  //  - trailing commentary after the closing fence
  const text = block.text.trim()
  // First try full fence match (opening AND closing present)
  const fullFence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  if (fullFence) return fullFence[1]
  // If opens with fence but no closing fence, strip the opener and trust rest is JSON
  const openFence = text.match(/^```(?:json)?\s*\n?([\s\S]*)$/)
  if (openFence) {
    // Drop any trailing fence if present anywhere
    return openFence[1].replace(/\s*```\s*$/m, '').trim()
  }
  return text
}

export async function generateMorningReport(data: CollectedData): Promise<MorningReport> {
  const report = await generateMorningReportRaw(data)
  validateMorningReportQuality(report, data, buildMorningStrategyInput(data))
  return report
}

// P0 (2026-04-24): validator 재시도 소진 시 fallback 경로에서 사용.
// 생성·파싱·언어 정규화까지 수행하되 품질 검증은 하지 않는다.
// run-etf.ts가 narrativeNotes를 drop한 뒤 재검증해서 Tier 1 수준의 안전한
// 리포트를 발송할 수 있게 한다.
export async function generateMorningReportRaw(data: CollectedData): Promise<MorningReport> {
  const prompt = buildMorningPrompt(data)
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    // Tier 2 — narrativeNotes 5 섹션(~30 문장) 추가로 출력이 4096 토큰을 넘어
    // 잘리는 현상 관측(4/22 저녁 로컬 테스트). 8192로 상향.
    // Plan B (2026-04-28) — bigPicture 4~6문장 + storySpine 각 act 3~5문장
    // + characters/resolutions 길이 확장으로 8192도 잘림(2026-04-28 테스트).
    // 16384로 상향해 충분한 여유 확보.
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = extractJsonFromResponse(response, 'morning')
  let report: MorningReport
  try {
    report = JSON.parse(text) as MorningReport
  } catch (e) {
    throw new Error(`[claude-client] morning 리포트 JSON 파싱 실패: ${e}\n응답: ${text.slice(0, 200)}`)
  }
  return normalizeMorningReportLanguage(report)
}

// P0 (2026-04-24): Tier 1 fallback용. 외부에서 직접 호출해 검증할 때 사용.
export function validateMorningReport(report: MorningReport, data: CollectedData): void {
  validateMorningReportQuality(report, data, buildMorningStrategyInput(data))
}

function formatPromptNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatPromptEtf(q: Pick<CollectedData['quotes'][number], 'ticker' | 'name' | 'market'>): string {
  if (q.market === 'KR') {
    return `${q.name} (${q.ticker.replace(/\.(KS|KQ)$/i, '')})`
  }
  return `${q.ticker} ${q.name}`
}

function formatPromptTicker(ticker: string, quotes: CollectedData['quotes']): string {
  const quote = quotes.find(q => q.ticker === ticker)
  if (quote) return formatPromptEtf(quote)
  if (/\.(KS|KQ)$/i.test(ticker)) return ticker.replace(/\.(KS|KQ)$/i, '')
  return ticker
}

function buildMorningPrompt(data: CollectedData): string {
  const strategy = buildMorningStrategyInput(data)
  const narrativePlan = buildMorningNarrativePlan(data, strategy)
  const topUs = [...data.quotes]
    .filter(q => q.market === 'US' && q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
  const topKr = [...data.quotes]
    .filter(q => q.market === 'KR' && q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))

  const scoreLines = strategy.scores
    .map(s => `${s.displayLabel}: ${s.displayLevel} (${s.stance}) / 근거: ${s.evidence.map(item => `${item.label} ${item.value}`).join(', ')}`)
    .join('\n')

  const strategyLines = strategy.etfGroupStrategies
    .map(s => `${s.stance === '선호' ? '확인 우선' : s.stance} | ${s.group} | ${s.tickers.map(ticker => formatPromptTicker(ticker, data.quotes)).join(', ')} | ${s.rationale} | 점검 기준: ${s.actionGuide} | 확인: ${s.confirmSignal} | 피할 점: ${s.avoid}`)
    .join('\n')

  const riskAlertLines = strategy.riskAlerts
    .map(a => `${a.level} | ${a.title}: ${a.body}`)
    .join('\n') || '없음'

  // Plan B (2026-04-28): narrativeAngle 이 주입되어 있으면 그 관점을
  // 본문 서술의 spine 으로 사용. 분석 렌즈는 "데이터 보는 각도",
  // 서사 앵글은 "이야기 풀어내는 각도" — 두 차원을 직교로 결합.
  const angleKey = (data.narrativeAngle && (ETF_NARRATIVE_ANGLES as readonly string[]).includes(data.narrativeAngle))
    ? (data.narrativeAngle as EtfNarrativeAngle)
    : undefined
  const angleBlock = angleKey
    ? `\n오늘의 서사 앵글: ${angleKey}\n앵글 가이드: ${describeAngle(angleKey)}\n`
    : ''

  return `오늘 날짜: ${data.date}
분석 렌즈: ${data.analysisLens}${angleBlock}

[독자·발행 맥락 — 모든 문장 작성 시 전제]
- 발행 시각: 매일 **06:30 KST** (한국 증시 개장 전). 독자는 막 잠에서 깬 한국 개인 투자자입니다.
- 독자는 **전일 한국 증시의 마감가·뉴스를 이미 알고** 있으며, '지수/시장' 같은 단어를 보면 반사적으로 KOSPI를 떠올립니다.
- 이 리포트의 주된 데이터는 **간밤 해외 시장(미국 마감, 유럽, 환율 야간)** 입니다.
- 용어 규칙:
  · "지수" 단독 표기 금지. 반드시 "S&P500", "나스닥", "코스피", "코스닥" 등 구체적으로 씁니다.
  · "시장" 단독 표기 금지. "미 증시", "국내 증시", "야간 환시" 등 접두를 붙입니다.
  · "증시가 하락했다"처럼 주체가 불명확한 서술 금지. 어느 시장인지를 반드시 명시합니다.
- 전일 한국 증시와 간밤 미국 시장이 **서로 다른 방향**으로 움직인 경우, 그 차이를 **명시적으로** 언급하십시오. 한국 독자가 반사적으로 떠올리는 한국 흐름과 오늘 새벽 해외 흐름이 다를 수 있다는 점을 고려합니다.
- 헤드라인에 한국 독자가 오해할 여지가 있는 애매어(지수/시장)를 쓰지 말고 **시장을 특정**하여 씁니다.

[오늘의 시장 국면]
${strategy.regime.displayName}
신뢰도: ${strategy.regime.confidence}
요약: ${strategy.regime.summary}

[오늘의 전략 결론]
${strategy.executiveSummary.title}
전술 태도: ${strategy.executiveSummary.tacticalStance}
확인 우선 ETF군: ${strategy.executiveSummary.preferredGroups.join(', ') || '없음'}
관찰 ETF군: ${strategy.executiveSummary.watchGroups.join(', ') || '없음'}
경계 ETF군: ${strategy.executiveSummary.cautionGroups.join(', ') || '없음'}
오늘 피해야 할 실수: ${strategy.executiveSummary.avoidToday}

[시장 국면 점수]
${scoreLines}

[ETF군별 전략 지도]
${strategyLines}

[리스크 알림]
${riskAlertLines}

[코드가 확정한 리포트 작성 슬롯]
중심 주제: ${narrativePlan.centerTopic}
커버에 반영할 사실: ${narrativePlan.coverFacts.join(' / ')}
간밤 요약에 쓸 사실: ${narrativePlan.overnightFacts.join(' / ')}
국내 영향에 쓸 사실: ${narrativePlan.krImpactFacts.join(' / ')}
섹터 내러티브에 쓸 사실: ${narrativePlan.sectorFacts.join(' / ')}
Today Watch 1: ${narrativePlan.todayWatch[0].title} | ${narrativePlan.todayWatch[0].facts.join(' / ')} | ${narrativePlan.todayWatch[0].instruction}
Today Watch 2: ${narrativePlan.todayWatch[1].title} | ${narrativePlan.todayWatch[1].facts.join(' / ')} | ${narrativePlan.todayWatch[1].instruction}
Today Watch 3: ${narrativePlan.todayWatch[2].title} | ${narrativePlan.todayWatch[2].facts.join(' / ')} | ${narrativePlan.todayWatch[2].instruction}

[미국 ETF 상위 5]
${topUs.slice(0, 5).map(q => `${formatPromptEtf(q)}: ${q.changePercent?.toFixed(2)}%`).join('\n')}

[미국 ETF 하위 5]
${topUs.slice(-5).reverse().map(q => `${formatPromptEtf(q)}: ${q.changePercent?.toFixed(2)}%`).join('\n')}

[국내 ETF 핵심 움직임 - KRX OpenAPI 기준]
상위: ${topKr.slice(0, 5).map(q => `${formatPromptEtf(q)} ${q.changePercent?.toFixed(2)}%`).join(' / ') || 'N/A'}
하위: ${topKr.slice(-5).reverse().map(q => `${formatPromptEtf(q)} ${q.changePercent?.toFixed(2)}%`).join(' / ') || 'N/A'}
거래대금 상위: ${topKr.filter(q => q.tradingValue !== undefined && q.tradingValue !== null).sort((a, b) => (b.tradingValue ?? 0) - (a.tradingValue ?? 0)).slice(0, 5).map(q => `${formatPromptEtf(q)} ${formatPromptNumber(q.tradingValue, 0)}원`).join(' / ') || 'N/A'}

[거시 지표]
USD/KRW: ${formatPromptNumber(data.macro.usdKrw, 0)}
VIX: ${formatPromptNumber(data.macro.vix, 2)}
MOVE: ${formatPromptNumber(data.macro.moveIndex, 2)}
공포탐욕: ${formatPromptNumber(data.macro.fearGreed, 0)}
US 10Y: ${formatPromptNumber(data.macro.us10y, 2)}%
WTI: ${formatPromptNumber(data.macro.wti, 1)}
Gold: ${formatPromptNumber(data.macro.gold, 0)}

[주요 뉴스 — 발행 N시간 경과 라벨 포함]
${data.news.slice(0, 6).map(n => {
  const ago = typeof n.publishedHoursAgo === 'number'
    ? `${Math.round(n.publishedHoursAgo)}h전`
    : 'age 불명'
  return `- [${ago}] ${n.title} (${n.source}, ${n.url})`
}).join('\n')}
- **24시간 초과 기사는 "배경 맥락"으로만 활용**하고, 현재 상황·오늘의 전개로 단정하지 마십시오.
- 뉴스 내용이 어제 한국 증시 마감 이후의 전개인지, 그 이전의 전개인지 발행 시각으로 판단하여 쓰십시오.
${data.recentHeadlines && data.recentHeadlines.length > 0 ? `
[최근 ETF 리포트 헤드라인 — 절대 반복·유사 표현 금지]
${data.recentHeadlines.map(h => `- ${h}`).join('\n')}
위 문장들과 3어절 이상 겹치거나 같은 구문 틀("~가 ~로 이어지는지", "~신호를 ~로 확인" 등)을 재사용하지 마십시오.
` : ''}
[P3 — 섹션별 독자 목적 (이 목적을 충족하지 못하면 해당 섹션은 실패)]
- cover: 한국 독자가 30초 안에 "어느 시장이, 어떻게, 왜" 를 파악하게 합니다.
- overnightBrief.narrative: 한국 독자가 잠든 사이 미국·유럽·환율에 무슨 일이 있었는지 사실 위주로 정리합니다.
- overnightBrief.krImpact: 간밤 해외 흐름이 오늘 국내 개장에 어떻게 연결되는지 — 어느 국내 ETF·환율·금리에서 확인할지를 알려 줍니다.
- usEtfHighlights.sectorNarrative: 미국 ETF 상승/하락 1위가 속한 섹터 흐름의 의미를 한국 독자에게 풀어 줍니다.
- todayWatch: 한국 독자가 오늘 09:00 개장 후 무엇을 어떤 순서로 볼지 알려 줍니다.
- closingLine: 오늘 리포트의 톤·결론을 한 줄로 봉합합니다.
- narrativeNotes: 위 모든 섹션을 가로지르는 단일 내러티브를 깊이 있게 풀어내며, 한국 독자가 "왜 오늘 이 ETF군을 봐야 하는가" 에 답합니다.

[작성 규칙]
- 위 시장 국면 점수와 ETF군별 전략 지도를 바꾸지 마십시오.
- 리포트는 하나의 중심 주제(오늘의 시장 인사이트)를 따라 작성하십시오.
- 모든 문단은 같은 논리 축을 이어받아야 합니다: "선행 신호 → 제약 조건 → 상품별 역할 → 확인 조건" 순서.
- ETF 상품은 단순 목록이 아니라 분석상 역할을 가져야 합니다. 예: 성장 신호 확인, 환율 영향 점검, 대안 관찰, 과열 경계.
- 리포트의 논리 순서: "오늘의 중심 주제 → 결론 → 결론의 근거 → 상품별 역할 → 국내 ETF 실행 확인점 → 리스크".
- overnightBrief.narrative는 간밤 해외시장 사실과 거시지표만 씁니다.
- overnightBrief.krImpact는 해외 ETF·환율·KRX 국내 ETF가 국내 개장에 미치는 연결만 씁니다.
- usEtfHighlights.sectorNarrative는 섹터 흐름만 씁니다. 환율·괴리율·자금흐름 설명을 반복하지 마십시오.

[cover.headline 작성 규칙 — 2026-04-29 압축·함의형 재설계]

이 헤드라인은 06:30 KST 한국 개인투자자가 가장 먼저 만나는 한 줄입니다.
시장 리포트의 압축 헤드라인 ("유가 100달러, 직업마다 다른 명암" 같은 형태)
처럼, **구체 수치·사실 + 함의·관점** 의 두 절 압축 구조를 우선합니다.

기본 형태 — **두 절 압축형 (선호)**:
  앞 절 = **구체 수치·사건·종목** (concrete anchor — 14자 내외)
  뒤 절 = **그것의 함의·관점·대비** (thematic clause — 8~14자)
  두 절은 쉼표/줄임표로 자연스럽게 이음.
  앞 절의 concrete anchor 가 시장명·티커·수치를 포함하므로 "지수/시장/증시"
  단독 표기 문제는 자연스럽게 해소됩니다.

길이: **14~26자 권장** (이전 15~30보다 압축 쪽으로 권장 범위 이동).
완결문 강제 해제 — 두 절 압축에서는 명사 결합도 허용 (단, "환율 부담·금리"
처럼 무미한 명사 나열은 금지. 함의가 들어 있어야 함).

뒤 절의 함의 만드는 법 (오늘의 [서사 앵글] 과 [분석 렌즈] 활용):
  · 앵글 "글로벌→국내_전이" → "국내 개장의 갈림길", "한국으로 옮겨붙는 통로"
  · 앵글 "환율_양면성"      → "보유자와 신규의 다른 풍경", "두 얼굴의 환율"
  · 앵글 "섹터_분리_관찰"   → "섹터마다 다른 바닥", "갈라진 섹터 그림"
  · 앵글 "안전자산_위험자산" → "기우는 무게중심", "방어와 공격의 줄다리기"
  · 앵글 "구조_vs_일시"     → "노이즈인가 흐름인가", "사흘째 갇힌 자리"
  · 앵글 "확인_지표_체인"   → "체인의 두 번째 마디", "선행과 확인 사이"
  · 앵글 "시간대별_관전"    → "개장 30분의 가늠자", "장 마감까지 다른 풍경"
  · 앵글 "어제와_오늘_대비" → "어제와 정반대 시간", "사이의 빈 자리"
  앵글 가이드 그대로가 아니라, 오늘 데이터의 두드러진 점을 입혀 **새 표현**으로.

스타일 참고 — **두 절 압축형 (이걸 우선)**:
  · "유가 100달러, 직업마다 다른 명암"        (Market 4/29 — 수치 + 직업별 풍경)
  · "S&P500 사상 최고치, 반도체만 역주행"     (대조형 — 수치/시장 + 사건)
  · "환율 1,473원, 보유자와 신규의 다른 풍경" (수치 + 환율 양면성)
  · "SOXX -3.67%, 한국 반도체의 갈림길"       (수치 + 전이 통로)
  · "VIX 17.83, 선행과 확인 사이의 거리"      (수치 + 체인 마디)
  · "코스피 닷새째 박스, 두 신호 사이의 침묵" (사건 + 구조 함의)

스타일 참고 — **완결문형 (보조)**:
  · "미 증시 선행은 강하지만 환율이 제동을 겁니다"
  · "나스닥 반도체가 이끌고 미 금리가 뒤따릅니다"
  · "유가 반락에도 S&P500 강세가 이어집니다"

체크리스트/할 일 느낌 (어미 "확인", "점검", "~해야") 은 금지 그대로.

**P3 안전 바닥 — 절대 어기지 마십시오**:
  · "지수", "시장", "증시" 단독 표기 절대 금지. 두 절 압축형이라면 앞 절의
    concrete anchor 가 자연스럽게 시장을 특정하므로 이 문제는 잘 발생하지
    않습니다. 만약 뒤 절에서 "시장" 을 쓴다면 반드시 수식어 (미·국내·채권 등) 부착.
  · 06:30 KST 한국 독자가 "지수가 내렸다" 식 모호함에 노출되지 않게.

위 '최근 헤드라인' 블록에 있는 문장 구조·핵심 단어 조합을 재사용하지 마십시오.

- cover.subline은 결론과 제약 조건을 함께 담습니다. 반드시 서술어가 있는 완결문으로 씁니다.
- 같은 숫자와 같은 근거를 여러 섹션에서 반복하지 마십시오. 한 섹션에 쓴 핵심 근거는 다른 섹션에서 결론만 짧게 연결하십시오.
- **P1+ 보강 — 섹션 간 근사 중복 금지**:
  · overnightBrief.narrative / narrativeNotes.storySpine.act1 / usEtfHighlights.sectorNarrative 세 섹션은 **같은 사실을 다른 각도**로만 써야 합니다. "S&P500 -0.39%, 나스닥 -0.56% 하락 마감" 같은 동일 문장을 세 섹션에 각각 등장시키지 마십시오.
  · overnightBrief.narrative: 간밤 미국·유럽·환율에서 **일어난 사건** 을 시간 순 사실 정리.
  · narrativeNotes.storySpine.act1: 그 사실들이 **오늘의 중심 질문에 어떤 선행 신호를 주는지** 해석.
  · usEtfHighlights.sectorNarrative: 섹터 간 **어떤 그림이 만들어졌는지** 테마 해석.
  · 같은 수치(-0.39% 등)를 이 세 섹션에 인용할 때는 **한 번만 직접 인용**하고, 다른 섹션은 "앞서 본 대표지수 약세에도 불구하고…" 처럼 지시적으로 연결하십시오.
- **P1+ 보강 — '혼조' 사용 규칙**:
  · "혼조" 는 **국내 증시는·미 증시는·아시아 증시는** 같이 **여러 지수를 묶는 주어** 뒤에만 씁니다.
  · 단일 지수 이름(코스피·나스닥·S&P500 등)을 주어로 두고 "혼조 마감" 이라고 쓰지 마십시오. 하나의 지수는 혼조일 수 없습니다.
  · 예 OK: "전일 국내 증시는 코스피 상승·코스닥 하락의 혼조 마감이었습니다"
  · 예 NG: "전일 코스피는 혼조 마감(코스피 상승·코스닥 하락)"
- 국내 ETF 연결 문장은 "해외 선행 ETF/거시지표 → 국내 ETF 이름 (코드) → 장 초반 확인 지표" 순서로 씁니다.
- todayWatch.items는 정확히 3개를 작성합니다. 1번은 국내 개장 확인점, 2번은 환율/금리 확인점, 3번은 ETF 거래 실행 리스크입니다.
- todayWatch.items의 title은 코드가 확정한 Today Watch 1~3의 제목을 그대로 씁니다.
- todayWatch 각 항목의 body에는 ETF명 또는 수치가 최소 1개 들어가야 합니다.
- 문장은 독자에게 상황을 설명하고 맥락을 건네주는 기자·애널리스트 어조로 씁니다. 단, 투자 권유나 단정적 매수 지시는 피하십시오.

[준법·표현 규칙]
- **직접적인 매수 권유 어휘 금지**: "매수 후보", "접근 후보", "매수 검토", "신규 진입", "분할 접근", "비중 확대", "선호 ETF군" 등.
- 대신 독자가 자연스럽게 읽을 수 있는 **중립적 관찰 표현**을 상황에 맞게 골라 쓰십시오. 예: "관찰 대상", "지켜볼 상품", "눈여겨볼 ETF", "오늘 시선이 갈 만한 상품", "흐름을 읽어야 할 자리", "주목할 구간", "검토 대상", "확인할 포인트" 등.
- 같은 표현을 한 리포트 안에서 3회 이상 반복하지 마십시오. 문장마다 자연스럽게 바꿔 씁니다.
- "~확인합니다", "~봅니다", "~점검합니다" 같은 점검형 어미가 한 문단에 3회 넘게 반복되지 않도록 하십시오. "~이 의미 있습니다", "~에서 힌트를 얻을 수 있습니다", "~가 보여주는 이야기가 있습니다", "~가 오늘의 변수입니다" 같은 서술 방식을 섞어 씁니다.
- "전이"는 한 문단에 1회 이하로만 씁니다. 본문에서 "해외→국내" 연결을 서술할 때 문장 구조와 어휘를 매일 다르게 바꾸십시오.
- 숫자는 위 입력에 있는 값만 사용하십시오.
- 뉴스는 제목·출처·발행시각·URL이 제공된 참고 근거입니다. 기사 본문 내용을 단정하지 마십시오.
- "보도에 따르면", "전문가들은", "시장에서는" 같은 출처 없는 단정 표현을 쓰지 마십시오.
- "가능성이 존재합니다", "가능성이 있습니다", "구조입니다", "시사합니다", "나타냅니다", "판단됩니다", "보입니다"를 쓰지 마십시오.
- "직접 연결됩니다"를 쓰지 마십시오. "우호적 선행 신호", "거래대금으로 확인합니다"처럼 조건과 확인 지표를 함께 쓰십시오.
- "확인이 필요합니다"를 쓰지 마십시오. "거래대금", "NAV", "USD/KRW", "US 10Y"처럼 확인 대상을 직접 쓰십시오.
- "필수"를 쓰지 마십시오. 실행 기준과 확인 대상을 구체적으로 쓰십시오.
- "ETF은"처럼 어색한 조사를 쓰지 말고 "ETF는"으로 쓰십시오.
- 원화 금액은 긴 숫자로 쓰지 말고 "6,930억 원", "1.8조 원"처럼 축약하십시오.
- USD/KRW처럼 1,000 이상인 숫자는 반드시 쉼표를 넣어 "1,475"처럼 표기하십시오.
- 국내 ETF는 반드시 "종목명 (6자리 코드)"로 표기하십시오. "122630.KS KODEX 레버리지"나 "122630.KS" 형식은 금지입니다.
- 자금 유입, 자금 유출, 순유입, 순유출, 영문 flow 표현을 쓰지 마십시오.
- 매수/매도 지시를 하지 말고 ETF군별 확인 우선·관찰·경계로만 표현하십시오.

[narrativeNotes 작성 규칙 — 리포트 본문의 주요 내러티브 (Plan B 확장)]

리포트의 본문 여러 섹션 (bigPicture, Story Spine, Characters, Resolutions, 체크리스트,
ETF군별 전략 지도) 은 지금까지 코드가 매일 같은 문구로 박아 넣던 영역입니다. 이제 당신이
오늘 데이터를 반영해 직접 작성합니다. 입력의 [ETF군별 전략 지도] 의 rationale/actionGuide/avoid
문장은 **참고 데이터일 뿐, 그 문장을 그대로 복사하지 마십시오.** 오늘의 수치·흐름을 반영해
새로운 문장으로 씁니다.

narrativeNotes.bigPicture (Plan B — 4~6문장 자유 단락, 이 리포트의 narrative spine)
  - 위 [오늘의 서사 앵글] 을 본문 흐름의 중심으로 잡습니다. 앵글이 비어 있으면 분석 렌즈를 활용.
  - 한 호흡의 글로 풀어냅니다. 단편 나열이 아니라 **이야기**로 읽혀야 합니다.
  - 첫 문장에서 오늘의 큰 그림을 잡고, 중간에서 그 그림이 데이터로 어떻게 나타나는지 보여주고,
    마지막에서 한국 독자가 오늘 09:00 부터 무엇을 살피면 되는지로 닫습니다.
  - 구체 수치 2~4개를 자연스럽게 녹이되, 수치의 나열이 아니라 흐름 안에서 인용합니다.
  - 비유·은유는 사실을 명확히 만드는 한 사용해도 좋습니다. 단, AI 클리셰("폭풍전야" 등)는 금지.

narrativeNotes.storySpine (3개 act, 각 3~5문장 — Plan B 에서 확장)
  act1: 오늘의 주인공 ETF군과 그가 왜 오늘 서사의 중심에 서는지. 구체적 지수·섹터 움직임을 근거로.
  act2: 주인공이 마주한 제약 또는 변수 (환율·금리·변동성·수급 중 하나). 어떤 힘이 발목을 잡는지.
  act3: 독자가 장 초반 무엇을 보면 이 서사의 방향이 확정되는지. 구체 지표·시각·ETF를 명시.
  · 이 3막은 위 bigPicture 와 **같은 사실의 단순 반복이 아니라**, bigPicture 에서 잡은 큰 그림을
    구체 ETF·시점·확인 지표 차원으로 풀어 들어가는 디테일이어야 합니다.

narrativeNotes.characters (각 3~4문장 — Plan B 에서 확장)
  primary: 오늘의 주인공 ETF (예: 반도체 ETF)가 왜 오늘 주목되는지. 오늘 수치 기반으로.
  gate: 환율 영향을 받는 ETF가 왜 게이트 역할을 하는지. USD/KRW 수준 반영.
  alternative: 대안 ETF가 오늘 주도주가 아닌 이유. 장기채·배당·채권 중 하나.
  warning: 레버리지·인버스를 오늘 경계해야 하는 이유. 변동성 수치 근거.

narrativeNotes.resolutions (각 2~3문장 — Plan B 에서 확장)
  connect: 해외 신호가 국내 거래대금으로 이어지는 시나리오의 구체 묘사.
  delay: 해외 신호가 국내에 닿지 않는 경우 오늘의 대안은 무엇인지.
  overheat: 괴리율·얇은 호가·환율 재상승이 겹치는 경계 시나리오.

narrativeNotes.checklist (각 1~2문장씩, actions/avoids 3개)
  actions: 오늘 특별히 챙겨봐야 할 것 3가지 (일반론 금지, 오늘 상황 반영).
  avoids: 오늘 특별히 피해야 할 행동 3가지.

narrativeNotes.strategyProse (7개 그룹 — 입력 [ETF군별 전략 지도] 의 group 이름과 1:1 매칭)
  group: 그룹 이름 (예: "미국 대표지수 ETF", "반도체·AI ETF" 등 — 입력과 정확히 동일하게)
  rationale: 오늘 이 그룹이 왜 관심/관찰/경계 대상인지 1~2문장. 오늘 수치 근거.
  actionGuide: 오늘 이 그룹에 대한 행동 가이드 1~2문장.
  avoid: 오늘 이 그룹과 관련해 피할 행동 1~2문장.

[narrativeNotes 작성 규칙 — 엄격한 제약]
- 모든 narrativeNotes 필드는 **입력에 명시된 수치와 사실**만 인용. 입력에 없는 수치(외국인
  순매수 금액, 자산운용사 보도, 세대별 매매 비중 등)를 추측해 쓰지 마십시오.
- 입력 [ETF군별 전략 지도] 의 rationale/actionGuide/avoid 문장을 그대로 복사하지 마십시오.
  오늘 데이터를 근거로 다시 씁니다.
- 매일 다른 서술을 위해 **어제 리포트와 비슷한 프레임·어휘 조합을 의도적으로 피하십시오.**
- 길이 범위 엄수: 위에 지정된 문장 수 범위를 지키십시오. (Plan B 로 길이가 늘어났으므로 이전보다 더 풍성하게 쓸 수 있습니다.)
- **"확인합니다·점검합니다·봅니다" 어미는 narrativeNotes 전체 합쳐 최대 8회까지만** 사용.
  이를 넘길 것 같으면 "~가 오늘의 변수입니다", "~가 의미 있습니다", "~가 보여주는 이야기가
  있습니다", "~에서 힌트를 얻을 수 있습니다" 같은 서술로 다양화.
- **"확실", "확실한", "확실히", "분명", "틀림없이", "반드시" 같은 단정 어휘는 금지합니다.**
  예측·가능성을 다룰 때는 "~할 수 있습니다", "~가 기대됩니다", "~가 관전 포인트입니다"
  같은 조건부 표현을 쓰십시오.
- **중복 문장 엄격 금지**: narrativeNotes 의 모든 필드(storySpine·characters·resolutions·
  checklist.actions·checklist.avoids·strategyProse) 간, 그리고 이 위 섹션(overnightBrief,
  sectorNarrative, todayWatch 등)과도 **동일하거나 90% 유사한 문장을 두 번 이상 쓰지 마십시오.**
  같은 사실을 다른 각도에서 써야 한다면 문장 구조·주어·어휘를 모두 바꾸십시오.
- **같은 ETF·수치 재등장 규칙**: 특정 ETF (예: KODEX 레버리지)나 수치 (예: "거래대금 1.86조 원")
  가 여러 필드에서 언급될 수 있으나, 그 문장 자체는 **매번 완전히 다르게** 써야 합니다.
  · 안 됨: characters.warning 에서 "KODEX 레버리지 (122630)는 오늘 약 1.86조 원..." →
         strategyProse[레버리지].rationale 에서도 유사한 구조로 시작
  · 됨: 한 곳에서는 수치 중심, 다른 곳에서는 그 수치의 의미 중심, 또 다른 곳에서는
        대비·비교 중심으로 완전히 다른 서술 구조 사용
- **문체 검증 통과 필수 패턴**: 아래 표현들이 자동 검증에 걸리니 사용 금지입니다.
  · "확실", "분명", "틀림없이", "반드시" — 단정 금지
  · "가능성이 있습니다", "가능성이 존재합니다" — 전체 금지
  · "구조입니다", "시사합니다", "나타냅니다", "판단됩니다", "보입니다" — 전체 금지
  대신: "~의 신호입니다", "~가 관전 포인트입니다", "~를 시사하는 흐름입니다", "~의 배경으로
  볼 수 있습니다", "~라고 읽을 수 있습니다" 같은 **대체 표현**을 쓰십시오.

아래 JSON 형식으로만 응답하십시오:
{
  "cover": { "headline": "...", "subline": "..." },
  "overnightBrief": { "narrative": "...", "krImpact": "..." },
  "usEtfHighlights": {
    "topMover": { "ticker": "...", "reason": "..." },
    "bottomMover": { "ticker": "...", "reason": "..." },
    "sectorNarrative": "..."
  },
  "todayWatch": { "items": [{ "title": "...", "body": "..." }, { "title": "...", "body": "..." }, { "title": "...", "body": "..." }] },
  "closingLine": "...",
  "narrativeNotes": {
    "bigPicture": "오늘의 서사 앵글을 중심으로 4~6문장 자유 서술 단락. 이 리포트의 narrative spine.",
    "storySpine": { "act1": "...", "act2": "...", "act3": "..." },
    "characters": { "primary": "...", "gate": "...", "alternative": "...", "warning": "..." },
    "resolutions": { "connect": "...", "delay": "...", "overheat": "..." },
    "checklist": { "actions": ["...", "...", "..."], "avoids": ["...", "...", "..."] },
    "strategyProse": [
      { "group": "미국 대표지수 ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." },
      { "group": "반도체·AI ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." },
      { "group": "채권 ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." },
      { "group": "금·원자재 ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." },
      { "group": "환노출 해외 ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." },
      { "group": "레버리지·인버스 ETF", "rationale": "...", "actionGuide": "...", "avoid": "..." }
    ]
  }
}`
}

