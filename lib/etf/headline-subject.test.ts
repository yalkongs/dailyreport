// lib/etf/headline-subject.test.ts
// Ruling 35 (2026-10-20): 제목·미리보기 카드·페이지 모자이크가 같은 "오늘의 주제 자산군"을 다룬다.
// 10/20 제목 "바이오·반도체 오르고 유틸리티·부동산 밀렸다"(미국 섹터, '미국' 없이)와 카드 "2차전지를 갖고 있다면"
// (KODEX 2차전지산업 +8.20%)이 서로 다른 이야기를 했다 — 주제 자산군은 코드가 정하고(cardSlot), 제목이 그 자산군
// 이름을 담는지 검사한다(1·2회차 재생성 사유, 마지막 축소판은 경고만 — F02).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headlineCoversSlot, subjectAliasesOf, subjectNameOf, type SubjectSlot } from './headline-subject'
import { buildAssetClassSlots, cardSlot, pickFeaturedSlot, type AssetClassKey } from './asset-classes'
import { KR_ETF_UNIVERSE } from './universe'
import { validateMorningReportQuality } from './report-quality'
import { buildMorningStrategyInput } from './morning-strategy'
import type { CollectedData, EtfQuote, MorningReport } from './types'

const KR_LARGE: SubjectSlot = { key: 'kr-large', theme: null }
const KR_SEMI: SubjectSlot = { key: 'kr-semi', theme: '반도체' }
const sector = (theme: string): SubjectSlot => ({ key: 'kr-sector', theme })
const US_EQUITY: SubjectSlot = { key: 'us-equity', theme: null }
const BONDS: SubjectSlot = { key: 'bonds', theme: null }
const COMMODITIES: SubjectSlot = { key: 'commodities', theme: null }

// ─── 실제 사례 ─────────────────────────────────────────────────────────────
test('10/20 실제 사례: "바이오·반도체 오르고 유틸리티·부동산 밀렸다"는 주제 2차전지를 다루지 않는다', () => {
  assert.equal(headlineCoversSlot('바이오·반도체 오르고 유틸리티·부동산 밀렸다', sector('2차전지')), false)
})

test('10/19 실제 사례: "미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다"는 주제 헬스케어를 다룬다', () => {
  assert.equal(headlineCoversSlot('미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다', sector('헬스케어')), true)
  assert.equal(headlineCoversSlot('미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다', sector('방산')), true)
})

test('10/20 고친 제목: "2차전지 8% 급등, 미 바이오·반도체도 올랐다"는 주제 2차전지를 다룬다', () => {
  assert.equal(headlineCoversSlot('2차전지 8% 급등, 미 바이오·반도체도 올랐다', sector('2차전지')), true)
})

// ─── 국내 자산군(kr-*)은 해외 시장을 붙인 표현을 주제로 치지 않는다 ───────────────
test('kr-*: "미 ○○"·"美 ○○"처럼 해외 시장을 붙인 표현(· 목록 전체 포함)은 국내 주제가 아니다', () => {
  assert.equal(headlineCoversSlot('미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다', KR_SEMI), false)
  assert.equal(headlineCoversSlot('2차전지 8% 급등, 미 바이오·반도체도 올랐다', KR_SEMI), false) // '미'가 바이오·반도체 둘 다에 걸린다
  assert.equal(headlineCoversSlot('美 반도체 급락에 원화도 흔들렸다', KR_SEMI), false)
  assert.equal(headlineCoversSlot('중국 배터리 규제에 원자재 급락', sector('2차전지')), false)
  assert.equal(headlineCoversSlot('미 대형주 반등, 원화는 약세', KR_LARGE), false)
  // 같은 제목에 국내 언급이 따로 있으면 다룬 것
  assert.equal(headlineCoversSlot('미 반도체 급락에 국내 반도체도 밀렸다', KR_SEMI), true)
  assert.equal(headlineCoversSlot('미 증시 반등에 반도체 강세', KR_SEMI), true)
  assert.equal(headlineCoversSlot('미 반도체·국내 2차전지 동반 급등', sector('2차전지')), true)
  assert.equal(headlineCoversSlot('美 증시 훈풍, 반도체·2차전지 급등', sector('2차전지')), true)
})

