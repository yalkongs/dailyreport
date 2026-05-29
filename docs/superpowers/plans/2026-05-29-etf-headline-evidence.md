# ETF 제목 재설계 (근거 토대 + tier 종속 하이브리드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF 리포트 헤드라인을 근거 tier(strong/thin/hollow)에 종속된 하이브리드로 바꾸고, 그 tier를 기존 신호 + 데이터 실패 투명성 위에서 산출한다.

**Architecture:** 신규 순수 함수 `lib/etf/etf-evidence.ts`가 뉴스·catalyst·failedSources로 tier를 산출(Layer 0). `run-etf.ts`가 failedSources를 수집해 tier 계산·전달하고, `etf/claude-client.ts` 프롬프트가 "근거 상태" 블록 + tier 종속 헤드라인 규칙으로 소비(Layer 1). `report-quality` hard validator·`pipeline-utils` 게이트는 불변. 클리셰 목록은 `lib/banned-metaphors.ts`로 단일화.

**Tech Stack:** TypeScript · tsx · `node:test`/`node:assert` (`npx tsx --test`) · Anthropic SDK(변경 없음).

**참고 spec:** `docs/superpowers/specs/2026-05-29-etf-headline-evidence-design.md`

**커밋 규약:** 한국어 서술형 + 끝에 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. 특정 파일만 stage (`git add -A` 금지 — `public/`에 미추적 테스트 파일 다수). 브랜치: `feat/etf-headline-evidence`.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `lib/etf/etf-evidence.ts` | 근거 신호 → tier 판정 (순수 함수) | 신규 |
| `lib/etf/etf-evidence.test.ts` | tier 판정 단위 테스트 | 신규 |
| `lib/banned-metaphors.ts` | 공유 클리셰 목록 (Market·ETF) | 신규 |
| `lib/claude-client.ts` | `BANNED_METAPHORS`를 공유 모듈에서 import | 수정(Market) |
| `lib/etf/types.ts` | `CollectedData`에 `failedSources?`·`etfEvidence?` | 수정 |
| `lib/etf/etf-mode.ts` | `failedSources` 인지(quiet 위장 차단) + event 문구 완화 | 수정 |
| `scripts/run-etf.ts` | failedSources 수집·evidence 계산·전달·로그 | 수정 |
| `lib/etf/claude-client.ts` | 근거 상태 블록 + tier 종속 헤드라인 단일 섹션 + 메타포 단일화 | 수정 |

**태스크 순서**: 1(evidence)→2(banned-metaphors)→3(etf-mode)→4(types+run-etf 배선)→5(프롬프트)→6(검증). 각 태스크는 단독으로 tsc 통과하도록 설계(새 param은 optional로 추가해 호출부가 깨지지 않게).

---

## Task 1: ETF 근거 tier 판정 모듈 (Layer 0)

