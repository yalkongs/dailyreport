# 아침 리포트 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily Market·ETF Today를 독자(경험이 조금 있는 개인 고객) 중심의 짧은 구조와 데이터 배경 미리보기 카드로 바꾸고, 06:40 병렬 생성·동시 발송으로 08:00 전에 내보낸다. 2026-10-19(월) 06:40부터 운영.

**Architecture:** 카드 그림(스트라이프·모자이크)은 공용 SVG 모듈 하나가 카드 PNG와 페이지 머리 띠를 함께 그린다. 두 리포트의 모델 출력 스키마를 새 섹션에 맞게 바꾸고, 숫자는 코드가 데이터에서 렌더하며 모델은 문장만 쓴다. 워크플로는 생성 job 두 개(병렬, 발송 안 함)와 발송 job 하나(두 리포트를 연달아 발송)로 나눈다.

**Tech Stack:** TypeScript, Next.js 16(app router), sharp(SVG→PNG), yahoo-finance2, GitHub Actions, macOS launchd, `npx tsx --test`(node:test), `npx tsc --noEmit -p .`

**Spec:** `docs/superpowers/specs/2026-10-17-morning-reports-redesign-design.md` — 모든 작업자는 먼저 읽는다.

## Global Constraints

- 브랜치 `feat/morning-redesign`(이미 spec 커밋 있음). 작업별 하위 브랜치를 쓰면 이 브랜치로 `--no-ff` 병합.
- `git add -A`·`git add .` 금지(`public/`·`docs/audits/`에 미추적·타 세션 파일). 파일을 명시해서 add.
- 커밋 메시지: 한국어 서술형, 끝에 빈 줄 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 주소 유지: `/reports/YYYY-MM-DD`, `/etf-reports/YYYY-MM-DD`, `/`, `/archive` 경로·구성 변경 금지. 과거 `public/reports/*.html`, `public/etf-reports/*.html` 수정 금지.
- 리포트 이름 "Daily Market"·"ETF Today" 유지. 머리글의 "iM AI Analyst" 표기 유지, 상단 AI 메타 줄(작성 시각·데이터 수) 금지.
- F02: 사실 검증은 1·2회차 재생성 사유, 마지막 축소판에서는 경고만(`factChecksAsWarnings`) — 발송을 막지 않는다.
- 법적 고지(`lib/legal-disclaimer.ts`)는 두 페이지 모두 맨 마지막.
- 매수·매도 권유 금지. "갖고 있다면 / 새로 본다면"은 조건·관찰형. 대표 ETF는 "예시" 표기.
- 2026-10-16 사실 검증(`lib/etf/numeric-claims.ts`, `findWeeklyReturnClaims`, `findFxDirectionErrors`, `checkAndFixTemporal`, `EVIDENCE_RULES`, 지수 블록·미국 지표 일정 블록)은 새 스키마의 **모든 산문 필드**에 그대로 적용.
- 카드 규격(spec 4): 1080×1350, 위쪽 끝 민트 그라데이션 테두리 12px(#00BFA5→#8BE08F), 하단 띠 없음, 바탕 #FFFFFF, 로고 = `loadBrandLogoDataUri()` 원본을 내용 영역(65,231, 871×564)만 잘라 높이 84px(이미지 변형 금지), 글꼴 `Pretendard, 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif`, 최소 글자 40px, 숫자는 카드에 넣지 않음(제목에 숫자 자체가 뉴스일 때만).
- 색(상승 빨강·하락 파랑, 연속): 보합 `#E7EAEE`(|r|<0.1) → 중간 `#EF6F65`/`#5B8DEF` → 최대 `#A50E0E`/`#0B3A8C`, `t = min(|r|/5,1)^0.8`, t<0.5는 보합→중간, 이후 중간→최대 선형 보간.
- 테스트 명령: `npx tsx --test lib/*.test.ts lib/etf/*.test.ts`(= `npm test`), 타입: `npx tsc --noEmit -p .`(= `npm run typecheck`).
- 런타임 Node 20(워크플로와 동일). 외부 API·Telegram·워크플로 실행은 Task 9에서만.

## Review Focus

1. **카드 문구가 길 때** — 제목 3줄·한 줄 2줄을 넘으면 글자를 단계적으로 줄이되(제목 94→80→72px, 한 줄 58→52→48px) 잘라내지 않고, 그래도 넘치면 검증 단계에서 재생성 사유가 된다 → Task 1·2·4 테스트.
2. **생성 job 하나가 실패한 날** — 발송 job은 성공한 리포트를 기다리지 않고 보내고, 실패한 쪽은 07:20 2차 트리거가 만들어 보낸다 → Task 6 테스트.
3. **데이터 일부 결측(Yahoo 장애로 코스피 일봉·일부 ETF 없음)** — 카드는 깨지지 않고(스트라이프 비면 중립 띠, 모자이크는 있는 타일만), 페이지도 섹션을 생략할 뿐 실패하지 않는다 → Task 1·3·5 테스트.
4. **주말 dry-run 날짜 지정(test_date)** — 휴장 판정이 지정 날짜로 돌고, 커밋·발송은 하지 않는다 → Task 6 테스트, Task 9 실행.
5. **06:40 중복 요청(cron-job.org 잔존)** — 생성은 job 동시성·중복 가드로, 발송은 deliver 동시성 그룹·발송 상태로 한 번만 → Task 6 테스트.

---

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `lib/preview/data-card.ts` (신규) | 연속 색, 스트라이프·모자이크 SVG, 카드 SVG 2종, 모자이크 타일 구성, PNG 저장 | T1 |
| `assets/fonts/Pretendard-{SemiBold,Bold,ExtraBold}.otf` (신규) | 서버 카드 렌더 글꼴(OFL) | T1 |
| `lib/market-data.ts` | 코스피 20거래일 일간 등락 수집 | T2 |
| `lib/types.ts`, `lib/claude-client.ts`, `lib/context-data.ts` | Market 출력 스키마(summary·cardLine), 프롬프트, 검증, 컨텍스트에 코스피 일봉 | T2 |
| `lib/report-renderer.ts`, `lib/report-template.css`, `src/app/reports/[date]/page.tsx`, `scripts/run.ts`, `lib/market-run-guards.ts`, `lib/market/preview.ts` | Market 새 페이지·메타·카드 연결 | T3 |
| `lib/etf/asset-classes.ts` (신규), `lib/etf/types.ts`, `lib/etf/claude-client.ts`, `lib/etf/report-quality.ts` | ETF 자산군 슬롯, 출력 스키마, 프롬프트, 검증 | T4 |
| `lib/etf/renderer.ts`, `lib/etf/report-preview.ts`, `scripts/run-etf.ts` | ETF 새 페이지·메타·카드 연결 | T5 |
| `.github/workflows/*.yml`, `scripts/delivery-state.ts`, `scripts/check-delivery.ts` | 병렬 생성·deliver job·test_date·Ubuntu 고정·글꼴 설치·utm·감시 07:45 | T6 |
| `ops/macmini/*` | 06:40·07:20 both 트리거, 07:45 감시 1개, 설치 스크립트 라벨 이전 | T7 |
| `package.json`, `package-lock.json`, `src/app/layout.tsx`, `README.md` | Web Analytics, 운영 문서 | T8 |

의존: T3 ← T1·T2, T5 ← T1·T4. 나머지(T1·T2·T4·T6·T7·T8)는 서로 파일이 겹치지 않아 병렬 가능. T9는 전부 끝난 뒤.

---

### Task 1: 데이터 카드 공용 모듈 (`lib/preview/data-card.ts`)

**Files:**
- Create: `lib/preview/data-card.ts`, `lib/preview/data-card.test.ts`
- Create: `assets/fonts/Pretendard-SemiBold.otf`, `Pretendard-Bold.otf`, `Pretendard-ExtraBold.otf` (https://github.com/orioncactus/pretendard 릴리스 v1.3.9 `public/static/` OTF, OFL — `assets/fonts/LICENSE.txt` 함께)
- Read only: `lib/preview/brand-logo.ts`(`loadBrandLogoDataUri`), `lib/market-calendar.ts`(`koreanWeekday`), `lib/etf/universe.ts`(`getEtfByTicker`), `lib/etf/story-characters.ts`(`isTacticalEtf`)

**Interfaces (Produces):**
```ts
export interface StripeSession { date: string; pct: number }          // date YYYY-MM-DD(KST 거래일)
export interface MosaicTile { ticker: string; market: 'KR' | 'US'; category: string; pct: number; featured: boolean }
export interface MarketCardInput { date: string; headline: string; line: string; sessions: StripeSession[] }
export interface EtfCardInput { date: string; headline: string; holdingLabel: string; line: string; tiles: MosaicTile[] }
export function diverging(pct: number): string                         // '#RRGGBB'
export function renderStripesSvg(sessions: StripeSession[], width: number, height: number, opts?: { marker?: boolean }): string  // <svg> 조각
export function renderMosaicSvg(tiles: MosaicTile[], width: number, height: number): string
export function buildMosaicTiles(quotes: Array<{ ticker: string; name: string; market: 'KR' | 'US'; changePercent: number | null }>, featuredTheme: string | null): MosaicTile[]
export function fitText(text: string, sizes: number[], maxLines: number, maxWidthPx: number): { size: number; lines: string[]; overflow: boolean }
export function renderMarketCardSvg(input: MarketCardInput): string    // 1080×1350
export function renderEtfCardSvg(input: EtfCardInput): string
export async function saveCardPng(svg: string, outPath: string): Promise<string>
export function cardDateLabel(date: string): string                    // '10.16 금'
```

- [ ] **Step 1: 실패하는 테스트 작성** — `lib/preview/data-card.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diverging, renderStripesSvg, buildMosaicTiles, renderMosaicSvg, fitText, renderMarketCardSvg, renderEtfCardSvg, cardDateLabel } from './data-card'

test('연속 색: 보합·중간·최대, 방향', () => {
  assert.equal(diverging(0.05), '#E7EAEE')
  assert.equal(diverging(-9), '#0B3A8C')
  assert.equal(diverging(9), '#A50E0E')
  assert.notEqual(diverging(1), diverging(3)) // 연속
  assert.match(diverging(-2), /^#[0-9A-F]{6}$/)
})

test('스트라이프: 거래일 수만큼 줄, 마지막 아래 ▼, 빈 입력은 중립 띠', () => {
  const s = renderStripesSvg([{ date: '2026-10-14', pct: -0.44 }, { date: '2026-10-15', pct: -7.57 }], 1080, 560, { marker: true })
  assert.equal((s.match(/data-session=/g) ?? []).length, 2)
  assert.match(s, /data-marker="today"/)
  assert.match(s, /fill="#0B3A8C"/)
  const empty = renderStripesSvg([], 1080, 560)
  assert.match(empty, /fill="#E7EAEE"/)
})

test('모자이크 타일: 레버리지·인버스 제외, 자산군 순서 후 등락순, 주제 테마 강조', () => {
  const q = (ticker: string, name: string, market: 'KR' | 'US', p: number) => ({ ticker, name, market, changePercent: p })
  const tiles = buildMosaicTiles([
    q('122630.KS', 'KODEX 레버리지', 'KR', -16), q('252670.KS', 'KODEX 200선물인버스2X', 'KR', 15),
    q('069500.KS', 'KODEX 200', 'KR', -8.2), q('091160.KS', 'KODEX 반도체', 'KR', -11.9),
    q('SPY', 'SPDR S&P 500', 'US', 0.3), q('SOXX', 'iShares Semiconductor', 'US', -0.9), q('XXX', '결측', 'US', null as unknown as number),
  ], '반도체')
  assert.deepEqual(tiles.map(t => t.ticker), ['069500.KS', '091160.KS', 'SPY', 'SOXX'])
  assert.deepEqual(tiles.filter(t => t.featured).map(t => t.ticker), ['091160.KS', 'SOXX'])
  const svg = renderMosaicSvg(tiles, 1080, 600)
  assert.match(svg, />Korea</); assert.match(svg, />USA</)
  assert.equal((svg.match(/data-featured="1"/g) ?? []).length, 2)
})

test('fitText: 넘치면 글자를 줄이고, 최소 크기에서도 넘치면 overflow', () => {
  const ok = fitText('코스피 급락 다음 날, 미 증시는 숨 고르기', [94, 80, 72], 3, 936)
  assert.equal(ok.overflow, false); assert.ok(ok.lines.length <= 3); assert.equal(ok.size, 94)
  const long = fitText('가'.repeat(80), [94, 80, 72], 3, 936)
  assert.equal(long.overflow, true)
})

test('Market 카드: 규격·위쪽 테두리·로고 원본 크롭·숫자 없음·날짜', () => {
  const svg = renderMarketCardSvg({ date: '2026-10-16', headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', line: '해외 충격보다 국내 수급 부담이 더 컸습니다', sessions: [{ date: '2026-10-15', pct: -7.57 }] })
  assert.match(svg, /width="1080" height="1350"/)
  assert.match(svg, /data-role="top-border"/)
  assert.doesNotMatch(svg, /data-role="bottom-bar"/)
  assert.match(svg, /viewBox="65 231 871 564"/)
  assert.match(svg, /Daily Market/); assert.match(svg, /10\.16 금/)
  assert.doesNotMatch(svg, /[+\-−]\d+(\.\d+)?%/)
  assert.equal(cardDateLabel('2026-10-16'), '10.16 금')
})

test('ETF 카드: Korea/USA, 갖고 있다면 라벨, 불릿 없음', () => {
  const svg = renderEtfCardSvg({ date: '2026-10-16', headline: '반도체 ETF, 미국보다 훨씬 크게 빠졌다', holdingLabel: '반도체를 갖고 있다면', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다', tiles: [] })
  assert.match(svg, /ETF Today/); assert.match(svg, /반도체를 갖고 있다면/)
  assert.doesNotMatch(svg, /data-role="bullet"/)
})
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test lib/preview/data-card.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현**
  - 색: Global Constraints 공식 그대로(`_mix` 선형 보간, 대문자 hex).
  - `renderStripesSvg`: 세션마다 `<rect data-session="${date}" x y width height fill>`(틈 없이 폭 = width/n, 마지막 rect만 폭 반올림 보정). `marker`면 마지막 줄 중앙 아래 `<path data-marker="today">`(삼각형 36×20, 색 = 마지막 줄). 빈 배열이면 전폭 `#E7EAEE` rect 하나.
  - `buildMosaicTiles`: `changePercent` null·NaN 제외, `isTacticalEtf({ ticker, name })` 제외, `getEtfByTicker(ticker)?.category ?? '기타'`. 시장별로 정렬 키 `[ORDER[category] ?? 9, pct]`(ORDER = 지수 0, 해외지수 1, 섹터 2, 테마 3, 팩터 4, 채권 5, 대안 6). `featured = featuredTheme !== null && getEtfByTicker(t)?.theme === featuredTheme`. 시장별 최대 50.
  - `renderMosaicSvg`: 배경 `#F3F5F7`, 라벨 `Korea`(x=72)·`USA`(x=574) 40px/700 `#4B5563` y=88, 면당 10열×5행 타일 40.3×78, 간격 7, rx 6, y 시작 128. 강조 타일은 `stroke="#111827" stroke-width="5" data-featured="1"`.
  - `fitText`: 글자 폭 추정 = 한글·전각 1.0em, 영문·숫자·공백 0.55em, 구두점 0.35em; 공백 단위로 줄바꿈(단어가 한 줄보다 길면 글자 단위). sizes 순서대로 시도해 `lines ≤ maxLines`인 첫 크기 반환, 없으면 마지막 크기·`overflow:true`(잘라내지 않음).
  - 카드 공통: `<svg width="1080" height="1350">` 바탕 `#FFFFFF`, 위쪽 끝 `<rect data-role="top-border" height="12" fill="url(#mint)">`(linearGradient #00BFA5→#8BE08F), 로고 `<svg x="72" y="${y}" width="${871*84/564}" height="84" viewBox="65 231 871 564"><image href="${loadBrandLogoDataUri()}" width="1000" height="1000"/></svg>`, 로고 오른쪽 26px 뒤 구분선(3×56 `#D1D5DB`), 이름 46px/700 `#0B6E61`, 날짜 오른쪽 정렬 44px/600 `#6B7280`.
  - Market 카드: 스트라이프 띠 0~560(`marker:true`), 머리 줄 y=620~704, 제목 `fitText(headline,[94,80,72],3,936)` 800 `#111827` 행간 1.2 시작 y=752, 한 줄 `fitText(line,[58,52,48],2,936)` 700 `#0F5E55` 행간 1.32 시작 y=1042(제목 3줄이면 아래로 밀림 — 제목 마지막 줄 + 60px와 1042 중 큰 값).
  - ETF 카드: 모자이크 띠 0~600, 머리 줄 y=640, 제목 `[88,80,72]` 시작 y=767, 라벨 46px/700 `#0B6E61` y=1032(불릿 없음), 한 줄 58px/700 `#111827` y=1102.
  - 글꼴 문자열은 Global Constraints. `saveCardPng`: `sharp(Buffer.from(svg)).png().toFile(outPath)` 후 outPath 반환(디렉터리 mkdir).
  - 글꼴 파일 3종과 LICENSE를 `assets/fonts/`에 추가(서버 렌더는 Task 6에서 runner에 설치).

- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npx tsc --noEmit -p .` 출력 없음.

- [ ] **Step 5: 육안 확인** — 스크래치 스크립트(커밋 안 함)로 두 카드 PNG를 `/tmp`에 저장해 열어 보고 spec 4·브레인스토밍 시안(`.superpowers/brainstorm/*/content/cards-final.html`)과 대조.

- [ ] **Step 6: 커밋** — `git add lib/preview/data-card.ts lib/preview/data-card.test.ts assets/fonts` → "데이터 배경 미리보기 카드 모듈 — 스트라이프·모자이크·연속 색·글자 맞춤·정식 로고 크롭"

---

### Task 2: Market 출력 스키마·프롬프트·검증 + 코스피 일봉

**Files:**
- Modify: `lib/types.ts`(ReportContent, ReportMeta, ContextData), `lib/claude-client.ts`(buildReportPrompt JSON 스키마·규칙, 파싱 후 검증), `lib/market-data.ts`, `lib/context-data.ts`
- Test: `lib/market-content.test.ts`(신규)

**Interfaces (Produces):**
```ts
// lib/types.ts
export interface ReportSummary { yesterday: string; today: string; myAssets: string }
export interface ReportCardLine { kind: 'cause' | 'watch'; text: string }
// ReportContent 에 추가: summary: ReportSummary; cardLine: ReportCardLine
// ReportContent.compass 는 optional 로(새 프롬프트는 생성하지 않음)
// ReportMeta 에 추가: description?: string; cardLine?: string
// ContextData 에 추가: kospiSessions: import('./preview/data-card').StripeSession[]
// lib/market-data.ts
export function dailyReturnsFromCloses(quotes: Array<{ date: Date; close: number | null | undefined }>, n: number): StripeSession[]
export async function collectKospiSessions(n?: number): Promise<StripeSession[]>   // 기본 20, 실패 시 []
// lib/claude-client.ts
export function validateMarketSummary(content: Pick<ReportContent, 'summary' | 'cardLine' | 'cover'>): string[]   // 위반 목록
export function summarySentence(summary: ReportSummary): string    // og:description·인덱스 description, ≤ 90자, 문장 경계에서 자름
```

- [ ] **Step 1: 실패하는 테스트** — `lib/market-content.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyReturnsFromCloses } from './market-data'
import { validateMarketSummary, summarySentence } from './claude-client'

test('코스피 일봉 → 일간 등락(휴장일 없음, 최근 n개)', () => {
  const q = [
    { date: new Date('2026-10-08T00:00:00Z'), close: 6625.5 },
    { date: new Date('2026-10-12T00:00:00Z'), close: 6384.24 },
    { date: new Date('2026-10-13T00:00:00Z'), close: null },
    { date: new Date('2026-10-14T00:00:00Z'), close: 6008.5 },
  ]
  const r = dailyReturnsFromCloses(q, 20)
  assert.deepEqual(r.map(x => x.date), ['2026-10-12', '2026-10-14'])
  assert.ok(Math.abs(r[0].pct - (6384.24 / 6625.5 - 1) * 100) < 1e-9)
})

const OK = {
  cover: { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', subline: 's' },
  summary: { yesterday: '국내 증시는 수급 부담에 크게 밀렸고 미 증시는 숨을 골랐습니다.', today: '개장 30분 거래대금이 돌아오는지가 첫 확인점입니다.', myAssets: '자산군별 판단 재료는 ETF Today에서 볼 수 있습니다.' },
  cardLine: { kind: 'cause' as const, text: '해외 충격보다 국내 수급 부담이 더 컸습니다' },
}

test('요약·카드 한 줄 검증: 정상 통과', () => assert.deepEqual(validateMarketSummary(OK), []))

test('요약·카드 한 줄 검증: 누락·길이·질문형·숫자 나열', () => {
  assert.ok(validateMarketSummary({ ...OK, summary: { ...OK.summary, today: '' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '왜? 국내 수급' } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, cardLine: { kind: 'cause', text: '가'.repeat(40) } }).length > 0)
  assert.ok(validateMarketSummary({ ...OK, summary: { ...OK.summary, yesterday: '코스피 −7.57%, S&P500 +0.33%, 나스닥 +0.08%' } }).length > 0)
})

test('요약 문장: 어제+오늘, 90자 이내', () => {
  const s = summarySentence(OK.summary)
  assert.ok(s.length <= 90); assert.match(s, /^국내 증시는/)
})
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test lib/market-content.test.ts` → FAIL

- [ ] **Step 3: 구현**
  - `dailyReturnsFromCloses`: close 유효값만, 날짜 = `sessionDate(date,'Asia/Seoul')`(`lib/etf/market-context.ts`의 export 재사용), 연속 쌍의 등락, 마지막 n개.
  - `collectKospiSessions(n=20)`: `yahooFinance.chart('^KS11', { period1: now-45일, interval: '1d' })` → 위 함수. 오늘(KST) 세션 값은 제외(장중 재실행 대비, 날짜 < 오늘). 예외 시 `[]` + 로그.
  - `context-data.ts`: 병렬 수집에 `collectKospiSessions(20)` 추가, `ContextData.kospiSessions`.
  - 프롬프트(`buildReportPrompt`의 JSON 스키마): `"summary": { "yesterday": string, "today": string, "myAssets": string }`, `"cardLine": { "kind": "cause" | "watch", "text": string }` 추가, `"compass"` 스키마·작성 지시 제거. 규칙 추가:
    - summary.yesterday: 어제 한국·미국 시장 분위기와 배경을 **말로** 한 문장(지수 등락률 나열 금지, 숫자는 최대 1개), 60자 이내.
    - summary.today: 오늘 확인할 한 가지(시각 또는 비교 기준 포함), 60자 이내.
    - summary.myAssets: 자산군 관점은 ETF Today에서 다룬다는 안내 + 오늘 가장 영향이 큰 자산군 하나, 60자 이내.
    - cardLine: 미리보기 카드의 제목 아래 한 줄, 32자 이내 평서문. 질문형·도치("왜?", "~은?")·라벨 금지. kind=cause는 입력 근거(수치·기사)가 있을 때만, 근거가 약하면 kind=watch로 오늘 확인점을 평서문으로.
    - bigStory 4~6문단, watchPoints 최대 3개(한국시간 순, 미국 발표는 "장 마감 후 → 다음 거래일 반영"), soWhat 2~3개("확인되면 / 어긋나면" 조건).
  - `validateMarketSummary`: 세 요약 필드·cardLine.text 공백 금지, 요약 각 ≤ 60자, cardLine ≤ 32자, cardLine `?`·`왜` 시작 금지, 요약 yesterday에 `%`가 2개 이상이면 위반. 위반이 있으면 기존 Market 재시도 루프의 `hardViolations`에 합류(재시도 소진 후에는 기존 F02대로 진행 — 단, summary·cardLine 누락이면 빈 값 대신 cover.subline/“오늘 확인점” 기본 문장으로 채워 렌더가 깨지지 않게 `fillMarketSummaryDefaults(content)`).
  - `summarySentence`: `${yesterday} ${today}` 공백 정리, 90자 초과 시 마지막 문장부호(`.`/`다`) 경계에서 자름.

- [ ] **Step 4: 통과 확인** — 위 테스트 + `npm test` 전체 + `npx tsc --noEmit -p .`. 기존 테스트 중 compass 의존 테스트가 깨지면 compass optional 처리로 맞춘다(렌더 제거는 Task 3).

- [ ] **Step 5: 커밋** — `git add lib/types.ts lib/claude-client.ts lib/market-data.ts lib/context-data.ts lib/market-content.test.ts` → "Market 출력 스키마 개편 — 세 줄 요약·카드 한 줄 생성·검증, compass 제거, 코스피 20거래일 수집"

---

### Task 3: Market 새 페이지·메타·카드 연결

**Files:**
- Modify: `lib/report-renderer.ts`, `lib/report-template.css`, `lib/market/preview.ts`, `scripts/run.ts`, `lib/market-run-guards.ts`, `src/app/reports/[date]/page.tsx`(generateMetadata만)
- Test: `lib/market-page.test.ts`(신규), 기존 `lib/legal-disclaimer.test.ts`·`lib/source-links.test.ts`·`lib/historical-baseline.test.ts`가 계속 통과
- AGENTS.md: `src/app` 수정 전 `node_modules/next/dist/docs/` 해당 문서 확인

**Interfaces:**
- Consumes: T1 `renderStripesSvg`, `renderMarketCardSvg`, `saveCardPng`, `StripeSession`; T2 `ReportContent.summary/cardLine`, `ContextData.kospiSessions`, `summarySentence`, `ReportMeta.description/cardLine`
- Produces: `renderReport(content, data, historical, mode, sources, kospiSessions?: StripeSession[])`; `saveMarketPreviewImage(date: string, input: { headline: string; line: string; sessions: StripeSession[] }): Promise<string>`; `pickKeyIndicators(data: MarketDataCollection): Array<{ label: string; value: string; changePercent: number }>`(정확히 6개 이하)

- [ ] **Step 1: 실패하는 테스트** — `lib/market-page.test.ts`

```ts
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
```

- [ ] **Step 2: 실패 확인** — FAIL

- [ ] **Step 3: 구현**
  - `renderReport`: 섹션을 spec 3.1 순서로 재구성. 각 섹션 루트에 `data-section` 속성. masthead = 로고·"Daily Market"·날짜 + `renderStripesSvg(sessions, 680, 120, {marker:true})`(비면 생략) + "최근 20거래일 코스피 등락(색이 짙을수록 큰 움직임)". summary = 세 줄 상자(어제 / 오늘 볼 것 / 내 자산은 → `/etf-reports/${date}` 링크). key-indicators = `pickKeyIndicators`(코스피·S&P 500·나스닥·원/달러·미 10년물 + 유가·금·비트코인 중 |등락| 최대 1개, 데이터 없는 항목은 생략). story = bigStory, today = watchPoints(최대 3), meaning = soWhat(최대 3), details = `<details data-section="details"><summary>전체 지표·이번 주 일정·과거 비교</summary>` 안에 기존 시장 체온(13개)·일정표·과거 비교. 이후 참고한 뉴스·푸터(법적 고지 마지막) 유지. compass 렌더 함수 삭제.
  - head 메타: `og:description` = `summarySentence(content.summary)`, `<meta property="og:site_name" content="iM뱅크">`.
  - CSS(`lib/report-template.css`): 본문 왼쪽 정렬(양쪽 정렬 제거), 읽기 폭 640px, 요약 상자(`#EEFAF7` 바탕·`#BFE9DF` 테두리·radius 10), `details` 접힘 스타일, 핵심 지표 3열 그리드(모바일 3열 유지).
  - `lib/market/preview.ts`: `saveMarketPreviewImage(date, { headline, line, sessions })` → `saveCardPng(renderMarketCardSvg({ date, headline, line, sessions }), marketPreviewPath(date))`. 기존 `renderPreviewCardSvg` 사용 제거.
  - `scripts/run.ts`·`lib/market-run-guards.ts`: `RenderPreview` 타입을 `(date: string, headline: string, subline: string) => Promise<string>`에서 그대로 두고, run.ts에서 클로저로 `(d, h) => saveMarketPreviewImage(d, { headline: h, line: content.cardLine.text, sessions: contextData?.kospiSessions ?? [] })` 전달. 인덱스 meta에 `description: summarySentence(content.summary)`, `cardLine: content.cardLine.text` 추가(`saveMarketReportBundle` 입력에 optional 필드 추가). PNG 복구 경로는 `entry.cardLine ?? entry.subline`과 `collectKospiSessions(20)`로 렌더.
  - `src/app/reports/[date]/page.tsx` `generateMetadata`: `description: report?.description || report?.subline || 기본문`, `openGraph.siteName: 'iM뱅크'`. 페이지 본문 로직은 그대로.

- [ ] **Step 4: 통과 확인** — `npm test`, `npx tsc --noEmit -p .`. 깨지는 기존 테스트는 새 구성 기준으로 갱신(삭제한 compass·옛 순서 단언만).

- [ ] **Step 5: 육안 확인** — 스크래치로 실데이터 없이 fixture 렌더 → 헤드리스 Chrome 390×844 스크린샷(커밋 안 함). 섹션 순서·요약 상자·접힘·고지 마지막 확인.

- [ ] **Step 6: 커밋** — "Market 새 페이지 — 머리 스트라이프·세 줄 요약·핵심 지표 6개·펼쳐 보기, 데이터 카드 미리보기, og 설명·사이트명"

---

### Task 4: ETF 자산군 슬롯·출력 스키마·프롬프트·검증

**Files:**
- Create: `lib/etf/asset-classes.ts`, `lib/etf/asset-classes.test.ts`
- Modify: `lib/etf/types.ts`(MorningReport), `lib/etf/claude-client.ts`(buildMorningPrompt·SYSTEM_PROMPT의 출력 스키마), `lib/etf/report-quality.ts`(flatten·필수 필드·옛 검사 정리), `lib/etf/report-language.ts`(정규화 대상 필드)
- Test: 기존 `lib/etf/*.test.ts` 중 옛 필드(narrativeNotes·characters·strategyProse)에 묶인 테스트는 새 스키마로 갱신하거나 제거

**Interfaces (Produces):**
```ts
// lib/etf/asset-classes.ts
export type AssetClassKey = 'kr-large' | 'kr-semi' | 'kr-sector' | 'us-equity' | 'bonds' | 'commodities'
export interface AssetRep { ticker: string; name: string; market: 'KR' | 'US'; pct: number }
export interface AssetClassSlot { key: AssetClassKey; label: string; holdingLabel: string; theme: string | null; reps: AssetRep[]; movePct: number }
export function buildAssetClassSlots(quotes: EtfQuote[]): AssetClassSlot[]   // 데이터 있는 슬롯만, 중요도(|movePct|) 내림차순
export function pickFeaturedSlot(slots: AssetClassSlot[]): AssetClassSlot | null   // KR 슬롯(kr-*) 중 |movePct| 최대, 없으면 첫 슬롯
// types.ts ↔ asset-classes.ts 는 서로 `import type`만 쓴다(런타임 순환 없음)
// lib/etf/types.ts
export interface MorningReport {
  cover: { headline: string; subline: string }
  summary: { overseas: string; domestic: string; focus: string }
  assetCards: Array<{ key: AssetClassKey; reason?: string; ifHolding: string; ifConsidering: string }>
  todayChecks: Array<{ time: string; what: string; baseline: string; invalidation: string }>   // 정확히 3
  card: { key: AssetClassKey; line: string }
  tacticalWarning?: string
}
```

- [ ] **Step 1: 실패하는 테스트** — `lib/etf/asset-classes.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAssetClassSlots, pickFeaturedSlot } from './asset-classes'
import type { EtfQuote } from './types'

const q = (ticker: string, name: string, pct: number): EtfQuote => ({
  ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1,
  aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null,
} as EtfQuote)

const QUOTES = [
  q('069500.KS', 'KODEX 200', -8.21), q('091160.KS', 'KODEX 반도체', -11.94), q('396500.KS', 'TIGER 반도체TOP10', -10.86),
  q('122630.KS', 'KODEX 레버리지', -16.42), q('360750.KS', 'TIGER 미국S&P500', -1.04), q('SPY', 'SPDR S&P 500', 0.28),
  q('TLT', 'iShares 20+ Year Treasury', 0.4), q('GLD', 'SPDR Gold', 0.5), q('305080.KS', 'TIGER 미국채10년선물', -0.2),
]

test('슬롯: 레버리지 제외, 대표 ETF 최대 2개, 중요도순', () => {
  const s = buildAssetClassSlots(QUOTES)
  assert.equal(s[0].key, 'kr-semi')
  assert.ok(s.every(x => x.reps.length >= 1 && x.reps.length <= 2))
  assert.ok(!s.some(x => x.reps.some(r => r.ticker === '122630.KS')))
  assert.equal(s.find(x => x.key === 'kr-semi')?.holdingLabel, '반도체를 갖고 있다면')
})

test('주제 슬롯: 국내 슬롯 중 움직임 최대', () => {
  assert.equal(pickFeaturedSlot(buildAssetClassSlots(QUOTES))?.key, 'kr-semi')
  assert.equal(pickFeaturedSlot([]), null)
})

test('데이터 없는 자산군은 슬롯을 만들지 않는다', () => {
  const s = buildAssetClassSlots([q('SPY', 'SPDR S&P 500', 0.3)])
  assert.deepEqual(s.map(x => x.key), ['us-equity'])
})
```

추가 테스트(같은 파일 또는 `lib/etf/report-quality.v2.test.ts`): 새 스키마 리포트에서 (a) todayChecks가 3개가 아니면 위반, (b) card.key가 슬롯에 없으면 위반, (c) card.line 32자 초과·질문형이면 위반, (d) 산문 필드의 "코스피 6.21%"(실제 −5.46%)를 `findNumericClaimMismatches`가 잡는다(= flatten에 새 필드가 모두 포함), (e) `factChecksAsWarnings`에서는 (d)가 위반 목록에 없다.

- [ ] **Step 2: 실패 확인** — FAIL

- [ ] **Step 3: 구현**
  - 슬롯 정의(유니버스 `getEtfByTicker` category·theme·foreignUnderlying 사용, 레버리지·인버스는 `isTacticalEtf`로 제외):
    - `kr-large` 국내 대형주(KR, category 지수) — holdingLabel "국내 대형주를 갖고 있다면"
    - `kr-semi` 국내 반도체·IT(KR, theme 반도체·AI) — "반도체를 갖고 있다면"
    - `kr-sector` 그날 가장 크게 움직인 국내 섹터(KR, 섹터·테마 중 반도체·AI 제외, theme별 평균 |pct| 최대 theme) — label = theme명, "○○를 갖고 있다면"(받침에 따라 을/를)
    - `us-equity` 미국 주식(환노출) — KR foreignUnderlying 주식형 + US 지수(SPY·QQQ) — "미국 주식을 갖고 있다면"
    - `bonds` 채권(KR·US 채권) — "채권을 갖고 있다면"
    - `commodities` 금·원자재(KR·US 대안 중 원자재) — "금·원자재를 갖고 있다면"
    - reps: 슬롯 내 |pct| 큰 순 최대 2개(KR 우선 1개 + 해당되면 US 1개). movePct = reps의 국내 대표 등락(없으면 첫 rep).
  - 프롬프트: 기존 공통 블록(독자·발행 맥락, 지수 실측, 미국 지표 일정, 거시, 뉴스·catalyst, 인용 규칙, cover.headline 작성 규칙, 준법·표현 규칙, 기간, 환율 방향, EVIDENCE_RULES)은 유지. narrativeNotes·Characters·strategyProse·todayWatch 지시와 JSON 스키마 제거. 새 블록 `[자산군 슬롯 — 코드가 확정]`에 슬롯별 key·label·대표 ETF(이름·코드·등락)를 나열하고 "숫자는 화면에 코드가 표시하므로 문장에 반복하지 말 것", 새 JSON 스키마와 작성 규칙(summary 각 60자 이내 / assetCards는 주어진 key 전부, reason은 입력 근거 있을 때만 / ifHolding·ifConsidering 조건·관찰형 60자 이내 / todayChecks 정확히 3개: time(한국시간)·what·baseline(비교 기준)·invalidation(어긋나면 버릴 가설) / card: key = `pickFeaturedSlot` key, line 32자 이내 평서문·질문형 금지 / tacticalWarning은 레버리지·인버스 |등락| 10% 이상일 때만).
  - `report-quality.ts`: `flattenMorningReport`를 새 필드(cover, summary, assetCards 전 필드, todayChecks 전 필드, card.line, tacticalWarning)로. 옛 필드 전용 검사(`checkCharacterProseConsistency`, todayWatch 3개, krImpact 연결 등) 제거·대체: todayChecks 3개, assetCards key ⊆ 슬롯, card.key ∈ 슬롯, card.line 길이·질문형. 사실 검증(수치·주간·환율)·준법 패턴·중복 문장·soft fix는 유지.
  - `report-language.ts`: 정규화 대상 필드를 새 스키마로.
  - `run-etf.ts`의 Tier 1 fallback에서 `narrativeNotes` 제거 코드는 삭제(fallback = 재생성 + `validateMorningReport`의 사실 경고 모드) — 이 줄 수정은 Task 5와 겹치지 않게 **Task 4가 담당**.

- [ ] **Step 4: 통과 확인** — `npm test`, tsc. 옛 스키마 테스트 정리 결과를 커밋 메시지에 명시.

- [ ] **Step 5: 커밋** — "ETF 출력 스키마 개편 — 자산군 슬롯(코드 확정)·세 줄 요약·확인 3가지·카드 한 줄, 검증을 새 필드로"

---

### Task 5: ETF 새 페이지·메타·카드 연결

**Files:**
- Modify: `lib/etf/renderer.ts`(renderMorningHtml 구성·삭제 섹션 정리·saveReportPreviewImage), `lib/etf/report-preview.ts`(설명 문구·사이트명), `scripts/run-etf.ts`(프리뷰 호출·인덱스)
- Test: `lib/etf/etf-page.test.ts`(신규), 옛 섹션 단언 테스트(`renderer-hardcode.test.ts`, `renderer-metrics.test.ts`, `domestic-stress.test.ts`의 렌더 단언, `fx-direction.test.ts`의 renderer 소스 스캔) 갱신

**Interfaces:**
- Consumes: T1 `renderMosaicSvg`, `buildMosaicTiles`, `renderEtfCardSvg`, `saveCardPng`; T4 `MorningReport`, `buildAssetClassSlots`, `pickFeaturedSlot`
- Produces: `renderMorningHtml(report, data, options)`(시그니처 불변); `saveReportPreviewImage(date: string, input: { headline: string; holdingLabel: string; line: string; tiles: MosaicTile[] }): Promise<string>`

- [ ] **Step 1: 실패하는 테스트** — `lib/etf/etf-page.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderMorningHtml } from './renderer'
import type { CollectedData, EtfQuote, MorningReport } from './types'

const q = (ticker: string, name: string, pct: number) => ({ ticker, name, market: ticker.endsWith('.KS') ? 'KR' : 'US', price: 100, change: 0, changePercent: pct, volume: 1000, aum: null, nav: null, premiumDiscount: null, trackingError: null, prev20AvgVolume: null }) as EtfQuote
const data = { reportType: 'morning', date: '2026-10-16', flows: [], investorFlows: [], news: [], analysisLens: '',
  quotes: [q('069500.KS', 'KODEX 200', -8.21), q('091160.KS', 'KODEX 반도체', -11.94), q('SPY', 'SPDR S&P 500', 0.28)],
  macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null } } as CollectedData
const report: MorningReport = {
  cover: { headline: '반도체 ETF, 미국보다 훨씬 크게 빠졌다', subline: '부제' },
  summary: { overseas: '미국 대형주 보합, 반도체만 약세', domestic: '전일 급락, 변동성 매우 큼', focus: '반도체 ETF 개장 30분 거래대금' },
  assetCards: [{ key: 'kr-semi', ifHolding: '개장 30분 거래대금이 전일 같은 시간보다 늘면 과잉 하락 되돌림 신호로 볼 수 있습니다', ifConsidering: '급락 다음 날은 변동폭이 커 확인 조건부터 봅니다' },
               { key: 'kr-large', ifHolding: 'a', ifConsidering: 'b' }],
  todayChecks: [{ time: '09:00~09:30', what: '반도체 ETF 거래대금', baseline: '전일 같은 시간', invalidation: '줄면 되돌림 가설 보류' },
                { time: '10:00', what: 'w', baseline: 'b', invalidation: 'i' }, { time: '15:30', what: 'w', baseline: 'b', invalidation: 'i' }],
  card: { key: 'kr-semi', line: '반등인지 추가 하락인지 오전 흐름을 지켜볼 때입니다' },
}

test('ETF 새 구성: 순서, 자산군 카드 숫자는 코드 렌더, 예시 표기, 옛 섹션 없음, 고지 마지막', () => {
  const html = renderMorningHtml(report, data)
  const order = ['data-section="masthead"', 'data-section="summary"', 'data-section="asset-cards"', 'data-section="today-checks"', 'data-section="details"', '투자 유의사항 및 법적 고지']
  const idx = order.map(k => html.indexOf(k)); idx.forEach((v, i) => assert.ok(v >= 0, order[i]))
  assert.deepEqual([...idx].sort((a, b) => a - b), idx)
  assert.match(html, /KODEX 반도체[^<]*<\/[^>]+>[\s\S]{0,200}−11\.94%/) // 코드가 렌더한 등락
  assert.match(html, /예시/)
  for (const gone of ['Decision Frame', 'Characters In The Story', 'ETF군별 전략 지도', 'Domestic ETF Action Board', '규칙 점수', '확신도']) assert.ok(!html.includes(gone), gone)
  assert.match(html, />Korea</)
  assert.match(html, /property="og:site_name" content="iM뱅크"/)
  assert.ok(html.lastIndexOf('투자 유의사항 및 법적 고지') > html.indexOf('data-section="details"'))
})

test('모델이 빠뜨린 자산군 슬롯도 숫자만 있는 카드로 나온다', () => {
  const html = renderMorningHtml(report, data) // report.assetCards 에 us-equity 없음, data 에 SPY 있음
  assert.match(html, /data-asset="us-equity"/)
  assert.match(html, /SPDR S&P 500/)
})

test('레버리지·인버스 주의는 해당 필드가 있을 때만', () => {
  assert.doesNotMatch(renderMorningHtml(report, data), /data-section="tactical"/)
  assert.match(renderMorningHtml({ ...report, tacticalWarning: '레버리지 −16%, 인버스 +15%' }, data), /data-section="tactical"/)
})
```

- [ ] **Step 2: 실패 확인** — FAIL

- [ ] **Step 3: 구현**
  - `renderMorningHtml`: spec 3.2 순서. masthead = 로고·"ETF Today"·날짜 + `renderMosaicSvg(buildMosaicTiles(data.quotes, pickFeaturedSlot(slots)?.theme ?? null), 680, 300)` + "어제 분석한 ETF 등락(Korea·USA, 레버리지·인버스 제외)". summary 세 줄. asset-cards = `buildAssetClassSlots(data.quotes)` 순서대로, 각 카드 루트 `data-asset="<key>"`: label, 대표 ETF(이름·코드·등락 — 코드 렌더, "예시" 배지), `reason`(있을 때), "갖고 있다면", "새로 본다면". 모델이 key를 빠뜨린 슬롯은 숫자만 있는 카드로. today-checks 3개. tactical(조건부). details = `<details data-section="details">` 국내·미국 ETF 표(등락·추정 거래대금 = price×volume). 참고한 뉴스·데이터 기준("전일 종가 기준, NAV·괴리율은 주문 전 장중 iNAV 확인")·법적 고지(client-notice 구조 유지, 맨 끝).
  - 쓰이지 않게 된 렌더 함수(Decision Frame, Story, Characters, 전략 지도, 매칭표, 이슈 카드, 액션 보드, 전술 보드, 국면 판단, 브리지, 히트맵, 스캐너 카드 등)는 삭제. 공용 유틸(escape, 링크, 포맷, baseHtml 등)은 유지.
  - `report-preview.ts`: 설명 = `${summary.overseas} · ${summary.focus}`(90자 이내), `og:site_name` iM뱅크 메타를 baseHtml에 추가.
  - `saveReportPreviewImage(date, { headline, holdingLabel, line, tiles })` → T1 카드. `scripts/run-etf.ts`: `const slots = buildAssetClassSlots(data.quotes); const featured = pickFeaturedSlot(slots)`; holdingLabel = `slots.find(s => s.key === report.card.key)?.holdingLabel ?? featured?.holdingLabel ?? ''`, tiles = `buildMosaicTiles(data.quotes, 그 슬롯 theme)`.

- [ ] **Step 4: 통과 확인** — `npm test`, tsc. 옛 섹션 단언 테스트 갱신 내역을 커밋에 명시.

- [ ] **Step 5: 육안 확인** — fixture 렌더 390×844 스크린샷 + 카드 PNG(커밋 안 함).

- [ ] **Step 6: 커밋** — "ETF 새 페이지 — 머리 모자이크·세 줄 요약·자산군 카드(숫자 코드 렌더)·확인 3가지·펼쳐 보기, 옛 섹션 삭제, 데이터 카드 미리보기"

---

### Task 6: 워크플로 — 병렬 생성·발송 job·dry-run 날짜·Ubuntu 고정·글꼴·감시

**Files:**
- Modify: `.github/workflows/daily-report.yml`, `.github/workflows/delivery-monitor.yml`, `.github/workflows/refresh-kr-macro.yml`, `.github/workflows/ci.yml`, `scripts/delivery-state.ts`, `scripts/check-delivery.ts`
- Test: `lib/workflow-triggers.test.ts`, `lib/workflow-shell.test.ts`, `lib/delivery-cli.test.ts`, `lib/check-delivery.test.ts` 갱신

**Interfaces (Produces):** workflow input `test_date`(string, dry_run일 때만 반영); job `market`·`etf`(병렬, outputs `changed`), job `deliver`(needs both, `if: always() && !cancelled()`, concurrency `daily-report-deliver`); `check-delivery.ts all [date]`.

- [ ] **Step 1: 실패하는 테스트**(`lib/workflow-triggers.test.ts`에 추가 — 기존 파서 헬퍼 재사용)

```ts
test('병렬 생성: market·etf job은 서로 needs 없음, only=both·schedule에서 둘 다 실행', () => {
  const wf = readWorkflow()
  assert.ok(!jobBlock(wf, 'etf').includes('needs: market'))
  assert.match(jobIf(wf, 'etf'), /schedule[\s\S]*only == 'both'|only == 'both'[\s\S]*schedule/)
  assert.match(jobIf(wf, 'market'), /only != 'etf'/)
})
test('생성 job은 텔레그램을 보내지 않고, deliver job이 market → etf 순으로 보낸다', () => {
  const wf = readWorkflow()
  assert.ok(!jobBlock(wf, 'market').includes('api.telegram.org'))
  assert.ok(!jobBlock(wf, 'etf').includes('api.telegram.org'))
  const d = jobBlock(wf, 'deliver')
  assert.match(d, /needs:\s*\[\s*market,\s*etf\s*\]/)
  assert.match(d, /always\(\) && !cancelled\(\)/)
  assert.match(d, /group: daily-report-deliver/)
  assert.ok(d.indexOf('resolve market') < d.indexOf('resolve etf'))
})
test('모든 workflow는 ubuntu-24.04 고정', () => {
  for (const f of ['daily-report.yml', 'delivery-monitor.yml', 'refresh-kr-macro.yml', 'ci.yml']) {
    const s = fs.readFileSync(`.github/workflows/${f}`, 'utf8')
    assert.ok(!s.includes('ubuntu-latest'), f); assert.match(s, /runs-on: ubuntu-24\.04/, f)
  }
})
test('dry_run일 때만 test_date를 TEST_DATE·ETF_REPORT_DATE로 전달', () => {
  const wf = readWorkflow()
  assert.match(wf, /test_date:/)
  assert.match(wf, /TEST_DATE: \$\{\{ \(inputs\.dry_run == true \|\| inputs\.dry_run == 'true'\) && inputs\.test_date \|\| '' \}\}/)
  assert.match(wf, /ETF_REPORT_DATE: \$\{\{ \(inputs\.dry_run == true \|\| inputs\.dry_run == 'true'\) && inputs\.test_date \|\| '' \}\}/)
})
test('dry_run일 때만 생성 HTML·PNG를 아티팩트로 업로드', () => {
  const wf = readWorkflow()
  for (const job of ['market', 'etf']) {
    const b = jobBlock(wf, job)
    assert.match(b, /actions\/upload-artifact@v4/, job)
    assert.match(b, /if: \$\{\{ inputs\.dry_run == true \|\| inputs\.dry_run == 'true' \}\}/, job)
  }
})
test('텔레그램 링크에 utm_source=telegram, 글꼴 단계는 Pretendard도 설치', () => {
  const wf = readWorkflow()
  assert.match(wf, /utm_source=telegram/)
  assert.match(wf, /assets\/fonts\/Pretendard/)
})
```
`readWorkflow`/`jobBlock`/`jobIf`가 없으면 기존 테스트 파일의 파서 방식으로 이 이름의 헬퍼를 추가한다. `lib/workflow-shell.test.ts`의 단계 추출은 새 job 이름(`deliver`)과 단계 이름(`resolve market`/`resolve etf`, `wait vercel`, `send market`/`send etf`)으로 갱신하고, 기존 시나리오(폴링 재시도, 자산 확인, push 재시도)를 그대로 유지. 새 시나리오: market 생성 job 실패(outputs 없음) + etf 성공 → deliver에서 etf만 send(가짜 gh·curl·npx로 실행).

`lib/check-delivery.test.ts`: `all` 인자 → market·etf 둘 다 판정, 하나라도 실패면 exit 1, 휴장일은 둘 다 통과.

- [ ] **Step 2: 실패 확인** — FAIL

- [ ] **Step 3: 구현**
  - inputs: `only` 설명을 "both = 마켓·ETF 병렬"로, `test_date`(string, 기본 '') 추가.
  - `market` job: `if: inputs.only != 'etf'`(schedule 포함), 생성·커밋·push 재시도까지만. outputs `changed: ${{ steps.changes.outputs.changed }}`. Resolve/Vercel/send 단계 제거(deliver로 이동).
  - `etf` job: `needs` 제거, `if: github.event_name == 'schedule' || inputs.only == 'both' || inputs.only == 'etf'`, 같은 범위로 축소, outputs `changed`.
  - `deliver` job: `needs: [market, etf]`, `if: always() && !cancelled()`, concurrency group `daily-report-deliver`(cancel-in-progress false), checkout main(fetch-depth 0, ref main — 두 push 이후 최신), setup-node 20·npm ci. 단계(순서 고정): `resolve market`(env CHANGED=`needs.market.outputs.changed`, DRY_RUN, FORCE_RESEND) → `wait vercel market`·`send market`(기존 market job 단계 그대로 이동, `if` 조건을 이 단계 출력으로) → `resolve etf` → `wait vercel etf`·`send etf`. REPORT_URL 끝에 `?utm_source=telegram`(재발송 cache-bust가 있으면 `&`로 결합). 기존 발송 전 자산 확인·pending/결과 기록·결과 불명 exit 1 유지.
  - `scripts/delivery-state.ts resolve`: `CHANGED=true`일 때 `git rev-parse HEAD` 대신 `findReportSha(k, date)`(deliver job의 HEAD는 두 리포트 모두를 포함하므로 종류별 리포트 커밋을 찾는다). 찾지 못하면 기존 unknown 경로.
  - 생성 job env: `TEST_DATE`(market)·`ETF_REPORT_DATE`(etf) = 위 테스트의 식. 
  - 글꼴 단계(두 job): 기존 apt fonts-noto-cjk 설치 뒤 `mkdir -p ~/.local/share/fonts && cp assets/fonts/Pretendard-*.otf ~/.local/share/fonts/ && fc-cache -f && fc-list | grep -i pretendard`.
  - 네 workflow `runs-on: ubuntu-24.04`.
  - 두 생성 job 끝에 `actions/upload-artifact@v4` 단계(`if: inputs.dry_run`): market은 `public/reports/<날짜>.html`·`-preview.png`, etf는 `public/etf-reports/<날짜>.html`·`-preview.png`(날짜 = test_date 또는 오늘 KST), 보관 3일.
  - `delivery-monitor.yml`: schedule 하나 `'45 22 * * 0-4'`(KST 07:45 월~금), kind 기본 `all`, dispatch input 옵션 `[all, market, etf]`. `check-delivery.ts`: 첫 인자 `all`이면 두 종류 판정 후 종합(요약에 둘 다 기록).

- [ ] **Step 4: 통과 확인** — `npm test`, tsc, js-yaml로 네 workflow 파싱(테스트 안에서). actionlint 있으면 실행.

- [ ] **Step 5: 커밋** — "워크플로 개편 — 마켓·ETF 병렬 생성과 단일 발송 job(market→etf), dry-run 날짜 지정, Ubuntu 24.04 고정, Pretendard 설치, 텔레그램 utm, 도착 감시 07:45 통합"

---

### Task 7: 맥미니 launchd — 06:40·07:20 both, 07:45 감시 1개

**Files:**
- Modify: `ops/macmini/dispatch.sh`(both 허용), `ops/macmini/monitor.sh`(all 허용), `ops/macmini/install.sh`
- Create: `ops/macmini/com.yalkongs.dailyreport.morning.plist`(06:40·07:20 월~금 → `dispatch.sh both`), `ops/macmini/com.yalkongs.dailyreport.monitor.plist`(07:45 월~금 → `monitor.sh all`)
- Delete: `com.yalkongs.dailyreport.market.plist`, `com.yalkongs.dailyreport.etf.plist`, `com.yalkongs.dailyreport.monitor.market.plist`, `com.yalkongs.dailyreport.monitor.etf.plist`
- Test: `lib/ops-macmini.test.ts` 갱신

- [ ] **Step 1: 실패하는 테스트**(ops-macmini.test.ts)

```ts
test('morning plist: 월~금 06:40·07:20 → dispatch.sh both', () => {
  const p = fs.readFileSync('ops/macmini/com.yalkongs.dailyreport.morning.plist', 'utf8')
  assert.match(p, /dispatch\.sh<\/string>\s*<string>both<\/string>/)
  const times = [...p.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/g)].map(m => `${m[1]}:${m[2]}`)
  assert.deepEqual([...new Set(times)].sort(), ['6:40', '7:20'])
})
test('monitor plist: 월~금 07:45 → monitor.sh all', () => {
  const p = fs.readFileSync('ops/macmini/com.yalkongs.dailyreport.monitor.plist', 'utf8')
  assert.match(p, /monitor\.sh<\/string>\s*<string>all<\/string>/)
  assert.match(p, /<integer>7<\/integer>\s*<key>Minute<\/key>\s*<integer>45<\/integer>/)
})
test('install.sh: 옛 라벨 4개를 내리고 새 라벨 2개만 설치', () => {
  const s = fs.readFileSync('ops/macmini/install.sh', 'utf8')
  for (const old of ['market', 'etf', 'monitor.market', 'monitor.etf']) assert.match(s, new RegExp(`com\\.yalkongs\\.dailyreport\\.${old.replace('.', '\\.')}\\b`))
  assert.match(s, /INSTALL_LABELS=\(com\.yalkongs\.dailyreport\.morning com\.yalkongs\.dailyreport\.monitor\)/)
})
test('dispatch.sh both·monitor.sh all 허용', () => {
  assert.match(fs.readFileSync('ops/macmini/dispatch.sh', 'utf8'), /market\|etf\|both\)/)
  assert.match(fs.readFileSync('ops/macmini/monitor.sh', 'utf8'), /market\|etf\|all\)/)
})
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 옛 plist 구조 복사해 라벨·ProgramArguments·StartCalendarInterval 변경(월~금 Weekday 1~5 × 시각). install.sh: `OLD_LABELS`(옛 4개 + 새 2개) 전부 bootout·삭제 후 `INSTALL_LABELS`만 복사·bootstrap. `bash -n`, `plutil -lint`.
- [ ] **Step 4: 통과 확인** — `npm test`.
- [ ] **Step 5: 커밋** — "맥미니 트리거 개편 — 06:40·07:20 마켓·ETF 동시 dispatch, 07:45 도착 감시 1개, 옛 라벨 정리"

---

### Task 8: Vercel Web Analytics · 운영 문서

**Files:**
- Modify: `package.json`·`package-lock.json`(`npm install @vercel/analytics` — 최신 안정판), `src/app/layout.tsx`, `README.md`(아침 트리거·도착 감시·리포트 구성·카드 절)
- AGENTS.md: `node_modules/next/dist/docs/`에서 레이아웃·스크립트 관련 문서 확인, `@vercel/analytics`의 Next(app router) 사용법(`import { Analytics } from '@vercel/analytics/next'`) 확인
- Test: `lib/analytics.test.ts`(신규, 소스 스캔)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
test('사이트 전체 레이아웃에 Web Analytics', () => {
  const s = fs.readFileSync('src/app/layout.tsx', 'utf8')
  assert.match(s, /from ['"]@vercel\/analytics\/next['"]/)
  assert.match(s, /<Analytics\s*\/>/)
  assert.ok(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies['@vercel/analytics'])
})
```
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `npm install @vercel/analytics`, 레이아웃 `<body>` 끝에 `<Analytics />`. README 갱신(06:40·07:20 both, 07:45 감시, 두 리포트 구성, 카드 규격 요약, dry-run `test_date`). 기존 사이트 푸터는 그대로.
- [ ] **Step 4: 통과 확인** — `npm test`, tsc, `npx next build`(로컬, 성공 확인 후 `.next` 정리는 불필요).
- [ ] **Step 5: 커밋** — "Vercel Web Analytics 사이트 전체 적용, README 운영 절 갱신"

---

### Task 9: 통합·dry-run·전환 (2026-10-18 일 ~ 10-19 월)

이 작업은 오케스트레이터(메인 세션)가 직접 수행한다.

- [ ] **Step 1:** `feat/morning-redesign`에 T1~T8 병합, `npm test`, `npx tsc --noEmit -p .`, `npx next build` 모두 통과.
- [ ] **Step 2: 브랜치 dry-run(운영 main 영향 없음)** — `gh workflow run 260067407 --ref feat/morning-redesign -f only=both -f dry_run=true -f force_regenerate=true -f test_date=2026-10-16`. 확인: 두 생성 job 성공, deliver job은 `dry_run` skip, 로그의 수집 성공률·지수 실측·사실 검증 줄·생성 예산·각 job 소요(06:40 시작 가정 시 07:00 전 완료). dry_run 아티팩트(Task 6에서 추가한 업로드 단계)를 `gh run download`로 받아 육안 확인.
- [ ] **Step 3: 육안 검수** — 산출 HTML(모바일 390px 스크린샷)·카드 PNG(폰 300px 축소)를 운영자에게 보여 승인.
- [ ] **Step 4: 전환(일요일 밤)** — Vercel 프로젝트 Web Analytics 활성화(대시보드), main에 `--no-ff` 병합·push, CI·Vercel success 확인, 맥미니 `git pull`(main 체크아웃 확인) 후 `ops/macmini/install.sh`, `launchctl print`로 새 라벨 2개·옛 라벨 없음 확인. cron-job.org 삭제 여부 운영자 확인.
- [ ] **Step 5: 첫 운영(월 06:40)** — 06:55 전후 두 메시지 도착, 07:45 감시 녹색, 미리보기 카드(카카오톡·텔레그램) 실물 확인, Web Analytics 수집 시작 확인.
- [ ] **Step 6: 되돌리기 준비** — 문제 시 병합 커밋 revert + 옛 plist(git 이력)로 `install.sh` 재실행 절차를 README에 한 줄로.
