// lib/etf/claude-client.prompt.test.ts
// 묶음 3(2026-09-30): 조립된 ETF 프롬프트가 통합 제목 정책을 담고, 제거한 옛 지시가 없는지.
// 픽스처의 최근 헤드라인·뉴스는 금지 문구가 없는 값으로만 채운다(입력 인용 구간 오탐 방지).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildMorningPrompt } from './claude-client'
import { getMarketCalendarInfo } from '../market-calendar'
import type { CollectedData, EtfQuote, MacroContext } from './types'

interface Opts { angle?: string; mode?: 'event' | 'quiet' | 'normal'; tier?: 'strong' | 'thin' | 'hollow' }
function makeData(date: string, recentHeadlines: string[], o: Opts = {}): CollectedData {
  return {
    reportType: 'morning',
    date,
    quotes: [],
    flows: [],
    investorFlows: [],
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null } as MacroContext,
    news: [],
    analysisLens: '변동성국면',
    recentHeadlines,
    narrativeAngle: o.angle ?? '글로벌→국내_전이',
    calendarInfo: getMarketCalendarInfo(date),
    failedSources: [],
    ...(o.mode ? { etfMode: { mode: o.mode, reason: '테스트', metrics: { soxxChange: null, spyChange: null, kospiProxy: null, vix: null, anomalyCount: 0 } } as any } : {}),
    ...(o.tier ? { etfEvidence: { tier: o.tier, newsCount: 0, freshCount: 0, topCatalystScore: 0, topCatalyst: null, anomalyCount: 0, failedSources: [], reason: '테스트' } } : {}),
  }
}

const REMOVED = [
  '앵커(수치·티커) **하나**를 앞세우되',
  '반드시 명사구',
  '홀로 하락',
  '반도체 6% 붕괴',
  '옮겨붙',
  '두 얼굴',
  '불씨가 옮겨가는',
  '헤드라인은 "주말 뒤 시작"',
  '헤드라인은 "한 주를 닫는"',
]

test('ETF 사용자 프롬프트(월요일·최근 헤드라인 있음): 새 제목 정책 포함, 옛 지시 없음', () => {
  const p = buildMorningPrompt(makeData('2026-09-28', ['원자재 강세 속 금융주 선방']))
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
  assert.match(p, /등락률·티커를 제목 맨 앞 앵커로 두지 마십시오/)
  assert.match(p, /시간명사 종결/)
  assert.match(p, /3\. 근거 상태\(tier\)/)
  assert.match(p, /\[최근 ETF 리포트 헤드라인/)
  for (const s of REMOVED) assert.ok(!p.includes(s), s)
})

test('ETF 사용자 프롬프트(금요일): 요일 리듬에 헤드라인 지시 없음', () => {
  const p = buildMorningPrompt(makeData('2026-09-18', []))
  assert.match(p, /금요일 회수/)
  for (const s of REMOVED) assert.ok(!p.includes(s), s)
})

test('최근 헤드라인이 없어도 제목 정책은 온전하다(깨진 블록 참조 없음)', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.doesNotMatch(p, /\[최근 ETF 리포트 헤드라인 — 같은/)
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
  assert.match(p, /최근 ETF 리포트 헤드라인\]에 이미 등장했으면/) // 조건부 참조 문구는 "있을 때" 규칙으로 유지
})