**Files:**
- Create: `lib/etf/etf-evidence.ts`
- Test: `lib/etf/etf-evidence.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/etf/etf-evidence.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEtfEvidence } from './etf-evidence'
import type { CollectedData, NewsItem, MacroContext } from './types'

function makeData(news: NewsItem[], recentHeadlines: string[] = []): CollectedData {
  return {
    reportType: 'morning',
    date: '2026-05-29',
    quotes: [],
    flows: [],
    investorFlows: [],
    macro: {} as MacroContext,
    news,
    analysisLens: '변동성국면',
    recentHeadlines,
  }
}
function n(title: string, publishedHoursAgo: number): NewsItem {
  return { title, source: 'x', publishedAt: '', url: 'http://x', publishedHoursAgo }
}

test('strong: 고점수 catalyst + 신선', () => {
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, [])
  assert.equal(r.tier, 'strong')
  assert.equal(r.topCatalystScore, 12) // 신선도+5·기업+3·이벤트(노사·타결)+4
})

test('thin: catalyst 약함(4~6)', () => {
  const r = analyzeEtfEvidence(makeData([n('코스피 외국인 순매수 지속', 1)]), 0, [])
  assert.equal(r.tier, 'thin')
})

test('hollow: minScore 통과 catalyst 0건', () => {
  const r = analyzeEtfEvidence(makeData([n('오늘 서울 날씨 대체로 맑음', 30)]), 0, [])
  assert.equal(r.tier, 'hollow')
})

test('hollow: 뉴스 빈 배열', () => {
  const r = analyzeEtfEvidence(makeData([]), 0, [])
  assert.equal(r.tier, 'hollow')
  assert.equal(r.newsCount, 0)
})

test('hollow: news 소스 실패 (catalyst 있어도)', () => {
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, ['news'])
  assert.equal(r.tier, 'hollow')
})

test('thin: krx-nav 실패면 strong 금지', () => {
  // 강한 catalyst·신선이지만 KRX 실패로 근거 불완전 → strong 강등(thin)
  const r = analyzeEtfEvidence(makeData([n('삼성전자 노사 협상 타결', 1)]), 0, ['krx-nav'])
  assert.equal(r.tier, 'thin')
})

test('anomalyCount는 tier에 영향 없음(맥락 노출만)', () => {
  const r = analyzeEtfEvidence(makeData([n('오늘 서울 날씨 대체로 맑음', 30)]), 99, [])
  assert.equal(r.tier, 'hollow') // anomaly 99건이어도 catalyst 0이면 hollow
  assert.equal(r.anomalyCount, 99)
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/etf/etf-evidence.test.ts`
Expected: FAIL — `Cannot find module './etf-evidence'`.

- [ ] **Step 3: 모듈 구현**

`lib/etf/etf-evidence.ts`:

```ts
// lib/etf/etf-evidence.ts
//
// Layer 0 — ETF 근거 토대. 생성 시점 신호(뉴스 건수·신선도·catalyst 점수·
// failedSources)로 근거 충분성 tier 를 판정. tier 는 헤드라인 규칙(Layer 1)이
// 소비: strong=호크+앵커 subline, thin=앵커 신중, hollow=사실 모드.
// 외부 호출 없는 순수 함수. Market evidence-confidence.ts 패턴 차용.

import type { CollectedData } from './types'
import { extractTopCatalysts, type CatalystScored } from '../catalyst-extractor'

export type EtfEvidenceTier = 'strong' | 'thin' | 'hollow'

export interface EtfEvidence {
  tier: EtfEvidenceTier
  newsCount: number
  freshCount: number          // publishedHoursAgo < FRESH_HOURS
  topCatalystScore: number    // 없으면 0
  topCatalyst: CatalystScored | null
  anomalyCount: number        // 맥락 노출용 — tier 판정엔 미사용
  failedSources: string[]
  reason: string
}

// 초안 임계값 — 1주 운영 후 실측 보정 (market-mode.ts 패턴)
const FRESH_HOURS = 12
const STRONG_CATALYST = 7

export function analyzeEtfEvidence(
  data: CollectedData,
  anomalyCount: number,
  failedSources: string[] = [],
): EtfEvidence {
  const news = data.news ?? []
  const newsCount = news.length
  const freshCount = news.filter(
    n => typeof n.publishedHoursAgo === 'number' && n.publishedHoursAgo < FRESH_HOURS,
  ).length

  const recentHeadlines = data.recentHeadlines ?? []
  const catalysts = extractTopCatalysts(news, { topN: 1, recentHeadlines })
  const topCatalyst = catalysts[0] ?? null
  const topCatalystScore = topCatalyst?.score ?? 0

  const newsFailed = failedSources.includes('news')
  const krxFailed = failedSources.includes('krx-nav')
  const hollow = catalysts.length === 0 || newsFailed || newsCount === 0
  const strong =
    !hollow && topCatalystScore >= STRONG_CATALYST && freshCount >= 1 && !krxFailed
  const tier: EtfEvidenceTier = hollow ? 'hollow' : strong ? 'strong' : 'thin'

  const reason = hollow
    ? newsFailed
      ? '뉴스 소스 실패 → 사실 모드'
      : 'minScore 통과 catalyst 없음 → 사실 모드'
    : strong
      ? `강한 catalyst(점수 ${topCatalystScore}) + 신선 뉴스 ${freshCount}건`
      : `약한 근거(최상위 점수 ${topCatalystScore}, 신선 ${freshCount}건${krxFailed ? ', KRX 실패' : ''})`

  return { tier, newsCount, freshCount, topCatalystScore, topCatalyst, anomalyCount, failedSources, reason }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test lib/etf/etf-evidence.test.ts`
