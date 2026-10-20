import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderReport, pickKeyIndicators, sanitizeInlineHtml } from './report-renderer'

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
  assert.doesNotMatch(html, /compass-box|iM 투자 나침반/) // 옛 compass 가 실제로 내보내던 클래스·제목
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
  // 색 눈금: 10bp = 지수 1% → 5bp 는 0.5 (표시 문구는 %p 그대로)
  assert.ok(Math.abs(bond.changePercent - 0.5) < 1e-9)
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

// M6 (Ruling 26): 고정 라벨 "어제"는 직전 한국 거래일에 맞춘다(모델 문장은 그대로).
test('요약 라벨·본문 섹션 제목: 금요일 발행은 어제, 월요일은 지난 금요일, 휴장 다음 날은 직전 거래일', () => {
  const at = (date: string) => renderReport(content, { ...(data as object), date } as never, [], 'normal', [], [])
  const label = (html: string) => html.match(/<span class="summary-label">([^<]+)<\/span><span class="summary-text">국내 증시는/)?.[1]
  const title = (html: string) => html.match(/data-section="story">\s*<h2 class="section-title">([^<]+)<\/h2>/)?.[1]
  assert.equal(label(at('2026-10-16')), '어제')
  assert.equal(title(at('2026-10-16')), '어제 무슨 일이 있었나')
  assert.equal(label(at('2026-10-19')), '지난 금요일')
  assert.equal(title(at('2026-10-19')), '지난 금요일 무슨 일이 있었나')
  assert.equal(label(at('2026-10-12')), '직전 거래일') // 10-09(금) 한글날 휴장
  assert.equal(title(at('2026-10-12')), '직전 거래일 무슨 일이 있었나')
  assert.ok(at('2026-10-19').includes('국내 증시는 수급 부담에 크게 밀렸습니다.')) // 모델 문장은 그대로
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

const calendar = [{ date: '10/19', country: '한국', event: '금통위', importance: 4 }]
const kospiHistory = [{ symbol: '^KS11', nameKo: '코스피', current: 5554, oneYearAgo: 2600, threeMonthsAgo: 3200, oneMonthAgo: 3500, oneWeekAgo: 6625.5 }]
const detailsOf = (html: string) => html.slice(html.indexOf('data-section="details"'), html.indexOf('</details>'))
const summaryOf = (html: string) => detailsOf(html).match(/<summary class="more-summary">([^<]*)</)?.[1]

test('상세는 기본 접힘, 그 안에 전체 지표·일정·과거 비교(추세선), 모드와 무관하게 오늘 볼 것·의미가 나온다', () => {
  const html = renderReport({ ...(content as object), calendar } as never, data, kospiHistory as never, 'normal', [], [])
  assert.match(html, /<details class="more" data-section="details">/)
  assert.doesNotMatch(html, /<details[^>]*\sopen/)
  const details = detailsOf(html)
  assert.equal(summaryOf(html), '전체 지표·이번 주 일정·과거 비교')
  assert.match(details, /시장 체온/)
  assert.match(details, /이번 주 주요 일정/)
  assert.match(details, /금통위/)
  assert.match(details, /class="pulse-note">추세선/)
  for (const mode of ['event', 'normal', 'quiet'] as const) {
    const h = render({}, [], mode)
    assert.match(h, /data-section="today"/, mode)
    assert.match(h, /data-section="meaning"/, mode)
  }
})

test('상세 제목은 실제로 들어 있는 것만 나열한다(일정표·추세선이 없으면 약속하지 않는다)', () => {
  assert.equal(summaryOf(render()), '전체 지표')
  assert.equal(summaryOf(render({ calendar })), '전체 지표·이번 주 일정')
  assert.equal(summaryOf(renderReport(content, data, kospiHistory as never, 'normal', [], [])), '전체 지표·과거 비교')
  // 추세선이 붙을 카드가 없으면(과거 데이터가 다른 지표 것뿐) 과거 비교도, 추세선 설명도 없다
  const other = [{ ...kospiHistory[0], symbol: '^X', nameKo: '없는 지표' }]
  const html = renderReport(content, data, other as never, 'normal', [], [])
  assert.equal(summaryOf(html), '전체 지표')
  assert.doesNotMatch(html, /class="pulse-note"/)
})

test('옛 compass 콘텐츠가 들어와도 compass 는 그리지 않는다', () => {
  const legacy = render({
    compass: [{ label: 'ASSET', title: '자산군별 온도계', items: [{ asset: '주식', body: 'b', gaugeType: 'neutral', gaugePercent: 50 }], paragraphs: ['p'] }],
  })
  const body = legacy.slice(legacy.indexOf('<body>'))
  assert.doesNotMatch(body, /compass-box|gauge-fill|iM 투자 나침반|자산군별 온도계/)
})

test('데이터 기준: 참고한 뉴스 다음·법적 고지 앞에 수집 시각(KST)과 값의 성격을, 건수 같은 메타 없이', () => {
  const html = renderReport(content, data, [], 'normal', [{ title: '기사', source: '연합뉴스' }], [])
  const basis = html.slice(html.indexOf('data-section="data-basis"'), html.indexOf('data-section="footer"'))
  assert.match(basis, /데이터 기준/)
  assert.match(basis, /2026년 10월 16일 07:00\(한국시간\)에 수집했습니다/)
  assert.match(basis, /주가지수는 수집 시점의 가장 최근 시세\(개장 전이면 직전 종가\)/)
  assert.match(basis, /등락은 전일 대비/)
  assert.doesNotMatch(basis, /\d+\s*(개|건)|AI가 작성|생성 시각/)
  const idx = ['data-section="story"', 'data-section="details"', 'data-section="sources"', 'data-section="data-basis"', '투자 유의사항 및 법적 고지'].map(k => html.indexOf(k))
  idx.forEach((v, i) => assert.ok(v >= 0, String(i)))
  assert.deepEqual([...idx].sort((a, b) => a - b), idx)
  // 뉴스가 없어도 데이터 기준은 남는다
  assert.match(render(), /data-section="data-basis"/)
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

// ── Ruling 43: 모델 글은 강조 태그(<strong>)만 살리고 나머지 HTML은 모두 escape ─────────────────
// 뉴스 제목·요약이 모델 출력으로 흘러 들어가므로, 본문 문단·인용·오늘 볼 것 설명·의미 본문에 끼어든 태그가 공개 페이지에 그대로 나가면 안 된다.
const SCRIPT = '<script>alert(1)</script>'
const IMG = '<img src=x onerror=alert(1)>'

test('sanitizeInlineHtml: <strong>/</strong>만 살리고 나머지는 escape, 모델이 쓴 문자 참조도 글자로 보인다', () => {
  assert.equal(sanitizeInlineHtml('코스피 <strong>-7.57%</strong> 급락'), '코스피 <strong>-7.57%</strong> 급락')
  assert.equal(sanitizeInlineHtml(SCRIPT), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(sanitizeInlineHtml(IMG), '&lt;img src=x onerror=alert(1)&gt;')
  // 속성이 붙은 강조 태그는 살리지 않는다(escape)
  assert.equal(sanitizeInlineHtml('<strong onclick="x">굵게</strong>'), '&lt;strong onclick=&quot;x&quot;&gt;굵게</strong>')
  // 프롬프트가 쓰라고 한 태그는 <strong>뿐 — 다른 태그는 글자로
  assert.equal(sanitizeInlineHtml('<em>기울임</em><br><b>굵게</b>'), '&lt;em&gt;기울임&lt;/em&gt;&lt;br&gt;&lt;b&gt;굵게&lt;/b&gt;')
  assert.equal(sanitizeInlineHtml('<STRONG>대문자</STRONG>'), '<strong>대문자</strong>')
  // &·부등호는 escape. Ruling 37c: 모델이 쓴 문자 참조(&nbsp; &#32; 등)도 escape해 글자로 보인다 — 숨은 공백으로 풀려
  // 권유 검사("매수하세요")를 비켜 가지 못하게. 모델이 쓴 &lt;strong&gt; 은 태그로 되살리지 않는다.
  assert.equal(sanitizeInlineHtml('S&P 500 > 7,000'), 'S&amp;P 500 &gt; 7,000')
  assert.equal(sanitizeInlineHtml('매수&nbsp;하세요 &#32; &#x20;'), '매수&amp;nbsp;하세요 &amp;#32; &amp;#x20;')
  assert.equal(sanitizeInlineHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;')
  assert.equal(sanitizeInlineHtml('&lt;strong&gt;굵게&lt;/strong&gt;'), '&amp;lt;strong&amp;gt;굵게&amp;lt;/strong&amp;gt;')
  assert.equal(sanitizeInlineHtml(undefined), '')
  assert.equal(sanitizeInlineHtml(42 as never), '')
})

test('렌더: 본문 문단·인용·오늘 볼 것 설명·의미 본문의 스크립트·이미지 태그는 escape되고, <strong>은 굵게 남는다', () => {
  const html = render({
    bigStory: { content: [
      { type: 'paragraph', text: `문단 ${SCRIPT} <strong>굵게</strong>` },
      { type: 'pullQuote', text: `인용 ${IMG}` },
      { type: 'paragraph', text: '<strong onclick="x">속성</strong>' },
    ] },
    watchPoints: [{ badge: '09:00', title: '개장', description: `설명 ${SCRIPT}` }],
    soWhat: [{ title: '확인되면', body: `의미 ${IMG} <strong>굵게</strong>` }],
  })
  const body = html.slice(html.indexOf('<body'))
  assert.doesNotMatch(body, /<script|<img|<strong onclick/) // 태그로는 하나도 남지 않는다(글자로만)
  assert.match(body, /<p>문단 &lt;script&gt;alert\(1\)&lt;\/script&gt; <strong>굵게<\/strong><\/p>/)
  assert.match(body, /인용 &lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(body, /&lt;strong onclick=&quot;x&quot;&gt;속성<\/strong>/)
  assert.match(body, /<div class="watch-desc">설명 &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/div>/)
  assert.match(body, /<p>의미 &lt;img src=x onerror=alert\(1\)&gt; <strong>굵게<\/strong><\/p>/)
})

test('렌더: 모델 글의 "&nbsp;"는 숨은 공백이 아니라 글자 그대로 보인다(Ruling 37c)', () => {
  const html = render({
    bigStory: { content: [{ type: 'paragraph', text: '가격&nbsp;상승' }] },
    watchPoints: [{ badge: '09:00', title: '개장', description: '설명&#32;끝' }],
  })
  const body = html.slice(html.indexOf('<body'))
  assert.match(body, /<p>가격&amp;nbsp;상승<\/p>/)
  assert.match(body, /<div class="watch-desc">설명&amp;#32;끝<\/div>/)
  assert.doesNotMatch(body, /가격&nbsp;상승/)
})