test('ETF 시스템 프롬프트: 제목 예시는 사용자 프롬프트로(순환) + 본문 규칙의 제목 예외 표기', () => {
  assert.ok(!SYSTEM_PROMPT.includes('### 지향할 헤드라인 결'))
  assert.match(buildMorningPrompt(makeData('2026-09-28', [])), /\[오늘 참고할 제목 예시/)
  assert.ok(!SYSTEM_PROMPT.includes('금리 올린 연준, 달러만 웃었다'))
  assert.match(SYSTEM_PROMPT, /격식체 사용 \("~입니다", "~습니다"\) \(cover\.headline 제외/)
  assert.match(SYSTEM_PROMPT, /도치를 허용합니다\. \(cover\.headline 제외/)
})

test('국내 ETF 6자리 코드 규칙에 제목 예외 표기', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.match(p, /"종목명 \(6자리 코드\)"로 표기하십시오\. \(cover\.headline 제외 — \[cover\.headline 작성 규칙\] 참조\)/)
  // Ruling 33: 한 줄 예시 — 괄호로 감싼 형태와 금지 형태.
  assert.match(p, /예: "KODEX 반도체 \(091160\)"처럼 코드를 괄호로 감쌉니다\. 괄호 없는 "KODEX 반도체 091160"은 금지입니다\./)
})

test('Ruling 31: 제목 작성 규칙에 기간 비교·최상급 금지(제목·카드 문구)', () => {
  const p = buildMorningPrompt(makeData('2026-10-19', []))
  const rules = p.slice(p.indexOf('[cover.headline 작성 규칙]'))
  assert.match(rules, /제목·카드 문구\(cover\.headline·card\.line\)에는 'N년치·N개월치', '역대·사상 최대\/최고\/최저', 'N년 만에 최고\/최저', '연중 최고\/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않습니다 — 입력 데이터로 확인되는 수치와 사실만 씁니다/)
  for (const s of REMOVED) assert.ok(!p.includes(s), s)
})

test('환율 앵글: "두 얼굴" 대신 "상반된 효과"', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', [], { angle: '환율_양면성' }))
  assert.match(p, /오늘의 서사 앵글: 환율_양면성/)
  assert.match(p, /상반된 효과/)
  assert.ok(!p.includes('두 얼굴'))
})

test('이벤트·잠잠 모드와 명시 tier에서도 옛 지시·깨진 참조가 없다', () => {
  for (const mode of ['event', 'quiet', 'normal'] as const) {
    for (const tier of ['strong', 'thin', 'hollow'] as const) {
      const p = buildMorningPrompt(makeData('2026-09-30', ['원자재 강세 속 금융주 선방'], { mode, tier }))
      assert.match(p, new RegExp(`근거 상태 — tier: ${tier}`))
      assert.ok(!p.includes('[제목 작성 규칙]'), `${mode}/${tier} 깨진 참조`)
      for (const s of REMOVED) assert.ok(!p.includes(s), `${mode}/${tier}: ${s}`)
    }
  }
})

// ─── 2026-10-17 아침 리포트 개편: 새 출력 스키마 ──────────────────────────
const pq = (ticker: string, name: string, pct: number): EtfQuote => ({
  ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
} as EtfQuote)

const SLOT_QUOTES = [
  pq('069500.KS', 'KODEX 200', -8.21), pq('091160.KS', 'KODEX 반도체', -11.94), pq('396500.KS', 'TIGER 반도체TOP10', -10.86),
  pq('122630.KS', 'KODEX 레버리지', -16.42), pq('360750.KS', 'TIGER 미국S&P500', -1.04), pq('SPY', 'SPDR S&P 500', 0.28),
  pq('TLT', 'iShares 20+ Year Treasury', 0.4), pq('GLD', 'SPDR Gold', 0.5), pq('305080.KS', 'TIGER 미국채10년선물', -0.2),
]

function withQuotes(date: string, quotes: EtfQuote[], o: Opts = {}): CollectedData {
  return { ...makeData(date, [], o), quotes }
}

function slotBlock(p: string): string {
  const start = p.indexOf('[자산군 슬롯 — 코드가 확정]')
  assert.ok(start >= 0, '자산군 슬롯 블록')
  return p.slice(start, p.indexOf('\n\n', start))
}

const OLD_SCHEMA = ['narrativeNotes', 'bigPicture', 'storySpine', 'characters', 'strategyProse', 'todayWatch', 'Today Watch', 'overnightBrief', 'usEtfHighlights', 'sectorNarrative', 'closingLine', 'checklist']

test('새 스키마: 자산군 슬롯 블록(코드 확정)·카드 key·숫자 반복 금지·JSON 필드', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  const block = slotBlock(p)
  assert.match(block, /kr-semi \| 국내 반도체·IT \| 대표 ETF 예시: KODEX 반도체 \(091160\) -11\.94% · TIGER 반도체TOP10 \(396500\) -10\.86%/)
  assert.match(block, /us-equity \| 미국 주식\(환노출\) \| 대표 ETF 예시: TIGER 미국S&P500 \(360750\) -1\.04% · SPY SPDR S&P 500 \+0\.28%/)
  assert.doesNotMatch(block, /122630/)
  assert.match(block, /숫자는 화면에 코드가 표시하므로 문장에 반복하지 마십시오/)
  assert.match(p, /card\.key는 "kr-semi"/)
  assert.match(p, /"반도체를 갖고 있다면"/)
  for (const field of ['"summary"', '"overseas"', '"domestic"', '"focus"', '"assetCards"', '"ifHolding"', '"ifConsidering"', '"todayChecks"', '"baseline"', '"invalidation"', '"card"', '"line"']) {
    assert.ok(p.includes(field), field)
  }
  assert.match(p, /todayChecks는 정확히 3개/)
  assert.match(p, /40자 이내/)
  assert.doesNotMatch(p, /32자 이내/)
})

test('새 스키마: assetCards 예시는 오늘 슬롯 key를 슬롯 순서대로 전부 담는다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  const keys = [...p.matchAll(/\{ "key": "([a-z-]+)", "reason"/g)].map(m => m[1])
  assert.deepEqual(keys, ['kr-semi', 'kr-large', 'us-equity', 'commodities', 'bonds'])
})