Expected: PASS — `pass 7  fail 0`.

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 6: 커밋**

```bash
git add lib/etf/etf-evidence.ts lib/etf/etf-evidence.test.ts
git commit -m "$(cat <<'EOF'
ETF Layer 0: 근거 tier 판정 모듈 (etf-evidence)

뉴스 건수·신선도·catalyst 점수·failedSources로 strong/thin/hollow 산출.
catalyst-extractor 재사용. KRX 실패 시 strong 금지. anomalyCount는 맥락 노출만.
단위 테스트 7종.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 공유 클리셰 목록 추출 (banned-metaphors)

**Files:**
- Create: `lib/banned-metaphors.ts`
- Modify: `lib/claude-client.ts` (Market — `BANNED_METAPHORS` 정의를 import로 교체)

- [ ] **Step 1: 공유 모듈 생성**

`lib/banned-metaphors.ts`:

```ts
// lib/banned-metaphors.ts
// 클리셰(죽은 비유) 단일 소스 — Market·ETF 공유.
// 신선한 은유는 권장하되 아래 목록의 죽은 비유만 차단한다.
export const BANNED_METAPHORS = [
  "폭풍의 눈", "폭풍전야", "양날의 검", "나비효과", "뇌관", "불씨", "신호탄",
  "혈관", "안전자산으로의 피난", "블랙스완", "퍼펙트 스톰",
  "시한폭탄", "도화선", "화약고", "판도라의 상자", "좌표를 찍",
]

// ETF 특유 클리셰 (날씨 비유 등)
export const ETF_EXTRA_BANNED = ["훈풍", "찬바람"]
```

- [ ] **Step 2: Market claude-client.ts에서 정의 → import 교체**

`lib/claude-client.ts`에서 기존 `BANNED_METAPHORS` 정의 블록(상단, `const BANNED_METAPHORS = [ ... ]` 16종)을 삭제하고, 파일 상단 import 영역에 추가:

```ts
import { BANNED_METAPHORS } from "./banned-metaphors";
```

(나머지 사용처 — `buildSystemPrompt`의 interpolation, `sanitizeBannedExpressions` — 는 그대로 `BANNED_METAPHORS`를 참조하므로 변경 불필요.)

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0 (Market 동작 불변 — 같은 목록을 import만).

- [ ] **Step 4: 커밋**

```bash
git add lib/banned-metaphors.ts lib/claude-client.ts
git commit -m "$(cat <<'EOF'
공유 클리셰 목록 추출 (banned-metaphors) — Market·ETF 단일 소스

Market claude-client.ts의 BANNED_METAPHORS를 lib/banned-metaphors.ts로 이관(동작 불변),
ETF가 동일 목록 + ETF 특유(훈풍·찬바람)를 공유하도록 준비.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: etf-mode — quiet 위장 차단 + event 문구 완화

**Files:**
- Modify: `lib/etf/etf-mode.ts`

- [ ] **Step 1: analyzeEtfMode에 failedSources optional 파라미터 추가 + quiet 가드**

`lib/etf/etf-mode.ts`의 `analyzeEtfMode` 시그니처를 변경(optional param이라 기존 2-arg 호출 유지됨):

```ts
export function analyzeEtfMode(data: CollectedData, anomalies: Anomaly[] = [], failedSources: string[] = []): EtfModeAnalysis {
```

quiet 판정 블록을 교체 — KRX 실패 시 quiet 강등 보류:

