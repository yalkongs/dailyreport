import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, pickKeyIndicators } from './report-renderer'

const content = {
  cover: { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', subline: '부제' },
  summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸습니다.', today: '개장 30분 거래대금이 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서.' },
  cardLine: { kind: 'cause', text: '해외 충격보다 국내 수급 부담이 더 컸습니다' },
  bigStory: { content: [{ type: 'paragraph', text: '본문' }] }, watchPoints: [{ badge: '09:00', title: '개장', description: 'd' }],
  compass: [], soWhat: [{ title: '확인되면', body: 'b' }], calendar: [], closingMessage: 'c',
} as never
const data = {
  collectedAt: '2026-10-16T07:00:00+09:00', date: '2026-10-16', dayOfWeek: '금',
  koreaStocks: [{ symbol: '^KS11', name: 'KOSPI', nameKo: '코스피', price: 5554, change: -454, changePercent: -7.57, previousClose: 6008 }],
  usStocks: [{ symbol: '^GSPC', name: 'S&P 500', nameKo: 'S&P 500', price: 7744, change: 25, changePercent: 0.33, previousClose: 7719 }],
  europeStocks: [], japanStocks: [], chinaStocks: [], forex: [], commodities: [], bonds: [], crypto: [], collectionErrors: [],
} as never

test('Market 새 구성: 섹션 순서, 세 줄 요약, compass 없음, 상세는 펼쳐 보기, 고지 마지막', () => {
  const html = renderReport(content, data, [], 'normal', [], [{ date: '2026-10-15', pct: -7.57 }])
  const order = ['data-section="masthead"', 'data-section="summary"', 'data-section="key-indicators"', 'data-section="story"', 'data-section="today"', 'data-section="meaning"', 'data-section="details"', '투자 유의사항 및 법적 고지']
  const idx = order.map(k => html.indexOf(k))
  idx.forEach((v, i) => assert.ok(v >= 0, order[i]))
  assert.deepEqual([...idx].sort((a, b) => a - b), idx)
  assert.match(html, /<details[^>]*data-section="details"/)
  assert.doesNotMatch(html, /자산군별 온도계/)
  assert.match(html, /data-session="2026-10-15"/) // 머리 스트라이프
  assert.match(html, /최근 20거래일 코스피/)       // 한 줄 설명
  assert.match(html, /property="og:site_name" content="iM뱅크"/)
})

test('핵심 지표는 6개 이하, 코스피 포함', () => {
  const k = pickKeyIndicators(data)
  assert.ok(k.length <= 6); assert.equal(k[0].label, '코스피')
})

test('코스피 일봉이 없어도 렌더는 깨지지 않는다', () => {
  assert.doesNotThrow(() => renderReport(content, data, [], 'normal', [], []))
})

// ── 핵심 지표 ───────────────────────────────────────────────────────────

const fullData = {
  collectedAt: '2026-10-16T07:00:00+09:00', date: '2026-10-16', dayOfWeek: '금',
  koreaStocks: [
    { symbol: '^KS11', nameKo: '코스피', price: 5554, changePercent: -7.57 },
    { symbol: '^KQ11', nameKo: '코스닥', price: 900, changePercent: -3 },
  ],
  usStocks: [
    { symbol: '^GSPC', nameKo: 'S&P 500', price: 7744, changePercent: 0.33 },
    { symbol: '^IXIC', nameKo: '나스닥', price: 26000.5, changePercent: 0.08 },
    { symbol: '^DJI', nameKo: '다우존스', price: 50000, changePercent: 0.1 },
  ],
  europeStocks: [], japanStocks: [], chinaStocks: [],
  forex: [{ symbol: 'KRW=X', nameKo: '원/달러', rate: 1512.3, changePercent: 0.4 }, { symbol: 'JPY=X', nameKo: '엔/달러', rate: 150, changePercent: 0.1 }],
  commodities: [
    { symbol: 'CL=F', nameKo: 'WTI 원유', price: 70.1, changePercent: -1.2 },
    { symbol: 'GC=F', nameKo: '금', price: 4200, changePercent: 2.5 },
  ],
  bonds: [{ symbol: '^TNX', nameKo: '미국 10년물', yield: 4.25, change: 0.05 }],
  crypto: [{ symbol: 'BTC-USD', nameKo: '비트코인', price: 67000, changePercent: -0.5 }],
  collectionErrors: [],
} as never

test('핵심 지표: 기본 5개 + 그날 가장 크게 움직인 변수 1개, 10년물은 %p로', () => {
  const k = pickKeyIndicators(fullData)
  assert.deepEqual(k.map(x => x.label), ['코스피', 'S&P 500', '나스닥', '원/달러', '미 10년물', '금'])
  const bond = k[4]
  assert.equal(bond.value, '4.25%')
  assert.equal(bond.changeText, '+0.05%p')
  assert.ok(bond.changePercent > 0)
})

test('핵심 지표: 데이터가 없는 항목은 자리를 채우지 않고 건너뛴다', () => {
  const d = JSON.parse(JSON.stringify(fullData))
  d.usStocks[1].price = null            // 나스닥 없음
  d.bonds = []                          // 10년물 없음
  d.commodities = [d.commodities[0]]    // 금 없음 → 유가가 변수
  d.crypto = []
  assert.deepEqual(pickKeyIndicators(d).map(x => x.label), ['코스피', 'S&P 500', '원/달러', 'WTI 원유'])
  d.commodities = []
  assert.equal(pickKeyIndicators(d).length, 3)
})

// ── 페이지 구성 ─────────────────────────────────────────────────────────

const render = (over: Record<string, unknown> = {}, sessions = [{ date: '2026-10-15', pct: -7.57 }], mode: 'event' | 'normal' | 'quiet' = 'normal') =>
  renderReport({ ...(content as object), ...over } as never, data, [], mode, [], sessions)

test('머리글: 로고·Daily Market·iM AI Analyst·날짜, 제목은 run.ts가 추출하는 클래스로 유지', () => {
  const html = render()
  assert.match(html, /<header class="masthead" data-section="masthead">/)
  assert.match(html, /Daily Market/)
  assert.match(html, />iM AI Analyst</)
  assert.match(html, /2026년 10월 16일 금요일/)
  assert.match(html, /<image href="\/im-bank-logo\.png"/)
  // scripts/run.ts extractHeadlineFromHtml 과 같은 정규식
  assert.equal(html.match(/class="cover-headline"[^>]*>([^<]+)/)?.[1], '코스피 급락 다음 날, 미 증시는 숨 고르기')
  assert.equal(html.match(/class="cover-subline"[^>]*>([^<]+)/)?.[1], '부제')
})

test('스트라이프: 일봉이 없으면 띠와 설명을 함께 생략, 마지막 줄 아래 ▼ 마커가 잘리지 않는 viewBox', () => {
  const none = render({}, [])
  const body = none.slice(none.indexOf('<body>')) // <style> 안의 클래스 이름은 제외
  assert.doesNotMatch(body, /mast-stripes|최근 20거래일|data-session/)
  const some = render()
  assert.match(some, /viewBox="0 0 680 140"/)
  assert.match(some, /data-marker="today"/)
})

test('세 줄 요약: 어제 / 오늘 볼 것 / 내 자산은(ETF Today 링크)', () => {
  const html = render()
  assert.match(html, /<span class="summary-label">어제<\/span><span class="summary-text">국내 증시는 수급 부담에 크게 밀렸습니다\.<\/span>/)
  assert.match(html, /<span class="summary-label">오늘 볼 것<\/span>/)
  assert.match(html, /<span class="summary-label">내 자산은<\/span><a class="summary-text summary-link" href="\/etf-reports\/2026-10-16">자산군별 판단 재료는 ETF Today에서\./)
})

test('og·twitter 설명은 세 줄 요약(어제+오늘) 한 문장, 요약이 없는 옛 콘텐츠는 부제와 요약 상자 생략', () => {
  const html = render()
  const sentence = '국내 증시는 수급 부담에 크게 밀렸습니다. 개장 30분 거래대금이 첫 확인점입니다.'
  assert.match(html, new RegExp(`property="og:description" content="${sentence}"`))
  assert.match(html, new RegExp(`name="twitter:description" content="${sentence}"`))

  const legacy = render({ summary: undefined })
  assert.match(legacy, /property="og:description" content="부제"/)
  assert.doesNotMatch(legacy, /data-section="summary"/)
})

test('상세는 기본 접힘, 그 안에 전체 지표·일정·추세선 설명, 모드와 무관하게 오늘 볼 것·의미가 나온다', () => {
  const html = render({ calendar: [{ date: '10/19', country: '한국', event: '금통위', importance: 4 }] })
  assert.match(html, /<details class="more" data-section="details">/)
  assert.doesNotMatch(html, /<details[^>]*\sopen/)
  const details = html.slice(html.indexOf('data-section="details"'), html.indexOf('</details>'))
  assert.match(details, /전체 지표·이번 주 일정·과거 비교/)
  assert.match(details, /시장 체온/)
  assert.match(details, /이번 주 주요 일정/)
  assert.match(details, /금통위/)
  for (const mode of ['event', 'normal', 'quiet'] as const) {
    const h = render({}, [], mode)
    assert.match(h, /data-section="today"/, mode)
    assert.match(h, /data-section="meaning"/, mode)
  }
})

test('오늘 볼 것·의미는 각각 최대 3개, 법적 고지가 맨 끝(그 뒤에 섹션 없음)', () => {
  const wp = Array.from({ length: 5 }, (_, i) => ({ badge: `0${i}:00`, title: `항목${i}`, description: 'd' }))
  const sw = Array.from({ length: 5 }, (_, i) => ({ title: `의미${i}`, body: 'b' }))
  const html = render({ watchPoints: wp, soWhat: sw })
  assert.equal((html.match(/class="watch-card"/g) ?? []).length, 3)
  assert.equal((html.match(/class="sowhat-card"/g) ?? []).length, 3)
  assert.ok(html.lastIndexOf('data-section=') < html.indexOf('투자 유의사항 및 법적 고지'))
  assert.match(html.trimEnd(), /<\/html>$/)
})