test('tacticalWarning: 레버리지·인버스 |등락| 10% 이상이면 작성, 아니면 생략 지시', () => {
  const hot = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  assert.match(hot, /KODEX 레버리지 \(122630\) -16\.42%[^\n]*tacticalWarning을 작성/)
  const calm = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES.map(x => (x.ticker === '122630.KS' ? { ...x, changePercent: -4 } : x))))
  assert.match(calm, /tacticalWarning 필드를 넣지 마십시오/)
})

test('새 스키마: 옛 필드 지시가 모든 모드·요일에서 사라졌다', () => {
  for (const date of ['2026-09-28', '2026-09-30', '2026-09-18']) {
    for (const mode of ['event', 'quiet', 'normal'] as const) {
      const p = buildMorningPrompt(withQuotes(date, SLOT_QUOTES, { mode, tier: 'thin' }))
      for (const s of OLD_SCHEMA) assert.ok(!p.includes(s), `${date}/${mode}: ${s}`)
    }
  }
})

test('새 스키마: 유지해야 할 공통 블록과 사실 규칙이 남아 있다', () => {
  const data = withQuotes('2026-10-16', SLOT_QUOTES)
  data.indices = [{ symbol: '^KS11', nameKo: '코스피', price: 6035.35, changePercent: -5.46, asOf: '2026-10-15' }]
  const p = buildMorningPrompt(data)
  assert.match(p, /\[독자·발행 맥락/)
  assert.match(p, /\[지수 실측 — ETF와 구분\]/)
  assert.match(p, /\[거시 지표\]/)
  assert.match(p, /본문에 매체명을 인용할 수 있는 것은 다음뿐/)
  assert.match(p, /\*\*기간\*\*: 입력의 ETF·지수 등락률은 모두 직전 거래일 하루/)
  assert.match(p, /\*\*환율 효과 방향\*\*/)
  assert.match(p, /근거와 추론의 경계/)
  assert.match(p, /\[준법·표현 규칙\]/)
  assert.match(p, /국내 시장 스트레스: 전일 KODEX 200 -8\.21% 급락/)
  assert.match(p, /조건·관찰형/)
  assert.doesNotMatch(p, /확인 우선·관찰·경계로만/) // 제거한 전략 지도 블록의 잔재
})

// ─── I1 (Ruling 22): 06:40 실행에는 KRX 거래대금이 없다 — 종가×거래량 추정값으로, 추정임을 밝혀 준다 ───
const vq = (ticker: string, name: string, price: number, volume: number, tradingValue?: number): EtfQuote => ({
  ...pq(ticker, name, 0.5), price, volume, ...(tradingValue !== undefined ? { tradingValue } : {}),
} as EtfQuote)

test('거래대금 상위: KRX 거래대금이 없으면(06:40) 국내 종가×거래량 추정값을 추정 표기와 함께 준다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-19', [
    vq('069500.KS', 'KODEX 200', 40000, 1_000_000), // 400억
    vq('091160.KS', 'KODEX 반도체', 50000, 3_000_000), // 1,500억
    vq('SPY', 'SPDR S&P 500', 600, 90_000_000), // 미국은 이 줄에 넣지 않는다(국내 ETF 블록·원 단위)
  ]))
  const line = p.split('\n').find(l => l.includes('거래대금 상위'))
  assert.ok(line, '거래대금 줄')
  assert.doesNotMatch(line, /N\/A/)
  assert.match(line, /추정/)
  assert.match(line, /종가×거래량/)
  assert.match(line, /KODEX 반도체 \(091160\) 150,000,000,000원 \/ KODEX 200 \(069500\) 40,000,000,000원/)
  assert.doesNotMatch(line, /SPY/)
})