기존:
```ts
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && anomalyCount <= QUIET_THRESHOLDS.anomMax) {
```
신규:
```ts
  // KRX 실패면 낮은 anomalyCount가 데이터 누락 탓일 수 있어 quiet 강등 보류.
  if (coreAvgAbs < QUIET_THRESHOLDS.avgMax && anomalyCount <= QUIET_THRESHOLDS.anomMax && !failedSources.includes('krx-nav')) {
```

- [ ] **Step 2: event 모드 헤드라인 문구 완화**

`describeEtfModeForPrompt`의 `case "event":` 안 라인 교체:

기존:
```ts
- 헤드라인은 사건의 무게가 즉시 전달되도록 단정형 + 구체 수치 + 사건명.
```
신규:
```ts
- 헤드라인은 [제목 작성 규칙]을 따르되, 사건의 무게가 즉시 전달되도록 씁니다 (수치만 나열 지양).
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0 (run-etf의 기존 `analyzeEtfMode(data, anomalies)` 호출은 optional param 덕에 그대로 통과).

- [ ] **Step 4: 커밋**

```bash
git add lib/etf/etf-mode.ts
git commit -m "$(cat <<'EOF'
ETF etf-mode: KRX 실패의 quiet 위장 차단 + event 문구 완화

- analyzeEtfMode가 failedSources를 받아, KRX 실패 시 낮은 anomalyCount를 quiet로
  오판하지 않도록 가드(optional param, 기존 호출 호환).
- event 모드 '단정형+수치' 문구를 [제목 작성 규칙] 위임형으로 완화(tier 하이브리드와 충돌 방지).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: types + run-etf 배선 (failedSources 수집 · evidence 계산)

**Files:**
- Modify: `lib/etf/types.ts` (`CollectedData`)
- Modify: `scripts/run-etf.ts`

- [ ] **Step 1: CollectedData에 필드 추가**

`lib/etf/types.ts`의 `CollectedData` 인터페이스 끝(`etfMode?` 다음)에 추가:

```ts
  // Layer 0 (2026-05-29): 수집 실패 소스 목록 (프롬프트 노출·tier 반영용).
  failedSources?: string[]
  // Layer 0 (2026-05-29): 근거 충분성 tier (헤드라인 규칙이 소비).
  etfEvidence?: import('./etf-evidence').EtfEvidence
```

- [ ] **Step 2: run-etf.ts — import 추가**

`scripts/run-etf.ts` 상단 import에 추가:

```ts
import { analyzeEtfEvidence } from '../lib/etf/etf-evidence'
```

- [ ] **Step 3: run-etf.ts — failedSources 수집**

`const { quotes, flows, investorFlows } = ...` 블록(약 100-101행) 바로 다음에 삽입:

```ts
  // Layer 0: 수집 실패 소스 기록 (allSettled rejection + KRX nav 전량 null)
  const failedSources: string[] = []
  if (etfData.status === 'rejected') failedSources.push('etf-quotes')
  if (macro.status === 'rejected') failedSources.push('macro')
  if (news.status === 'rejected') failedSources.push('news')
  const krQuotes = quotes.filter(q => q.market === 'KR')
  if (krQuotes.length > 0 && krQuotes.every(q => q.nav === null)) failedSources.push('krx-nav')
```

- [ ] **Step 4: run-etf.ts — CollectedData에 failedSources 추가 + evidence 계산**

`data` 객체 리터럴(약 134-147행)에서 `etfMode: undefined,` 앞에 추가:

```ts
    failedSources,
```

그리고 `data.etfMode = analyzeEtfMode(data, anomalies)` 라인을 교체:

기존:
```ts
  data.etfMode = analyzeEtfMode(data, anomalies)
  console.log(`[4a/8] ETF 모드: ${data.etfMode.mode} — ${data.etfMode.reason}`)
```
신규:
```ts
  data.etfMode = analyzeEtfMode(data, anomalies, failedSources)
  data.etfEvidence = analyzeEtfEvidence(data, anomalies.length, failedSources)
  console.log(`[4a/8] ETF 모드: ${data.etfMode.mode} — ${data.etfMode.reason}`)
  console.log(`[4b/8] 근거 tier: ${data.etfEvidence.tier} — ${data.etfEvidence.reason}`)
```

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: 커밋**

