# ETF 렌더러 하드코딩 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF HTML 렌더러의 고정 티커·태그·지수대비·자금 흐름 문구를 실제 유니버스·데이터 의미와 맞춘다(모델 입력은 불변).

**Architecture:** 데이터 층(`universe.ts`의 `foreignUnderlying` 표시 + `mergeKrxIntoQuotes`의 지수대비 무효화)에서 의미 없는 숫자를 `null`로 만들고, 렌더러는 이미 `null`을 생략하므로 사용처가 자동으로 따라온다. 렌더러의 태그 판정은 유니버스 category 우선으로 바꾸고, 고정 티커는 전부 유니버스 구성원으로 교체·소스 스캔 테스트로 고정한다.

**Tech Stack:** TypeScript, node:test(`npx tsx --test`), `npx tsc --noEmit -p .`

**Spec:** `docs/superpowers/specs/2026-10-09-etf-renderer-hardcode-cleanup-design.md`

## Global Constraints

- 브랜치 `fix/etf-renderer-hardcode`에서 작업. `git add -A` 금지(`public/`에 미추적 잔여물) — 파일을 명시해서 add.
- 커밋 메시지: 한국어 서술형, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 리포트 생성 프롬프트·evidence·검증기는 바꾸지 않는다(`dailyIndexGap` 소비처는 `renderer.ts`뿐 — grep 확인됨).
- 유니버스 종목 추가·삭제 금지. `morning-report-plan.ts`·`morning-strategy.ts`는 범위 밖.
- 렌더러의 모든 고정 티커 리터럴은 `ALL_ETF_UNIVERSE` 구성원이어야 한다.
- `foreignUnderlying: true` 13종(정확히): `360750.KS` `133690.KS` `195930.KS` `099140.KS` `241180.KS` `390390.KS` `394670.KS` `458250.KS` `305080.KS` `132030.KS` `261220.KS` `329750.KS` `456610.KS`
- 원자재 정규식(정확히): `/골드|gold|silver|원유|oil|wti|commodity|원자재/i` — 단독 `금` 금지.
- 지수대비: `null`만 생략, `0`은 유효값(`0.00%p`로 표시).

## Review Focus

1. KRX 이름이 빈 문자열인 레버리지 행 — 병합 후 이름(`q.name`)으로 전술 판정해 지수대비 `null`이어야 한다 → Task 1 테스트.
2. 국내 1배 ETF의 지수대비가 정확히 `0`인 날 — 생략되지 않고 `0.00%p` 표시. 지수대비는 출력 경로가 셋(일반 카드·전술 보드·액션 보드)이라 섹션별로 확인 → Task 4 테스트.
3. 그룹 시세가 하나도 없는 날(미국 ETF 수집 실패 등) — 이슈 카드·매칭표 폴백이 `.KS` 원코드나 맨 티커만 노출하지 않고 유니버스 이름을 쓴다 → Task 4 테스트.
4. 유니버스 밖 이름에 '금융'·'금리'가 들어간 시세 — '원자재' 태그가 붙지 않는다 → Task 2 테스트.
5. stale/none 세션 — 병합이 Yahoo 시세를 그대로 돌려줘 `dailyIndexGap`이 없으므로 무효화 로직이 끼어들지 않는다 → 기존 `etf-data.merge.test.ts` stale·none 테스트가 계속 통과해야 함(Task 1 Step 4에서 확인).

---

### Task 1: 유니버스 `foreignUnderlying` + KRX 병합 지수대비 무효화

**Files:**
- Modify: `lib/etf/types.ts:9-15` (`EtfDefinition`)
- Modify: `lib/etf/universe.ts` (13종에 `foreignUnderlying: true`)
- Modify: `lib/etf/etf-data.ts:1-7` (import), `:260-288` (`mergeKrxIntoQuotes`)
- Test: `lib/etf/universe.test.ts`, `lib/etf/etf-data.merge.test.ts`

