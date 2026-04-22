// lib/claude-client.ts
import Anthropic from '@anthropic-ai/sdk'
import type { CollectedData, MorningReport } from './types'
import { buildMorningStrategyInput } from './morning-strategy'
import { validateMorningReportQuality } from './report-quality'
import { normalizeMorningReportLanguage } from './report-language'
import { buildMorningNarrativePlan } from './morning-report-plan'

// Lazy initialization: env vars may not be loaded at module parse time
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

const SYSTEM_PROMPT = `당신은 ETF 시장 분석 전문가입니다. 다음 원칙을 반드시 지키십시오.

[톤 & 스타일]
- 격식체 사용 ("~입니다", "~습니다")
- 수치를 먼저, 해석은 뒤에
- 1문장 = 1개념. 복문 금지
- 문장은 짧게 씁니다. 한 문장 80자 이내를 원칙으로 합니다.
- 모든 문장은 서술어가 있는 완결문으로 씁니다.
- "중립·선별 국면."처럼 명사로만 끝나는 조각 문장을 쓰지 마십시오.
- 중급 ETF 투자자 기준 (괴리율·추적오차·AUM 전문 용어 별도 설명 불필요)
- 차분하고 이성적인 보고서 문체로 씁니다.
- 독자를 압박하지 말고, 확인 순서와 보류 조건을 친절하게 설명합니다.
- 은유보다 정확한 금융 표현을 우선합니다.
- "관문", "장면", "불씨", "온도", "속도전"처럼 문학적이거나 구어적인 표현을 피합니다.
- "붙으면", "풀리면", "받아내다"처럼 구어적인 표현을 피합니다.
- "일반 매수 후보", "후보로 남깁니다"처럼 매수 권유로 읽힐 수 있는 표현을 피합니다.
- "신규 진입", "매수 검토", "분할 접근", "비중 확대", "선호 ETF군"처럼 투자권유로 읽힐 수 있는 표현을 피합니다.

[ETF 특화 규칙]
- 매수/매도 권유 절대 금지
- 이상 탐지 결과 과장 금지 ("폭락", "위험" 금지)
- 수치는 반드시 제공된 데이터에서만 인용, 임의 생성 절대 금지
- 가상의 인물, 가상의 사례, 날조된 통계 사용 금지

[금지 표현]
- "~할 수 있습니다" (추측성 완화)
- "투자에 주의하시기 바랍니다" (면피성 문구)
- 뻔한 비유 ("폭풍전야", "훈풍", "찬바람")
- 과한 이야기식 표현 ("대체 장면", "성장 신호의 전달자", "환율 관문")
- 매수 권유처럼 읽히는 표현 ("일반 매수 후보", "매수 후보", "접근 후보")
- 투자권유로 오해될 수 있는 표현 ("신규 진입", "매수 검토", "분할 접근", "비중 확대", "선호 ETF군")
- "확인이 필요합니다" 반복 금지. 대신 무엇을 확인할지 직접 쓰십시오.
- "가능성이 있습니다", "판단됩니다", "보입니다" 같은 흐린 문장 금지
- "필수"처럼 강한 단정 표현 금지. "우선", "점검", "분리"처럼 실행 기준으로 쓰십시오.

반드시 지정된 JSON 형식으로만 응답하십시오. 다른 텍스트는 일절 포함하지 마십시오.`

function extractJsonFromResponse(response: Anthropic.Message, reportType: string): string {
  if (response.content.length === 0) {
    throw new Error(`[claude-client] ${reportType} 응답이 비어 있습니다`)
  }
  const block = response.content[0]
  if (block.type !== 'text') {
    throw new Error(`[claude-client] ${reportType} 응답 타입이 text가 아닙니다: ${block.type}`)
  }
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const text = block.text.trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced ? fenced[1] : text
}