```bash
git add lib/etf/types.ts scripts/run-etf.ts
git commit -m "$(cat <<'EOF'
ETF Layer 0 배선: failedSources 수집 + 근거 tier 계산·전달

run-etf가 allSettled 실패·KRX nav 전량 null을 failedSources로 기록하고,
analyzeEtfEvidence로 tier 산출해 CollectedData에 전달(+로그). etf-mode에도 failedSources 전달.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ETF 프롬프트 — 근거 상태 블록 + tier 종속 헤드라인 단일 섹션 + 메타포 단일화

**Files:**
- Modify: `lib/etf/claude-client.ts`

- [ ] **Step 1: 공유 클리셰 import + 시스템 프롬프트 메타포 governance 교체**

`lib/etf/claude-client.ts` 상단 import에 추가:
```ts
import { BANNED_METAPHORS, ETF_EXTRA_BANNED } from '../banned-metaphors'
```

`SYSTEM_PROMPT`(const template literal)에서 다음 두 줄을 찾아:
```
- AI 가 자주 쓰는 뻔한 비유: "폭풍전야", "훈풍", "찬바람", "양날의 검", "나비효과", "신호탄", "뇌관"
```
및 (별도 줄):
```
(주: "관문/장면/불씨/온도/속도전/붙으면/풀리면/받아내다" 같은 표현은 데이터를 명확히 만드는 한 사용을 허용합니다.)
```
첫 줄을 아래로 교체하고, 둘째(허용목록) 줄은 **삭제**:
```
- 신선하고 구체적인 은유·관점은 권장하되, **죽은 클리셰**는 금지: ${[...BANNED_METAPHORS, ...ETF_EXTRA_BANNED].map(m => `"${m}"`).join(', ')} 등. "아무 날에나 붙일 수 있는 비유"는 쓰지 마십시오.
```

- [ ] **Step 2: 근거 상태 블록 빌더 추가 + 프롬프트에 삽입**

`buildMorningPrompt` 안에서 `weekdayBlock` 계산부 근처에 추가:

```ts
  // Layer 0 (2026-05-29): 근거 상태 블록 — tier 종속 헤드라인의 입력.
  const ev = data.etfEvidence
  const evidenceBlock = ev
    ? `\n[오늘의 근거 상태 — tier: ${ev.tier}]
- 뉴스 ${ev.newsCount}건 (신선 ${ev.freshCount}건)
- 최상위 catalyst: ${ev.topCatalyst ? `[점수 ${ev.topCatalystScore}] ${ev.topCatalyst.title}` : '없음 — 강한 catalyst 부재'}
- 실패한 데이터 소스: ${ev.failedSources.length > 0 ? ev.failedSources.join(', ') : '없음'}
이 근거 상태가 아래 [cover.headline 작성 규칙]의 tier 동작을 결정합니다.\n`
    : ''
```

그리고 반환 템플릿의 첫 줄 구성에서 `${weekdayBlock}` 다음에 `${evidenceBlock}`를 끼워 넣는다(분석 렌즈/앵글/모드 블록과 함께 상단에 보이도록).

- [ ] **Step 3: anchor-history 블록 제거 (헤드라인 규칙으로 흡수)**

`anchorHistoryBlock` IIFE(약 170-201행, `// Phase E2 ...`부터 블록 끝까지)를 통째로 삭제하고, 반환 템플릿에서 `${anchorHistoryBlock}` 참조도 삭제. (반복 회피 로직은 Step 5의 새 헤드라인 규칙 [반복 회피]로 이관.)

- [ ] **Step 4: catalyst 블록의 헤드라인 지시 완화**

catalyst 주입 IIFE(약 296-310행) 마지막 문장을 교체:

기존:
```
`bigPicture·overnightBrief.krImpact 등 본문에서 우선 반영하고, 헤드라인에도 가능하면 사건명 포함.\n`
```
신규:
```
`bigPicture·overnightBrief.krImpact 등 본문에 우선 반영. 헤드라인 반영 여부·방식은 아래 [cover.headline 작성 규칙]을 따르십시오.\n`
```