test('거래대금 상위: KRX 거래대금이 있으면 실제 값을 그대로(추정 표기 없이) 쓴다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-19', [
    vq('069500.KS', 'KODEX 200', 40000, 1_000_000, 41_000_000_000),
    vq('091160.KS', 'KODEX 반도체', 50000, 3_000_000, 152_000_000_000),
  ]))
  const line = p.split('\n').find(l => l.includes('거래대금 상위'))
  assert.ok(line)
  assert.match(line, /^거래대금 상위: KODEX 반도체 \(091160\) 152,000,000,000원 \/ KODEX 200 \(069500\) 41,000,000,000원$/)
})

test('06:40 근거 상태: 실패한 데이터 소스에 krx-nav가 없다(KRX 미게시는 실패가 아님)', () => {
  const p = buildMorningPrompt(makeData('2026-10-19', [], { tier: 'thin' }))
  assert.match(p, /실패한 데이터 소스: 없음/)
})

// ─── Ruling 35 (2026-10-20): 오늘의 주제 자산군 — 제목·카드·모자이크가 같은 자산군을 다룬다 ───
// 10/20 제목 "바이오·반도체 오르고 유틸리티·부동산 밀렸다"(미국 섹터)와 카드 "2차전지를 갖고 있다면"이 따로 놀았다.
// 주제 슬롯(카드 슬롯)을 프롬프트에 이름과 함께 주고, 제목 규칙 1번에 필수 규칙으로 둔다.
function headlineSection1(p: string): string {
  const rules = p.slice(p.indexOf('[cover.headline 작성 규칙]'))
  return rules.slice(0, rules.indexOf('2. 종결'))
}

// 10/20 모양: KODEX 2차전지산업 +8.20%가 국내 최대 움직임
const OCT20_QUOTES = [
  pq('305720.KS', 'KODEX 2차전지산업', 8.2), pq('305540.KS', 'TIGER 2차전지테마', 7.1),
  pq('069500.KS', 'KODEX 200', 1.7), pq('091160.KS', 'KODEX 반도체', 2.4), pq('SPY', 'SPDR S&P 500', 0.5),
]

test('Ruling 35: 슬롯 블록에 오늘의 주제 자산군(카드 슬롯)과 제목에 넣을 이름을 준다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  const block = slotBlock(p)
  assert.match(block, /card\.key는 "kr-semi"/)
  assert.match(block, /오늘의 주제 자산군: kr-semi \| 국내 반도체·IT — 제목\(cover\.headline\)·미리보기 카드·페이지 모자이크가 모두 이 자산군을 다룹니다/)
  assert.match(block, /제목에 넣을 이름: "국내 반도체"\(같은 뜻으로 인정: 반도체·IT·AI·HBM·하이닉스·삼성전자·소프트웨어\)/)
})

test('Ruling 35: 제목 규칙 1번에 주제 자산군 필수 규칙(이름 포함·해외 원인 대비 허용·해외 표시는 국내 주제 아님)', () => {
  const s1 = headlineSection1(buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES)))
  assert.match(s1, /주제 자산군 \(필수 — 아래 tier·catalyst·반복 회피 규칙보다 우선\)/)
  assert.match(s1, /제목은 오늘의 주제 자산군\(국내 반도체\)의 움직임을 반드시 다루고, 제목에 그 자산군 이름\("국내 반도체" 또는 "반도체"·"IT"/)
  assert.match(s1, /"반도체를 갖고 있다면"/)
  assert.match(s1, /해외 원인·다른 자산군과의 대비는 함께 써도 됩니다\(예: "미 반도체 급락에도 국내 헬스케어 ETF 강세"\)\. 세 후보 모두에 적용됩니다\./)
  assert.match(s1, /"미 ○○"처럼 해외 시장을 붙인 표현은 국내 주제를 다룬 것으로 치지 않습니다/)
})