// Ruling 41 (2026-10-20): 앞의 해외 시장 표시는 '·'뿐 아니라 ','·'，'·'와/과'·'및'·'그리고' 목록에도 이어진다.
// 뒤 항목에 국내 표시(국내·한국·코스피·코스닥)가 붙으면 거기서 끊긴다.
test('kr-*: 해외 시장 표시는 쉼표·와/과·및·그리고로 이은 목록에도 이어지고, 국내 표시에서 끊긴다', () => {
  assert.equal(headlineCoversSlot('미국 반도체·IT 동반 상승', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미국 반도체, IT 동반 상승', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미국 반도체，IT 동반 상승', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미 반도체와 IT가 함께 올랐다', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미 바이오와 반도체가 함께 올랐다', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미국 바이오 및 반도체 강세', KR_SEMI), false)
  assert.equal(headlineCoversSlot('미국 바이오 그리고 반도체 강세', KR_SEMI), false)
  // 국내 표시가 뒤 항목에 붙으면 국내 주제
  assert.equal(headlineCoversSlot('미 반도체와 국내 IT가 함께 올랐다', KR_SEMI), true)
  assert.equal(headlineCoversSlot('미 바이오, 한국 반도체 동반 강세', KR_SEMI), true)
  assert.equal(headlineCoversSlot('미 바이오, 코스닥·IT 동반 강세', KR_SEMI), true)
  // 여러 낱말로 된 앞 절(쉼표가 절을 나눈다)이나 '효과·인상과' 같은 낱말은 목록으로 보지 않는다
  assert.equal(headlineCoversSlot('미 반도체 4% 급락, IT는 버텼다', KR_SEMI), true)
  assert.equal(headlineCoversSlot('미 금리 인상과 반도체 급락', KR_SEMI), true)
})

// ─── 슬롯 유형별 양성·음성 ─────────────────────────────────────────────────
const CASES: Array<[string, SubjectSlot, string[], string[]]> = [
  ['kr-large', KR_LARGE,
    ['코스피 2% 반등, 미 증시는 숨 고르기', '대형주 반등에 원화도 강세', '국내 증시 반등, 환율은 1,330원대', '코스피200 급등'],
    ['반도체 급등, 원화는 강세', '미 반도체 4% 급락, 국내는 헬스케어·방산이 받쳤다', '코스닥 바이오 급등']],
  ['kr-semi', KR_SEMI,
    ['반도체 급등, 미 증시는 숨 고르기', 'HBM 기대에 하이닉스 급등', 'AI 반도체 랠리, 국내도 따라왔다', '국내 IT 대형주 반등', '삼성전자 반등에 소프트웨어도 올랐다'],
    ['2차전지 급등, 원화는 강세', '비트코인 급등, 원화는 약세', 'ITX 개통 소식에 건설 강세', '미 기술주 랠리에 원화 강세']],
  ['kr-sector 2차전지', sector('2차전지'),
    ['2차전지 8% 급등', '이차전지 반등, 미 증시는 쉬었다', '배터리 급등, 원화는 강세', '2차 전지 반등'],
    ['반도체 급등, 원화 강세', '전지현 효과에 미디어 강세']],
  ['kr-sector 헬스케어', sector('헬스케어'),
    ['바이오 급등, 원화 강세', '제약·바이오 반등에 원화 강세', '헬스케어 강세, 미 증시 혼조'],
    ['환율 제약에 반도체 주춤', '미 바이오 급등, 원화 강세']],
  ['kr-sector 원자력', sector('원자력'),
    ['원전 수주 기대에 급등', 'SMR 기대에 원자력 강세', '원자력 반등'],
    ['원화 강세에 반도체 반등', 'SMS 인증 대란']],
  ['kr-sector 금융', sector('금융'),
    ['금융주 반등, 원화 강세', '은행·보험 동반 강세', '증권주 급등'],
    ['금리 급등에 반도체 주춤', '금요일 반도체 반등']],
  ['kr-sector 중공업', sector('중공업'),
    ['중공업 급등, 조선 수주 기대', '조선 수주에 반등', '기계 수주 기대에 반등'],
    ['기계적 반등에 그친 반도체']],
  ['us-equity', US_EQUITY,
    ['나스닥 1% 반등, 원화 강세', 'S&P500 사상 처음 7,000', '미 증시 반등에 원화 강세', '미국 주식 강세, 원화는 약세', '다우 급락에 국내도 밀렸다', '미 기술주 랠리'],
    ['바이오·반도체 오르고 유틸리티·부동산 밀렸다', '미 금리 급등에 원화 약세', '코스피 반등, 반도체 주도']],
  ['bonds', BONDS,
    ['미 장기채 급락, 금리 5%대', '국채 강세, 원화 약세', '국고채 금리 하락', '채권 강세에 원화도 올랐다', '미 10년물 5% 돌파'],
    ['금리 5%대에 반도체가 버텼다', '금통위 앞두고 원화 강세']],
  ['commodities', COMMODITIES,
    ['금값 2% 급등', '금·은 동반 강세', '금 가격 사상 처음 4,000달러', '유가 급락에 원화 강세', '원유 반등, WTI 80달러', '은값 급등', '구리 급등에 원자재 강세', '금이 버텼다'],
    ['금리 5%대에 반도체가 버텼다', '금통위 앞두고 원화 강세', '금요일 반도체 반등', '금융주 급등', '지금 반도체는 숨 고르기', '현금 비중 늘어난 미 증시', '유가증권시장 반등', '반도체는 버텼다']],
]

for (const [label, slot, positives, negatives] of CASES) {
  test(`${label}: 다루는 제목은 통과, 다른 자산군 제목은 미통과`, () => {
    for (const h of positives) assert.equal(headlineCoversSlot(h, slot), true, `통과해야 함: ${h}`)
    for (const h of negatives) assert.equal(headlineCoversSlot(h, slot), false, `걸려야 함: ${h}`)
  })
}

test('강조 태그(<strong> 등)는 벗기고 본다', () => {
  assert.equal(headlineCoversSlot('<strong>2차전지</strong> 8% 급등', sector('2차전지')), true)
  assert.equal(headlineCoversSlot('<em>금</em>리 5%대에 반도체가 버텼다', COMMODITIES), false)
})

test('문자열이 아니거나 비어 있으면 다루지 않은 것으로 본다', () => {
  assert.equal(headlineCoversSlot('', KR_SEMI), false)
  assert.equal(headlineCoversSlot(undefined as unknown as string, KR_SEMI), false)
})

// ─── 유니버스 드리프트: 국내 섹터·테마 theme 전부 이름(과 같은 뜻 단어)으로 인정 ───────────
test('국내 섹터 슬롯이 될 수 있는 theme 전부: 주제 이름과 같은 뜻 단어가 제목에 있으면 통과', () => {
  const themes = [...new Set(KR_ETF_UNIVERSE
    .filter(e => !e.foreignUnderlying && (e.category === '섹터' || e.category === '테마') && e.theme && !['반도체', 'AI', 'IT'].includes(e.theme))
    .map(e => e.theme as string))]
  assert.ok(themes.length >= 15, themes.join(','))
  for (const theme of themes) {
    const slot = sector(theme)
    assert.equal(subjectNameOf(slot), theme)
    assert.equal(headlineCoversSlot(`${theme} 급등, 원화 강세`, slot), true, theme)
    assert.ok(subjectAliasesOf(slot).length > 0, `${theme}: 같은 뜻 단어(프롬프트 안내)`)
    for (const alias of subjectAliasesOf(slot)) assert.equal(headlineCoversSlot(`${alias} 급등, 원화 강세`, slot), true, `${theme}/${alias}`)
  }
})

test('슬롯 유형마다 프롬프트에 주는 이름·같은 뜻 단어는 모두 검사에서도 통과한다(프롬프트와 검사가 같은 말)', () => {
  for (const slot of [KR_LARGE, KR_SEMI, US_EQUITY, BONDS, COMMODITIES, sector('헬스케어')]) {
    const words = [subjectNameOf(slot), ...subjectAliasesOf(slot)]
    for (const w of words) assert.equal(headlineCoversSlot(`${w} 급등, 원화 강세`, slot), true, `${slot.key}/${w}`)
  }
  assert.equal(subjectNameOf(KR_LARGE), '국내 대형주')
  assert.equal(subjectNameOf(KR_SEMI), '국내 반도체')
  assert.equal(subjectNameOf(US_EQUITY), '미국 주식')
  assert.equal(subjectNameOf(BONDS), '채권')
  assert.equal(subjectNameOf(COMMODITIES), '금·원자재')
})

// ─── 검증 연결(report-quality): 10/20 데이터 모양 — 주제 2차전지 ─────────────────
const q = (ticker: string, name: string, pct: number): EtfQuote => ({
  ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
} as EtfQuote)

// 10/20: KODEX 2차전지산업 +8.20%가 국내 최대 움직임(카드 "2차전지를 갖고 있다면"), 미국은 바이오·반도체 강세.
const OCT20_QUOTES = [
  q('305720.KS', 'KODEX 2차전지산업', 8.2), q('305540.KS', 'TIGER 2차전지테마', 7.1),
  q('069500.KS', 'KODEX 200', 1.7), q('091160.KS', 'KODEX 반도체', 2.4),
  q('360750.KS', 'TIGER 미국S&P500', 0.6), q('SPY', 'SPDR S&P 500', 0.5),
  q('TLT', 'iShares 20+ Year Treasury', -0.74), q('GLD', 'SPDR Gold', -0.3),
]
const OCT20: CollectedData = {
  reportType: 'morning', date: '2026-10-20', quotes: OCT20_QUOTES, flows: [], investorFlows: [], news: [], analysisLens: '',
  macro: { usdKrw: 1332, dxy: null, vix: 16, moveIndex: null, us10y: 4.4, fearGreed: null, wti: null, gold: null },
}

const CARD_TEXT: Record<string, [string, string]> = {
  'kr-sector': ['전일 강세가 오전에도 거래대금과 함께 이어지는지 지켜볼 때입니다.', '하루 급등 뒤에는 되돌림 폭부터 살필 자리입니다.'],
  'kr-semi': ['간밤 미국 반도체 강세가 개장 흐름에 실리는지 볼 때입니다.', '거래대금이 붙는지 확인한 뒤 판단할 일입니다.'],
  'kr-large': ['대형주 전반이 오름세를 지키는지 지켜볼 자리입니다.', '업종별 온도 차가 줄어드는지 먼저 살필 때입니다.'],
  'us-equity': ['원화 강세는 환노출 상품의 원화 환산 성과를 일부 줄입니다.', '환율 방향을 함께 보며 판단할 자리입니다.'],
  bonds: ['미 국채 금리가 높은 구간을 이어가는지가 관건입니다.', '금리 방향이 정해지기 전까지 장기채 변동성을 염두에 둘 때입니다.'],
  commodities: ['금 가격이 숨 고르기에서 벗어나는지 지켜볼 자리입니다.', '달러 흐름과 함께 금의 방향을 볼 때입니다.'],
}

function oct20Report(headline: string): MorningReport {
  const slots = buildAssetClassSlots(OCT20_QUOTES)
  return {
    cover: { headline, subline: '간밤 미 증시는 바이오·반도체가 올랐고 국내에서는 2차전지 상품이 가장 크게 움직였습니다.' },
    summary: {
      overseas: '간밤 미 증시는 업종별로 엇갈린 채 마감했습니다.',
      domestic: '전일 국내 증시는 2차전지가 강하게 오르며 마감했습니다.',
      focus: '2차전지 강세가 오늘 오전에도 이어지는지가 핵심입니다.',
    },
    assetCards: slots.map(s => ({ key: s.key, ifHolding: CARD_TEXT[s.key][0], ifConsidering: CARD_TEXT[s.key][1] })),
    todayChecks: [
      { time: '09:00~09:30', what: '국내 2차전지 ETF 개장 흐름', baseline: '전일 종가', invalidation: '상승분을 바로 반납하면 추세 가설은 접습니다' },
      { time: '15:30', what: '국내 증시 마감 방향', baseline: '전일 종가', invalidation: '마감까지 약세로 돌면 강세 연장 가설은 버립니다' },
      { time: '21:30', what: '미국 주요 지표 발표', baseline: '시장 예상치', invalidation: '예상과 크게 다르면 다음 거래일에 다시 봅니다' },
    ],
    card: { key: pickFeaturedSlot(slots)?.key ?? 'kr-sector', line: '급등 다음 날 거래대금이 따라붙는지 지켜볼 때입니다' },
  }
}

function errorOf(fn: () => void): string {
  try { fn(); return '' } catch (e) { return (e as Error).message }
}
const validate = (r: MorningReport, last = false) =>
  errorOf(() => validateMorningReportQuality(r, OCT20, buildMorningStrategyInput(OCT20), last ? { factChecksAsWarnings: true } : {}))

test('픽스처 전제(10/20 모양): 주제 슬롯은 국내 섹터 2차전지, 주제를 다룬 제목은 통과', () => {
  const slots = buildAssetClassSlots(OCT20_QUOTES)
  const featured = cardSlot(slots, undefined)
  assert.equal(featured?.key, 'kr-sector')
  assert.equal(featured?.theme, '2차전지')
  assert.equal(validate(oct20Report('2차전지 8% 급등, 미 바이오·반도체도 올랐다')), '')
})

test('10/20 실제 제목: 1회차는 위반(재생성 사유) "제목이 오늘의 주제 자산군(2차전지)을 다루지 않음"', () => {
  const msg = validate(oct20Report('바이오·반도체 오르고 유틸리티·부동산 밀렸다'))
  assert.match(msg, /제목이 오늘의 주제 자산군\(2차전지\)을 다루지 않음/)
  assert.match(msg, /바이오·반도체 오르고 유틸리티·부동산 밀렸다/)
  assert.doesNotMatch(msg, /미리보기 카드 문구/) // 카드 문구 위반이 아니라 기준 위반
})

test('10/20 실제 제목: 마지막 축소판은 경고만 남기고 통과(F02 전송 > 침묵)', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const r = oct20Report('바이오·반도체 오르고 유틸리티·부동산 밀렸다')
  assert.equal(validate(r, true), '')
  assert.equal(r.cover.headline, '바이오·반도체 오르고 유틸리티·부동산 밀렸다')
  assert.ok(warn.mock.calls.some(c => /\[subject-warn\][\s\S]*제목이 오늘의 주제 자산군\(2차전지\)을 다루지 않음/.test(String(c.arguments[0]))))
})

test('주제는 카드와 같은 슬롯(cardSlot): 1·2회차에 card.key가 다른 슬롯이면 그 슬롯을 다뤄야 한다', () => {
  const semiCard = oct20Report('반도체 반등, 미 증시도 올랐다'); semiCard.card.key = 'kr-semi'
  assert.equal(validate(semiCard), '')
  const mismatch = oct20Report('2차전지 8% 급등, 미 바이오·반도체도 올랐다'); mismatch.card.key = 'kr-semi'
  assert.match(validate(mismatch), /제목이 오늘의 주제 자산군\(국내 반도체\)을 다루지 않음/)
})

test('마지막 시도: 슬롯 밖 card.key를 주제 슬롯으로 교정한 뒤 그 슬롯으로 검사한다(교정과 검사가 같은 슬롯)', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const r = oct20Report('2차전지 8% 급등, 미 바이오·반도체도 올랐다'); r.card.key = 'kr-nowhere' as unknown as AssetClassKey
  assert.equal(validate(r, true), '')
  assert.equal(r.card.key, 'kr-sector')
  assert.ok(!warn.mock.calls.some(c => /\[subject-warn\]/.test(String(c.arguments[0]))), '교정된 주제 슬롯(2차전지)을 다룬 제목이라 경고 없음')
})

test('자산군 슬롯이 하나도 없는 날은 주제 검사를 하지 않는다', () => {
  const empty: CollectedData = { ...OCT20, quotes: [] }
  const r = oct20Report('미 증시 반등, 원화 강세')
  const msg = errorOf(() => validateMorningReportQuality(r, empty, buildMorningStrategyInput(empty)))
  assert.doesNotMatch(msg, /주제 자산군/)
})