**Interfaces:**
- Produces: `EtfDefinition.foreignUnderlying?: boolean`; `mergeKrxIntoQuotes` 시그니처 불변, prev-session 결과의 `dailyIndexGap`이 해외 기초지수·전술형에서 `null`.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/etf/universe.test.ts` 끝에 추가:

```ts
test("foreignUnderlying: 해외 기초지수 국내 상장 13종과 정확히 일치", () => {
  const expected = [
    "360750.KS", "133690.KS", "195930.KS", "099140.KS", "241180.KS", "390390.KS", "394670.KS",
    "458250.KS", "305080.KS", "132030.KS", "261220.KS", "329750.KS", "456610.KS",
  ].sort();
  const actual = ALL_ETF_UNIVERSE.filter(e => e.foreignUnderlying === true).map(e => e.ticker).sort();
  assert.deepEqual(actual, expected);
});
```

`lib/etf/etf-data.merge.test.ts` 끝에 추가(기존 `krxRow`는 gap이 항상 0이라 새 헬퍼를 쓴다):

```ts
function krxRowGap(ticker: string, name: string, changePercent: number, indexChange: number): KrxEtfDailyTrade {
  return {
    date: '20261008', ticker, name, close: 100, change: 0, changePercent, nav: 100,
    volume: 5000, tradingValue: 9_000_000, marketCap: 1, netAssetTotal: 2,
    underlyingIndexName: 'IDX ' + ticker, underlyingIndexClose: 250, underlyingIndexChangePercent: indexChange,
    premiumDiscount: 0, dailyIndexGap: changePercent - indexChange,
  }
}

test('지수대비: 국내 1배는 유지, 해외 기초지수·레버리지·인버스는 null (지수 원값은 유지)', () => {
  const quotes = ['069500.KS', '390390.KS', '122630.KS', '252670.KS'].map(t => yahooQuote(t, 100, 0))
  const krx = new Map([
    ['069500.KS', krxRowGap('069500.KS', 'KODEX 200', 1.3, 1.1)],
    ['390390.KS', krxRowGap('390390.KS', 'KODEX 미국반도체', 1.94, 0)],
    ['122630.KS', krxRowGap('122630.KS', 'KODEX 레버리지', 2.2, 1.1)],
    ['252670.KS', krxRowGap('252670.KS', 'KODEX 200선물인버스2X', 4.29, -2.2)],
  ])
  const out = mergeKrxIntoQuotes(quotes, krx, 'prev-session')
  const by = (t: string) => out.find(q => q.ticker === t)!
  assert.ok(Math.abs((by('069500.KS').dailyIndexGap ?? NaN) - 0.2) < 1e-9)
  assert.equal(by('390390.KS').dailyIndexGap, null)
  assert.equal(by('390390.KS').underlyingIndexName, 'IDX 390390.KS')
  assert.equal(by('390390.KS').underlyingIndexClose, 250)
  assert.equal(by('390390.KS').underlyingIndexChangePercent, 0)
  assert.equal(by('122630.KS').dailyIndexGap, null)
  assert.equal(by('252670.KS').dailyIndexGap, null)
})