- [ ] **Step 5: cover.headline 규칙을 tier 종속 단일 섹션으로 교체**

기존 `[cover.headline 작성 규칙 — ...]` 섹션 전체(약 344-409행, "체크리스트/할 일 느낌..." 줄까지 + 그 뒤 "위 '최근 헤드라인' 블록에 있는..." 줄)를 아래로 교체:

```
[cover.headline 작성 규칙 — tier 종속 (위 [오늘의 근거 상태] 참조)]

이 헤드라인은 06:30 KST 한국 개인투자자가 가장 먼저 만나는 한 줄입니다. 위 tier 에 따라 형태가 달라집니다.

- **strong** (강한 catalyst + 신선 뉴스): 제목은 독자가 읽고 싶게 만드는 **호크 한 줄**. 수치·티커 anchor 는 **subline 으로 내립니다**. 오늘의 지배적 서사(서사 앵글 + 최상위 catalyst)에서 길어올린 **신선한 은유·관점**을 허용합니다.
- **thin** (약한 근거): 앵커(수치·티커)를 앞세우되 신중하게. 가격·구조 서사 비중을 높이고 단정은 자제. 은유는 절제합니다.
- **hollow** (catalyst 없음·뉴스 실패): **사실 모드.** 은유를 만들지 마십시오. 횡보·다음 영업일 미리보기 같은 절제된 사실로 씁니다. catalyst 의무는 적용하지 않습니다.

공통 규칙:
- **catalyst 반영 (기본 + 예외)**: strong·thin 에서 [🔥 오늘의 forward catalyst] 항목이 있으면 사건을 근거로 반영하되, **[반복 회피 — 기본보다 우선]** 같은 catalyst·anchor 가 위 [최근 ETF 리포트 헤드라인]에 이미 등장했으면 (a) 사건의 국면·단계를 다르게(진전→타결→후속/확산/정착) 또는 (b) anchor 를 부제로 내리고 새 각도(secondary anchor: 환율·GDX·SLV·USO·국내 ETF 등 오늘 의미 있게 움직인 지표)로. 같은 "사건명+가격%" template 반복 금지.
- **시장 특정**: "지수/시장/증시" 단독 표기 금지(앞 절 anchor 가 시장을 특정). 뒤 절에서 "시장"을 쓰면 수식어(미·국내·채권 등)를 붙입니다.
- 길이: 압축 지향(14~26자 권장). 은유가 살아 있으면 약간 넘어도 됩니다.
- 체크리스트·할 일 느낌(어미 "확인", "점검", "~해야")은 금지.
- **본문 payoff**: narrativeNotes.bigPicture 첫 부분이 헤드라인의 이미지를 받아 전개해야 합니다.
- 위 [최근 ETF 리포트 헤드라인] 블록의 문장 구조·핵심 단어 조합을 재사용하지 마십시오.
```

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0. (`anchorHistoryBlock` 삭제로 미사용 변수가 남지 않게 반환 템플릿 참조도 지웠는지 확인.)

- [ ] **Step 7: 커밋**