test('Ruling 35: 국내 섹터가 주제인 날(10/20 모양)은 theme 이름(2차전지)과 같은 뜻 단어를 준다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-20', OCT20_QUOTES))
  assert.match(p, /card\.key는 "kr-sector"/)
  assert.match(slotBlock(p), /오늘의 주제 자산군: kr-sector \| 2차전지 — /)
  const s1 = headlineSection1(p)
  assert.match(s1, /제목은 오늘의 주제 자산군\(2차전지\)의 움직임을 반드시 다루고, 제목에 그 자산군 이름\("2차전지" 또는 "이차전지"·"배터리"\)을 넣습니다/)
  assert.match(s1, /"2차전지를 갖고 있다면"/)
})

test('Ruling 35: 최근 헤드라인 반복 금지는 주제 자산군 이름을 막지 않는다(예외 명시)', () => {
  const p = buildMorningPrompt({ ...withQuotes('2026-10-20', OCT20_QUOTES), recentHeadlines: ['2차전지 반등, 원화는 강세'] })
  const block = p.slice(p.indexOf('[최근 ETF 리포트 헤드라인 — 같은'))
  assert.match(block.split('\n').slice(0, 5).join('\n'), /단, 오늘의 주제 자산군 이름\("2차전지" 등\)은 예외입니다 — 최근 헤드라인에 있어도 제목에 넣고, 각도·동사를 바꿉니다/)
})

test('Ruling 35: 시장 특정 규칙 — 해외 시장의 섹터·자산 단어에는 시장(미·미국·중국 등)을 붙인다', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-20', OCT20_QUOTES))
  const rules = p.slice(p.indexOf('[cover.headline 작성 규칙]'))
  assert.match(rules, /- 시장 특정: "지수\/시장\/증시" 단독 표기 금지\.[^\n]*해외 시장의 섹터·자산을 가리키는 단어\(반도체·바이오·유틸리티·부동산·기술주 등\)에는 반드시 그 시장\(미·미국·중국 등\)을 붙입니다/)
  assert.match(rules, /"바이오·반도체 올랐다"가 아니라 "미 바이오·반도체 올랐다"/)
})

test('Ruling 35: 자산군 슬롯이 없는 날은 주제 규칙을 넣지 않고 깨진 값(undefined)도 없다', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.doesNotMatch(p, /오늘의 주제 자산군/)
  assert.doesNotMatch(p, /undefined/)
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
})

test('2026-10-27 제목 편집 기준: 공통 기준·순환 예시·후보 스키마, 옛 은유·예시 동사 지시 없음', () => {
  const p = buildMorningPrompt(withQuotes('2026-10-16', SLOT_QUOTES))
  assert.match(p, /\[제목 편집 기준 — Market·ETF 공통\]/)
  assert.match(p, /\[오늘 참고할 제목 예시/)
  assert.match(p, /"headlineCandidates": \[/)
  assert.match(p, /summary와의 관계: summary 세 줄은 제목과 같은 주제를 다루되/)
  for (const gone of ['(되찾다·버텼다·무너졌다)', '헬스케어가 받쳤다', '이미지를 받아 전개', '신선한 은유와 단정을 허용', 'tier 는 강도만 정합니다']) {
    assert.ok(!p.includes(gone), gone)
  }
  assert.ok(!SYSTEM_PROMPT.includes('신선하고 구체적인 은유·관점은 권장'))
  const withRecent = buildMorningPrompt({ ...withQuotes('2026-10-16', SLOT_QUOTES), recentHeadlines: ['A, B', 'C, D', 'E, F', 'G', 'H', 'I', 'J'] })
  assert.match(withRecent, /- A, B 〔쉼표 두 토막〕/)
  assert.ok(!withRecent.includes('- I 〔'), '최근 제목은 앞 5건만')
})