test('지수대비: KRX 이름이 비면 Yahoo 이름으로 전술 판정', () => {
  const q = { ...yahooQuote('122630.KS', 100, 0), name: 'KODEX 레버리지' }
  const krx = new Map([['122630.KS', krxRowGap('122630.KS', '', 2.2, 1.1)]])
  const out = mergeKrxIntoQuotes([q], krx, 'prev-session')
  assert.equal(out[0].name, 'KODEX 레버리지')
  assert.equal(out[0].dailyIndexGap, null)
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/universe.test.ts lib/etf/etf-data.merge.test.ts`
Expected: FAIL — `foreignUnderlying` 테스트는 빈 배열 vs 13종, 지수대비 테스트는 `390390.KS` gap이 `1.94`.

- [ ] **Step 3: 구현**

`lib/etf/types.ts`의 `EtfDefinition`에 `theme?` 다음 줄 추가:

```ts
  foreignUnderlying?: boolean  // 국내 상장이지만 기초지수가 해외 세션 — 한국 장 등락률과 지수 등락률의 날짜가 어긋나 지수대비 비교 불가
```

`lib/etf/universe.ts`: 위 13종 정의 객체 각각의 끝에 `foreignUnderlying: true`를 추가한다(예: `{ ticker: '390390.KS', name: 'KODEX 미국반도체', market: 'KR', category: '테마', theme: '반도체', foreignUnderlying: true },`). `// 국내 채권·대안 (10)` 블록 위에 주석 한 줄: `// foreignUnderlying: 기초지수가 해외 세션인 국내 상장 ETF — KRX 병합에서 지수대비를 비운다(etf-data.ts).`

`lib/etf/etf-data.ts` import 수정:

```ts
import { ALL_ETF_UNIVERSE, US_ETF_UNIVERSE, getEtfByTicker } from './universe'
import { isTacticalEtf } from './story-characters'
```

`mergeKrxIntoQuotes`의 map 본문을 다음으로 교체:

```ts
  return quotes.map(q => {
    const krx = krxMap.get(q.ticker)
    if (!krx) return q
    const name = krx.name || q.name
    // 지수대비가 의미 없는 경우 비운다(렌더러는 null을 생략):
    // 해외 기초지수는 한국 장과 지수 날짜가 어긋나고, 레버리지·인버스는 배수를 무시한 1배 차이라서.
    const gapMeaningless = getEtfByTicker(q.ticker)?.foreignUnderlying === true || isTacticalEtf({ ...q, name })
    return {
      ...q,
      name,
      price: krx.close ?? q.price,
      change: krx.change ?? q.change,
      changePercent: krx.changePercent ?? q.changePercent,
      volume: krx.volume ?? q.volume,
      aum: krx.netAssetTotal ?? q.aum,
      nav: krx.nav,
      premiumDiscount: krx.premiumDiscount,
      trackingError: q.trackingError,
      tradingValue: krx.tradingValue,
      marketCap: krx.marketCap,
      underlyingIndexName: krx.underlyingIndexName,
      underlyingIndexClose: krx.underlyingIndexClose,
      underlyingIndexChangePercent: krx.underlyingIndexChangePercent,
      dailyIndexGap: gapMeaningless ? null : krx.dailyIndexGap,
    }
  })
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/universe.test.ts lib/etf/etf-data.merge.test.ts`
Expected: PASS(기존 stale·none·하류 연결 테스트 포함 전부).

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/types.ts lib/etf/universe.ts lib/etf/etf-data.ts lib/etf/universe.test.ts lib/etf/etf-data.merge.test.ts
git commit -m "ETF 지수대비: 해외 기초지수·레버리지·인버스는 KRX 병합에서 비움 — 날짜 어긋남·배수 무시 숫자 제거"
```

---

### Task 2: 태그 판정 `inferEtfTag`를 유니버스 category 우선으로

**Files:**
- Modify: `lib/etf/renderer.ts:472-479` (`inferEtfTag` → export)
- Create: `lib/etf/renderer-hardcode.test.ts`

**Interfaces:**
- Consumes: `getEtfByTicker`(`./universe`, 이미 import됨), `isTacticalEtf`(`./story-characters`, 이미 import됨)
- Produces: `export function inferEtfTag(q: EtfQuote): string` — 반환값 `'전술' | '채권' | '테마' | '섹터' | '해외지수' | '팩터' | '지수' | '원자재' | '대안'`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/etf/renderer-hardcode.test.ts` 생성:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferEtfTag } from "./renderer";
import type { EtfQuote } from "./types";

function quote(ticker: string, name: string, market: "KR" | "US" = ticker.endsWith(".KS") ? "KR" : "US"): EtfQuote {
  return {
    ticker, name, market, price: 100, change: 1, changePercent: 1, volume: 1000,
    aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
  } as EtfQuote;
}

test("inferEtfTag: 유니버스 category 우선 — '금융'·'금리'는 원자재가 아니다", () => {
  const cases: Array<[string, string, string]> = [
    ["139270.KS", "TIGER 200 금융", "섹터"],
    ["456610.KS", "TIGER 미국달러SOFR금리액티브(합성)", "채권"],
    ["132030.KS", "KODEX 골드선물(H)", "원자재"],
    ["261220.KS", "KODEX WTI원유선물(H)", "원자재"],
    ["122630.KS", "KODEX 레버리지", "전술"],
    ["390390.KS", "KODEX 미국반도체", "테마"],
    ["394670.KS", "TIGER 글로벌리튬&2차전지SOLACTIVE(합성)", "테마"],
    ["360750.KS", "TIGER 미국S&P500", "해외지수"],
    ["MTUM", "iShares MSCI USA Momentum ETF", "팩터"],
    ["VNQ", "Vanguard Real Estate ETF", "대안"],
    ["GLD", "SPDR Gold Shares ETF", "원자재"],
  ];
  for (const [ticker, name, expected] of cases) {
    assert.equal(inferEtfTag(quote(ticker, name)), expected, `${ticker} ${name}`);
  }
});

test("inferEtfTag: 유니버스 밖 이름의 '금융'·'금리'는 원자재가 아니다", () => {
  assert.notEqual(inferEtfTag(quote("999990.KS", "ACME 은행금융")), "원자재");
  assert.notEqual(inferEtfTag(quote("999991.KS", "ACME 금리플러스")), "원자재");
  assert.equal(inferEtfTag(quote("999992.KS", "ACME 골드")), "원자재");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/renderer-hardcode.test.ts`
Expected: FAIL — `inferEtfTag`가 export되지 않음(import가 `undefined` → TypeError).

- [ ] **Step 3: 구현**

`lib/etf/renderer.ts`의 `inferEtfTag`를 교체:

```ts
const COMMODITY_NAME = /골드|gold|silver|원유|oil|wti|commodity|원자재/i
const TAG_BY_CATEGORY: Record<string, string> = {
  '채권': '채권', '테마': '테마', '섹터': '섹터', '해외지수': '해외지수', '팩터': '팩터', '지수': '지수',
}

// 유니버스 category가 1순위. 이름 정규식은 유니버스 밖 종목에만 쓴다
// (단독 '금'은 '금융'·'금리'에 걸려서 제외).
export function inferEtfTag(q: EtfQuote): string {
  if (isTacticalEtf(q)) return '전술'
  const def = getEtfByTicker(q.ticker)
  if (def) {
    if (def.category === '대안') return COMMODITY_NAME.test(q.name) || COMMODITY_NAME.test(def.name) ? '원자재' : '대안'
    return TAG_BY_CATEGORY[def.category] ?? '지수'
  }
  const name = q.name.toLowerCase()
  if (/반도체|semiconductor|ai|바이오|bio/.test(name)) return '테마'
  if (/채권|bond|국채|tlt|ief|shy/.test(name)) return '채권'
  if (COMMODITY_NAME.test(name)) return '원자재'
  return '지수'
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/renderer-hardcode.test.ts lib/etf/renderer-metrics.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/renderer.ts lib/etf/renderer-hardcode.test.ts
git commit -m "ETF 렌더러 태그: 유니버스 category 우선 판정 — '금융'·'금리'가 원자재로 붙던 오류 제거"
```

---

### Task 3: 고정 티커 교체·라벨 오버라이드 삭제·자금 흐름 문구

**Files:**
- Modify: `lib/etf/renderer.ts` — `:50-60` `ETF_LABEL_OVERRIDES` 삭제, `:647-655` `formatKnownTicker`, `:1033-1066` `renderGlobalKrMatching`, `:1070-1078` `renderGlobalKoreaBridge`, `:1111-1121` `renderMarketHeatmap`, `:1160-1178` `renderIssueEtfs`, `:1296-1301` `liquidityNotes`
- Test: `lib/etf/renderer-hardcode.test.ts`

**Interfaces:**
- Consumes: `ALL_ETF_UNIVERSE`(`./universe`)
- Produces: 없음(내부 함수 변경). 테스트 파일에 소스 스캔 2건 추가.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/etf/renderer-hardcode.test.ts` 상단 import에 추가:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_ETF_UNIVERSE } from "./universe";

const RENDERER_SRC = fs.readFileSync(path.join(__dirname, "renderer.ts"), "utf8");
```

파일 끝에 추가:

```ts
test("소스 스캔: renderer.ts의 티커 리터럴은 전부 유니버스 구성원", () => {
  const universe = new Set(ALL_ETF_UNIVERSE.map(e => e.ticker));
  const NON_TICKER = new Set(["KR", "US", "NAV", "VIX", "WTI"]);
  const found = new Set<string>();
  for (const m of RENDERER_SRC.matchAll(/['"`]([0-9][0-9A-Z]{5}\.KS)['"`]/g)) found.add(m[1]);
  for (const m of RENDERER_SRC.matchAll(/['"`]([A-Z]{2,5})['"`]/g)) if (!NON_TICKER.has(m[1])) found.add(m[1]);
  const outside = [...found].filter(t => !universe.has(t)).sort();
  assert.deepEqual(outside, []);
});

// 위 스캔은 문자열 전체가 티커인 리터럴만 잡는다. 'SOXX·SMH·국내 반도체' 같은 표시용 메타 속
// 옛 티커는 놓치므로, 이번에 제거한 옛 티커·코드를 단어 경계로 한 번 더 막는다.
test("소스 스캔: 제거한 옛 티커가 복합 문자열에도 남지 않는다", () => {
  assert.doesNotMatch(RENDERER_SRC, /\b(SMH|IVV|SCHD|VIG)\b/);
  assert.doesNotMatch(RENDERER_SRC, /\b(379800|379810|381180|453850|476550|429000|458730|233740|251340|364970)\b/);
});

test("소스 스캔: 자금 흐름·배당 문구와 라벨 오버라이드가 없다", () => {
  assert.doesNotMatch(RENDERER_SRC, /자금이[^.'`]{0,10}(몰|쏠|이동)/);
  assert.doesNotMatch(RENDERER_SRC, /자금\s*유[입출]/);
  assert.doesNotMatch(RENDERER_SRC, /순유[입출]/);
  assert.doesNotMatch(RENDERER_SRC, /배당/);
  assert.doesNotMatch(RENDERER_SRC, /ETF_LABEL_OVERRIDES/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/renderer-hardcode.test.ts`
Expected: FAIL — outside에 `233740.KS` `251340.KS` `364970.KS` `379800.KS` `379810.KS` `381180.KS` `429000.KS` `453850.KS` `458730.KS` `476550.KS` `IVV` `SCHD` `SMH` `VIG`; 옛 티커 단어 경계 스캔도 같은 목록에서 실패; 문구 스캔은 `자금이 몰리는`에서 실패.

- [ ] **Step 3: 구현**

(a) `ETF_LABEL_OVERRIDES` 상수 블록(`:50-60`) 전체 삭제. `formatKnownTicker`를:

```ts
function formatKnownTicker(ticker: string): string {
  const def = getEtfByTicker(ticker)
  if (def?.market === 'KR') return `${def.name} (${ticker.replace(/\.(KS|KQ)$/i, '')})`
  if (def) return `${def.ticker} ${def.name}`
  if (/\.(KS|KQ)$/i.test(ticker)) return ticker.replace(/\.(KS|KQ)$/i, '')
  return ticker
}
```

(b) `renderGlobalKrMatching`의 `pairs`와 global 폴백:

```ts
  const pairs = [
    { theme: '미국 S&P 500', global: ['SPY', 'VOO'], kr: ['360750.KS'], check: '환율 방향과 S&P 500 선물이 같은 편을 들어주는지가 오늘의 관전 포인트입니다.' },
    { theme: '미국 나스닥 100', global: ['QQQ'], kr: ['133690.KS'], check: '성장주 강세가 원화 약세의 부담을 이겨낼 만큼인지 가늠해 봅니다.' },
    { theme: '반도체', global: ['SOXX'], kr: ['091160.KS', '396500.KS', '471760.KS'], check: '미국 반도체 흐름이 국내 거래대금 증가로 실제 이어지는지가 열쇠입니다.' },
    { theme: '장기 미국채', global: ['TLT', 'IEF'], kr: ['458250.KS', '305080.KS'], check: '미국 10년 금리와 TLT가 같은 방향을 가리키는지 봐야 판단이 깔끔합니다.' },
  ]
```

`globalText` 줄의 폴백 `renderPlainTickerLink(ticker, ticker)` → `renderPlainTickerLink(ticker, formatKnownTicker(ticker))`.

(c) `renderGlobalKoreaBridge`: `const bio = findQuote(data.quotes, '364970.KS')` → `const growth = findQuote(data.quotes, '365040.KS')`, target 문자열의 `quoteLabel(bio, '국내 성장 테마 ETF')` → `quoteLabel(growth, '국내 성장 테마 ETF')`.

(d) `renderMarketHeatmap`의 `groups` 중 4개 항목:

```ts
    { name: '반도체·AI', meta: 'SOXX·국내 반도체', tickers: ['SOXX', '091160.KS', '396500.KS'] },
    { name: '한국 ETF', meta: '수집 국내 ETF 평균', tickers: data.quotes.filter(q => q.market === 'KR').map(q => q.ticker).slice(0, 80) },
    { name: '환노출 해외', meta: '국내 상장 미국 ETF', tickers: ['360750.KS', '133690.KS'] },
    { name: '레버리지/인버스', meta: '국내 전술형', tickers: ['122630.KS', '252670.KS'] },
```

(e) `renderIssueEtfs`의 `issues`(배당·인컴 카드 삭제, 5장):

```ts
  const issues = [
    { title: '반도체·AI', reason: '미국 반도체 흐름이 국내 반도체 ETF 거래대금으로 이어지는지가 오늘의 관전 포인트입니다.', tickers: ['SOXX', '091160.KS', '396500.KS'] },
    { title: '장기채·금리', reason: '미국 10년 금리의 움직임이 장기채 ETF 가격에 어떻게 새겨지는지 읽어냅니다.', tickers: ['TLT', 'IEF', '458250.KS'] },
    { title: '환노출 미국주식', reason: 'S&P500·나스닥이 오른 폭과 원/달러 환율이 깎아낸 폭을 따로 떼어 계산해 봅니다.', tickers: ['360750.KS', '133690.KS'] },
    { title: '레버리지·인버스', reason: 'NAV와 괴리 상태를 먼저 확인한 뒤에야 장 초반 진입을 고민할 수 있는 상품군입니다.', tickers: ['122630.KS', '252670.KS'] },
    { title: '금·원자재', reason: '지정학 변수와 달러 방향이 원자재 ETF에 같은 신호를 보내는지 맞춰 봅니다.', tickers: ['GLD', 'SLV', 'USO', '132030.KS'] },
  ]
```

`fallbackLinks`의 `renderPlainTickerLink(ticker, ticker, 'etf-tag etf-link')` → `renderPlainTickerLink(ticker, formatKnownTicker(ticker), 'etf-tag etf-link')`.

(f) `renderDomesticActionBoard`의 `liquidityNotes`:

```ts
  const liquidityNotes = [
    '거래가 활발해 체결은 수월하지만, 장 초반 급등락은 따로 챙겨봅니다.',
    '거래대금이 두꺼운 축입니다. 방향보다 변동폭의 크기를 먼저 가늠합니다.',
    '거래가 두텁습니다. 지표나 거시 변화에 평소보다 민감하게 반응할 수 있습니다.',
    '유동성은 풍부합니다. 장 초반 거래대금이 어느 쪽으로 늘어나는지 함께 살핍니다.',
  ]
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/etf/renderer-hardcode.test.ts lib/etf/renderer-metrics.test.ts && npx tsc --noEmit -p .`
Expected: PASS, tsc 출력 없음.

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/renderer.ts lib/etf/renderer-hardcode.test.ts
git commit -m "ETF 렌더러 고정 티커를 유니버스 구성원으로 교체 — 배당 테마 삭제, 라벨 오버라이드 제거, 자금 흐름 문구 정리"
```

---

### Task 4: 렌더 회귀 테스트 + 전체 검증 + 수동 확인

**Files:**
- Test: `lib/etf/renderer-hardcode.test.ts` (렌더 회귀 추가)

**Interfaces:**
- Consumes: `renderMorningHtml(report: MorningReport, data: CollectedData): string`(`./renderer`), `mergeKrxIntoQuotes`·`KrxEtfDailyTrade`(`./etf-data`), Task 1의 무효화 동작, Task 2·3의 렌더러 변경.

- [ ] **Step 1: 테스트 작성**

`lib/etf/renderer-hardcode.test.ts` import에 추가:

```ts
import { renderMorningHtml } from "./renderer";
import { mergeKrxIntoQuotes, type KrxEtfDailyTrade } from "./etf-data";
import type { CollectedData, MorningReport } from "./types";
```

(`inferEtfTag` import 줄과 합쳐도 됨.) 파일 끝에 추가:

```ts
const REPORT = {
  cover: { headline: "테스트 제목", subline: "테스트 서브라인" },
  overnightBrief: { narrative: "간밤 요약", krImpact: "국내 영향" },
  usEtfHighlights: { topMover: { ticker: "SPY", reason: "r" }, bottomMover: { ticker: "SPY", reason: "r" }, sectorNarrative: "섹터" },
  todayWatch: { items: [] },
  closingLine: "마무리",
} as MorningReport;

function data(quotes: EtfQuote[]): CollectedData {
  return {
    reportType: "morning", date: "2026-10-12", quotes, flows: [], investorFlows: [],
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
    news: [], analysisLens: "",
  };
}

function krx(ticker: string, name: string, changePercent: number, indexChange: number, tradingValue: number): KrxEtfDailyTrade {
  return {
    date: "20261008", ticker, name, close: 100, change: 0, changePercent, nav: 100,
    volume: 5000, tradingValue, marketCap: 1, netAssetTotal: 2,
    underlyingIndexName: "기초지수 " + name, underlyingIndexClose: 250, underlyingIndexChangePercent: indexChange,
    premiumDiscount: 0, dailyIndexGap: changePercent - indexChange,
  };
}

// 병합 결과를 그대로 렌더: 국내 1배 2종(하나는 gap 정확히 0), 해외 기초지수 1종, 전술 1종
function mergedQuotes(): EtfQuote[] {
  const rows = [
    krx("069500.KS", "KODEX 200", 1.1, 1.1, 9e11),            // gap 0 — 표시되어야 함
    krx("139270.KS", "TIGER 200 금융", 1.5, 1.0, 8e11),        // gap 0.5
    krx("390390.KS", "KODEX 미국반도체", 1.94, 0, 7e11),        // 해외 기초지수 — 지수대비 없음
    krx("122630.KS", "KODEX 레버리지", 2.2, 1.1, 6e11),         // 전술 — 지수대비 없음
  ];
  const quotes = rows.map(r => quote(r.ticker, r.ticker));
  return mergeKrxIntoQuotes(quotes, new Map(rows.map(r => [r.ticker, r])), "prev-session");
}

// 섹션 제목부터 다음 섹션 시작 전까지. 섹션 단위로 잘라야 다른 섹션(전략 지도 등)의
// 정상 라벨 때문에 단언이 잘못 통과하지 않는다.
function section(html: string, title: string): string {
  const start = html.indexOf(`<div class="section-title">${title}`);
  assert.ok(start >= 0, `${title} 섹션이 렌더되어야 함`);
  const end = html.indexOf('<div class="section">', start);
  return html.slice(start, end < 0 ? undefined : end);
}

// 같은 섹션 안에서 특정 종목이 들어간 카드/행 하나
function chunkWith(sectionHtml: string, splitter: string, needle: string): string {
  const chunk = sectionHtml.split(splitter).find(c => c.includes(needle));
  assert.ok(chunk, `${needle} 항목이 있어야 함`);
  return chunk;
}

test("렌더 회귀: 액션 보드 지수대비 패널은 국내 1배만, gap 0은 0.00%p로 표시", () => {
  const board = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Domestic ETF Action Board");
  const gapPanel = board.slice(board.indexOf("기초지수 대비"));
  assert.match(gapPanel, /KODEX 200/);
  assert.match(gapPanel, /0\.00%p/);
  assert.match(gapPanel, /TIGER 200 금융/);
  assert.doesNotMatch(gapPanel, /KODEX 미국반도체/);
});

test("렌더 회귀: 일반 카드 — 해외 기초지수는 지수대비 없음, 금융은 섹터 태그·지수대비 유지", () => {
  const scanner = section(renderMorningHtml(REPORT, data(mergedQuotes())), "KR ETF Market Scanner");
  const foreign = chunkWith(scanner, '<div class="etf-card">', "KODEX 미국반도체");
  assert.doesNotMatch(foreign, /지수대비/);
  const finance = chunkWith(scanner, '<div class="etf-card">', "TIGER 200 금융");
  assert.match(finance, /<span class="etf-tag">섹터<\/span>/);
  assert.doesNotMatch(finance, /원자재/);
  assert.match(finance, /지수대비/);
});

test("렌더 회귀: 전술 경고 보드 — 레버리지 행에 지수대비 없음", () => {
  const tactical = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Tactical ETF Warning Board");
  assert.match(tactical, /KODEX 레버리지/);
  assert.doesNotMatch(tactical, /지수대비/);
});

test("렌더 회귀: 액션 보드 행 태그 — TIGER 200 금융은 섹터", () => {
  const board = section(renderMorningHtml(REPORT, data(mergedQuotes())), "Domestic ETF Action Board");
  const row = chunkWith(board, '<div class="compact-etf-row">', "TIGER 200 금융");
  assert.match(row, /<span class="etf-tag">섹터<\/span>/);
  assert.doesNotMatch(row, /원자재/);
});

test("렌더 회귀: 그룹 시세가 없으면 매칭표·이슈 카드 폴백이 유니버스 이름을 쓴다", () => {
  const html = renderMorningHtml(REPORT, data([quote("069500.KS", "KODEX 200")]));
  const matching = section(html, "상세 글로벌-KR ETF 매칭");
  assert.match(matching, />SOXX iShares Semiconductor ETF<\/a>/);
  assert.match(matching, />TIGER 미국30년국채스트립액티브\(합성 H\) \(458250\)<\/a>/);
  assert.doesNotMatch(matching, />SOXX<\/a>/);
  const issues = section(html, "오늘 이슈별 관찰 ETF");
  assert.match(issues, />SOXX iShares Semiconductor ETF<\/a>/);
  assert.match(issues, />TIGER 미국30년국채스트립액티브\(합성 H\) \(458250\)<\/a>/);
  assert.doesNotMatch(issues, />(SOXX|458250|458250\.KS)<\/a>/);
  assert.doesNotMatch(html, /[0-9][0-9A-Z]{5}\.KS/);
  assert.doesNotMatch(html, /배당/);
  assert.doesNotMatch(html, /자금이 몰리는/);
});
```

- [ ] **Step 2: 실행**

Run: `npx tsx --test lib/etf/renderer-hardcode.test.ts`
Expected: PASS(Task 1~3 완료 상태). 실패하면 테스트가 아니라 구현 쪽 원인을 먼저 의심하되, 액션 보드 HTML 구조 가정(`section-title`·`etf-tags`)이 틀린 경우에만 슬라이스를 실제 마크업에 맞춰 고친다.

- [ ] **Step 3: 전체 검증**

Run: `npx tsx --test lib/*.test.ts lib/etf/*.test.ts && npx tsc --noEmit -p .`
Expected: 전부 PASS, tsc 출력 없음.

- [ ] **Step 4: 수동 확인용 HTML 생성**

스크래치 스크립트로 `mergedQuotes()`와 같은 데이터에 SPY·SOXX·TLT 등 미국 시세 몇 개를 더해 `renderMorningHtml` 결과를 세션 스크래치 디렉터리에 `etf-render-check.html`로 저장하고 브라우저로 연다. 확인: 이슈 카드 5장(배당·인컴 없음), 매칭표 4행, 히트맵 '수집 국내 ETF 평균', 액션 보드 3패널 배치가 깨지지 않음. 스크립트·HTML은 커밋하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/renderer-hardcode.test.ts
git commit -m "ETF 렌더 회귀 테스트: 지수대비 국내 1배 한정·gap 0 표시·태그·폴백 원코드 미노출"
```