export async function generateMorningReport(data: CollectedData): Promise<MorningReport> {
  const prompt = buildMorningPrompt(data)
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
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
  report = normalizeMorningReportLanguage(report)
  validateMorningReportQuality(report, data, buildMorningStrategyInput(data))
  return report
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

  return `오늘 날짜: ${data.date}
분석 렌즈: ${data.analysisLens}

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

[주요 뉴스]
${data.news.slice(0, 6).map(n => `- ${n.title} (${n.source}, ${n.publishedAt}, ${n.url})`).join('\n')}
${data.recentHeadlines && data.recentHeadlines.length > 0 ? `
[최근 ETF 리포트 헤드라인 — 절대 반복·유사 표현 금지]
${data.recentHeadlines.map(h => `- ${h}`).join('\n')}
위 문장들과 3어절 이상 겹치거나 같은 구문 틀("~가 ~로 이어지는지", "~신호를 ~로 확인" 등)을 재사용하지 마십시오.
` : ''}
[작성 규칙]
- 위 시장 국면 점수와 ETF군별 전략 지도를 바꾸지 마십시오.
- 리포트는 하나의 중심 주제(오늘의 시장 인사이트)를 따라 작성하십시오.
- 모든 문단은 같은 논리 축을 이어받아야 합니다: "선행 신호 → 제약 조건 → 상품별 역할 → 확인 조건" 순서.
- ETF 상품은 단순 목록이 아니라 분석상 역할을 가져야 합니다. 예: 성장 신호 확인, 환율 영향 점검, 대안 관찰, 과열 경계.
- 리포트의 논리 순서: "오늘의 중심 주제 → 결론 → 결론의 근거 → 상품별 역할 → 국내 ETF 실행 확인점 → 리스크".
- overnightBrief.narrative는 간밤 해외시장 사실과 거시지표만 씁니다.
- overnightBrief.krImpact는 해외 ETF·환율·KRX 국내 ETF가 국내 개장에 미치는 연결만 씁니다.
- usEtfHighlights.sectorNarrative는 섹터 흐름만 씁니다. 환율·괴리율·자금흐름 설명을 반복하지 마십시오.

[cover.headline 작성 규칙]
- 반드시 **서술어가 있는 완결문**으로 씁니다. 길이 **15~30자**.
- 그날의 시장 인사이트를 **단정형**으로 표현합니다. 신문 헤드라인처럼 짧고 명확하게.
- 체크리스트/할 일 느낌 (어미 "확인", "점검", "~해야") 금지.
- 명사 나열로 끝내지 마십시오.
- 오늘 데이터에서 실제로 두드러진 대비·변화·신호를 한 줄로 압축합니다.
- 스타일 참고 (그대로 쓰지 말고 구조만 참고):
  · "해외 선행은 강하지만 환율이 제동을 겁니다" (대비형)
  · "반도체가 이끌고 금리가 뒤따릅니다" (순서형)
  · "배당 ETF 쏠림, 주말 모드의 신호" (함의형)
  · "유가 반락에도 증시 강세가 이어집니다" (역행형)
  · "같은 지수, 다른 바닥" (은유형)
- 위 '최근 헤드라인' 블록에 있는 문장 구조·핵심 단어 조합을 재사용하지 마십시오.

- cover.subline은 결론과 제약 조건을 함께 담습니다. 반드시 서술어가 있는 완결문으로 씁니다.
- 같은 숫자와 같은 근거를 여러 섹션에서 반복하지 마십시오. 한 섹션에 쓴 핵심 근거는 다른 섹션에서 결론만 짧게 연결하십시오.
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

[narrativeNotes 작성 규칙 — 리포트 본문의 주요 내러티브]

리포트의 본문 여러 섹션 (Story Spine, Characters, Resolutions, 체크리스트, ETF군별 전략 지도)
은 지금까지 코드가 매일 같은 문구로 박아 넣던 영역입니다. 이제 당신이 오늘 데이터를 반영해
직접 작성합니다. 입력의 [ETF군별 전략 지도] 의 rationale/actionGuide/avoid 문장은 **참고 데이터일
뿐, 그 문장을 그대로 복사하지 마십시오.** 오늘의 수치·흐름을 반영해 새로운 문장으로 씁니다.

narrativeNotes.storySpine (3개 act, 각 2~3문장)
  act1: 오늘의 주인공 ETF군과 그가 왜 오늘 서사의 중심에 서는지. 구체적 지수·섹터 움직임을 근거로.
  act2: 주인공이 마주한 제약 또는 변수 (환율·금리·변동성·수급 중 하나). 어떤 힘이 발목을 잡는지.
  act3: 독자가 장 초반 무엇을 보면 이 서사의 방향이 확정되는지. 구체 지표·시각·ETF를 명시.

narrativeNotes.characters (각 2~3문장)
  primary: 오늘의 주인공 ETF (예: 반도체 ETF)가 왜 오늘 주목되는지. 오늘 수치 기반으로.
  gate: 환율 영향을 받는 ETF가 왜 게이트 역할을 하는지. USD/KRW 수준 반영.
  alternative: 대안 ETF가 오늘 주도주가 아닌 이유. 장기채·배당·채권 중 하나.
  warning: 레버리지·인버스를 오늘 경계해야 하는 이유. 변동성 수치 근거.

narrativeNotes.resolutions (각 1~2문장)
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
- 길이 범위 엄수: 위에 지정된 문장 수를 넘기지 마십시오.
- **"확인합니다·점검합니다·봅니다" 어미는 narrativeNotes 전체 합쳐 최대 8회까지만** 사용.
  이를 넘길 것 같으면 "~가 오늘의 변수입니다", "~가 의미 있습니다", "~가 보여주는 이야기가
  있습니다", "~에서 힌트를 얻을 수 있습니다" 같은 서술로 다양화.

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