```bash
git add lib/etf/claude-client.ts
git commit -m "$(cat <<'EOF'
ETF Layer 1: tier 종속 헤드라인 단일 섹션 + 근거 상태 블록 + 메타포 단일화

- 근거 상태 블록(tier·뉴스·catalyst·실패소스) 프롬프트 표면화
- cover.headline 규칙을 tier 종속(strong=호크+앵커 subline / thin=앵커 신중 / hollow=사실)
  단일 섹션으로 재작성. F3/E2를 기본+예외로 통합, anchor-history 블록 흡수.
- 메타포 governance를 공유 BANNED_METAPHORS로 단일화, 모순된 허용목록 제거.
- 본문 payoff 의무화. event 모드/catalyst 블록의 헤드라인 지시는 이 규칙에 위임.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 통합 검증 (백필 + 프리뷰)

**Files:** (코드 변경 없음 — 실행 검증)

> ⚠️ 실제 Anthropic API 호출 + `public/etf-reports/<date>.*`·`data/` 인덱스 덮어씀. 검증 후 생성물은 커밋하지 말 것(`git checkout -- public/etf-reports data` 로 되돌림). Telegram 발송은 로컬 실행에서 일어나지 않음(run-etf.ts:224-228). API 키는 `.env.local` 로드 필요: `npx tsx --env-file=.env.local`.

- [ ] **Step 1: hollow 모드 검증**

뉴스 수집을 막아 hollow를 유도하기 어렵다면, 정상 실행 로그에서 tier를 먼저 확인한다(아래 Step 2). hollow는 단위 테스트(Task 1)로 이미 보장됨. 추가로 뉴스가 비는 날 자연 검증.

- [ ] **Step 2: 정상 실행 + tier·헤드라인 확인**

Run:
```bash
git checkout -- data/last-data-hash.txt 2>/dev/null; FORCE_REGENERATE=true npx tsx --env-file=.env.local scripts/run-etf.ts 2>&1 | grep -E "근거 tier|ETF 모드|헤드라인|근거 상태"
```
Expected: `[4b/8] 근거 tier: strong|thin|hollow ...` 로그 출력. 생성된 헤드라인이 tier에 맞는 형태인지 확인:
```bash
grep -oE 'cover-headline[^>]*>[^<]+|cover-subline[^>]*>[^<]+' public/etf-reports/$(date +%F).html | head -2
```
strong이면 호크형(수치는 subline), hollow면 사실형.

- [ ] **Step 3: 프리뷰 PNG 줄바꿈 확인**

```bash
ls -t public/etf-reports/*.png | head -1
```
열어서 헤드라인 잘림 없는지 확인. 잘리면 길이 권고 조정을 후속 이슈로 기록.

- [ ] **Step 4: report-quality 통과 확인**

Step 2 실행이 예외 없이 완료되면 `report-quality`(지수/시장 차단·투자권유·중복 등)를 통과한 것. 실패 시 로그의 `[report-quality]` 위반 메시지 확인.

- [ ] **Step 5: 검증 산출물 되돌리기**

```bash
git checkout -- public/etf-reports data 2>/dev/null; git status --short | grep -vE "etf-reports/2026-04|2026-05-21-newsfix"
```
Expected: Task 1~5 커밋 외 작업트리 깨끗.

---

## Self-Review (작성자 체크리스트 결과)

**Spec coverage:** Layer 0 모듈(Task 1)·failedSources 배선(Task 4)·근거 상태 블록(Task 5)·tier 종속 헤드라인(Task 5)·F3/E2 통합(Task 5)·메타포 단일화(Task 2·5)·KRX quiet 위장 차단(Task 3)·event 문구 완화(Task 3)·본문 payoff(Task 5) — 모두 매핑됨. report-quality·게이트 불변(코드 변경 없음, Task 6에서 통과 확인). 검증(Task 6).

**미커버(의도적 deferral, spec §3·§8):** report-language↔report-quality 도달불가 패턴·consecutiveSell stub — 범위 밖. 임계값·공유목록 최종화 — 운영 보정. 불씨 등 ETF 메타포 경계 — 공유목록 기준(필요 시 1줄 조정).

**Type consistency:** `EtfEvidence`/`EtfEvidenceTier`/`analyzeEtfEvidence(data, anomalyCount, failedSources)` 가 Task 1 정의 ↔ Task 4 사용 일치. `CollectedData.failedSources?`/`etfEvidence?`(Task 4 타입) ↔ Task 5 프롬프트 사용 일치. `analyzeEtfMode(data, anomalies, failedSources)` optional param(Task 3) ↔ Task 4 호출 일치. `BANNED_METAPHORS`/`ETF_EXTRA_BANNED`(Task 2) ↔ Task 5 import 일치. `extractTopCatalysts(news, {topN, recentHeadlines})` 기존 시그니처와 일치(`NewsItem`은 `CatalystInput`에 구조적 할당 가능).
