# Market 제목 재설계 (근거 토대 + 은유 제목) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market 리포트 제목을 "근거에 비례한 신선한 은유"로 바꾸되, 그 근거(뉴스/catalyst)의 충분성을 코드가 판정·표면화해 빈약하면 자동으로 사실 모드로 강등한다.

**Architecture:** 신규 순수 함수 `lib/evidence-confidence.ts` 가 기존 신호(뉴스 건수·신선도·catalyst 점수·`contextErrors`)만으로 `strong/thin/hollow` tier 를 산출한다(Layer 0). `scripts/run.ts` 가 이를 계산해 `AntiRepetitionContext.evidence` 로 전달하고, `lib/claude-client.ts` 프롬프트가 "오늘의 근거 상태" 블록 + tier 종속 제목 규칙으로 소비한다(Layer 1). 새 데이터 소스·재생성 게이트는 없다.

**Tech Stack:** TypeScript 5 · tsx · `node:test`/`node:assert` (테스트 러너는 `npx tsx --test`) · Anthropic SDK (변경 없음).

**참고 spec:** `docs/superpowers/specs/2026-05-29-market-headline-evidence-design.md`

**커밋 규약:** 각 커밋 메시지는 한국어 서술형(레포 관행) + 끝에 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` 트레일러. 특정 파일만 stage (절대 `git add -A` 금지 — `public/` 에 미추적 테스트 파일 다수 존재).

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `lib/evidence-confidence.ts` | 근거 신호 → tier 판정 (순수 함수) | 신규 |
| `lib/evidence-confidence.test.ts` | tier 판정 단위 테스트 | 신규 |
| `lib/types.ts` | `ReportContent.cover.imageKeywords?` 추가 | 수정 |
| `lib/claude-client.ts` | `AntiRepetitionContext.evidence`, 근거 상태 블록, `## 제목 작성 규칙` 단일 섹션, 시스템 프롬프트 클리셰 문구, schema `imageKeywords` | 수정 |
| `scripts/run.ts` | evidence 계산·로그·ctx 전달, `metaphors` 저장 부활 | 수정 |
| `lib/market-mode.ts` | event 모드 "단정형" 문구 완화 | 수정 |

---

## Task 1: 근거 confidence 판정 모듈 (Layer 0 핵심)

**Files:**
- Create: `lib/evidence-confidence.ts`
- Test: `lib/evidence-confidence.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/evidence-confidence.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEvidenceConfidence } from "./evidence-confidence";
import type { ContextData, NewsHeadline } from "./types";

function ctx(news: NewsHeadline[], failedSources: string[] = []): ContextData {
  return {
    news,
    economicCalendar: [],
    fredIndicators: [],
    sentiment: {},
    investorFlow: null,
    koreanBonds: [],
    historicalComparison: [],
    contextErrors: failedSources.map((source) => ({ source, status: "error", message: "x" })),
  };
}

const strongNews: NewsHeadline = {
  title: "삼성전자 노사 협상 타결",   // 기업+3, 이벤트(노사·타결)+4, 신선도+5 = 12
  source: "Google News 대형주",
  category: "korea",
  publishedHoursAgo: 1,
};
const weakFreshNews: NewsHeadline = {
  title: "코스피 외국인 순매수 지속",   // 신선도+5, 기업/이벤트 없음 = 5 (>=4, <7)
  source: "Google News 수급",
  category: "korea",
  publishedHoursAgo: 1,
};
const noiseNews: NewsHeadline = {
  title: "오늘 서울 날씨 대체로 맑음",   // 점수 0 < minScore 4 → catalyst 0건
  source: "etc",
  category: "global",
  publishedHoursAgo: 30,
};

test("strong: 고점수 catalyst + 신선", () => {
  const r = analyzeEvidenceConfidence(ctx([strongNews]));
  assert.equal(r.tier, "strong");
  assert.ok(r.topCatalystScore >= 7);
  assert.equal(r.freshCount, 1);
});

test("thin: catalyst 있으나 약함(4~6)", () => {
  const r = analyzeEvidenceConfidence(ctx([weakFreshNews]));
  assert.equal(r.tier, "thin");
});

test("hollow: minScore 통과 catalyst 0건", () => {
  const r = analyzeEvidenceConfidence(ctx([noiseNews]));
  assert.equal(r.tier, "hollow");
});

test("hollow: 뉴스 빈 배열", () => {
  const r = analyzeEvidenceConfidence(ctx([]));
  assert.equal(r.tier, "hollow");
  assert.equal(r.newsCount, 0);
});

test("hollow: news 소스 실패 (catalyst 있어도)", () => {
  const r = analyzeEvidenceConfidence(ctx([strongNews], ["news"]));
  assert.equal(r.tier, "hollow");
  assert.deepEqual(r.failedSources, ["news"]);
});

test("context null → hollow", () => {
  const r = analyzeEvidenceConfidence(null);
  assert.equal(r.tier, "hollow");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/evidence-confidence.test.ts`
Expected: FAIL — `Cannot find module './evidence-confidence'` (또는 export 없음).

- [ ] **Step 3: 모듈 구현**

`lib/evidence-confidence.ts`:

```ts
// lib/evidence-confidence.ts
//
// Layer 0 — 근거 토대. 생성 시점에 이미 수집된 신호(뉴스 건수·신선도·
// catalyst 점수·contextErrors)만으로 근거 충분성 tier 를 판정한다.
// 외부 호출 없는 순수 함수. 새 데이터 소스 없음.
//
// tier 는 제목 규칙(Layer 1)이 소비한다: strong=은유 전면, thin=은유 신중,
// hollow=사실 모드(은유 만들지 말 것).

import type { ContextData, NewsHeadline } from "./types";
import { extractTopCatalysts, type CatalystScored } from "./catalyst-extractor";

export type EvidenceTier = "strong" | "thin" | "hollow";

export interface EvidenceConfidence {
  tier: EvidenceTier;
  newsCount: number;
  freshCount: number;          // publishedHoursAgo < FRESH_HOURS 인 건수
  topCatalystScore: number;    // 최상위 catalyst 점수 (없으면 0)
  topCatalyst: CatalystScored | null;
  failedSources: string[];     // contextErrors 의 source 목록
  reason: string;              // 사람이 읽는 판정 근거 (로그·프롬프트용)
}

// 초안 임계값 — 1주 운영 후 실측 분포로 보정 (market-mode.ts 패턴).
const FRESH_HOURS = 12;
const STRONG_CATALYST = 7;

export function analyzeEvidenceConfidence(
  context: ContextData | null,
  recentHeadlines: string[] = [],
): EvidenceConfidence {
  const news: NewsHeadline[] = context?.news ?? [];
  const failedSources = (context?.contextErrors ?? []).map((e) => e.source);
  const newsCount = news.length;
  const freshCount = news.filter(
    (n) => typeof n.publishedHoursAgo === "number" && n.publishedHoursAgo < FRESH_HOURS,
  ).length;

  // extractTopCatalysts 가 minScore=4 미만을 이미 걸러냄.
  // 결과가 0건이면 곧 "강한 forward catalyst 부재".
  const catalysts = extractTopCatalysts(news, { topN: 1, recentHeadlines });
  const topCatalyst = catalysts[0] ?? null;
  const topCatalystScore = topCatalyst?.score ?? 0;

  const newsFailed = failedSources.includes("news");
  const hollow = catalysts.length === 0 || newsFailed;
  const strong = !hollow && topCatalystScore >= STRONG_CATALYST && freshCount >= 1;
  const tier: EvidenceTier = hollow ? "hollow" : strong ? "strong" : "thin";

  const reason = hollow
    ? newsFailed
      ? "뉴스 소스 수집 실패 → 사실 모드"
      : "minScore 통과 catalyst 없음 → 사실 모드"
    : strong
      ? `강한 catalyst(점수 ${topCatalystScore}) + 신선 뉴스 ${freshCount}건`
      : `약한 근거(최상위 점수 ${topCatalystScore}, 신선 ${freshCount}건)`;

  return { tier, newsCount, freshCount, topCatalystScore, topCatalyst, failedSources, reason };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test lib/evidence-confidence.test.ts`
Expected: PASS — `pass 6  fail 0`.

- [ ] **Step 5: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 6: 커밋**

```bash
git add lib/evidence-confidence.ts lib/evidence-confidence.test.ts
git commit -m "$(cat <<'EOF'
Layer 0: 근거 confidence 판정 모듈 추가 (evidence-confidence)

기존 신호(뉴스 건수·신선도·catalyst 점수·contextErrors)만으로 strong/thin/hollow
tier 산출. 새 데이터 소스 없음. 단위 테스트 6종 포함.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: evidence 를 파이프라인에 배선

**Files:**
- Modify: `lib/claude-client.ts` (AntiRepetitionContext 인터페이스, 상단 import 영역)
- Modify: `scripts/run.ts` (Step 3 부근)

- [ ] **Step 1: AntiRepetitionContext 에 evidence 필드 추가**

`lib/claude-client.ts` 의 `AntiRepetitionContext` 인터페이스(파일 상단)에 추가:

```ts
  // Layer 0 (2026-05-29): 근거 충분성 tier. 비어있으면 hollow 로 간주(보수적).
  evidence?: import("./evidence-confidence").EvidenceConfidence;
```

- [ ] **Step 2: run.ts 에서 evidence 계산 + ctx 전달**

`scripts/run.ts` 상단 import 에 추가:

```ts
import { analyzeEvidenceConfidence } from "../lib/evidence-confidence";
```

`scripts/run.ts` Step 3 에서 `marketMode` 계산 직후(약 247행), `ctx` 객체 생성 전에 삽입:

```ts
  // Layer 0: 근거 충분성 판정 (제목 은유의 토대)
  const recentHeadlines = recentLog.map((e) => e.headline).filter(Boolean);
  const evidence = analyzeEvidenceConfidence(contextData, recentHeadlines);
  console.log(`🧭 근거 tier: ${evidence.tier} — ${evidence.reason}`);
```

그리고 `ctx` 객체(약 252행)에 `evidence` 추가:

```ts
  const ctx: AntiRepetitionContext = {
    angle,
    recentLog,
    sideways,
    deepDiveTopic,
    marketMode,
    calendarInfo,
    evidence,
  };
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 4: 커밋**

```bash
git add lib/claude-client.ts scripts/run.ts
git commit -m "$(cat <<'EOF'
Layer 0 배선: run.ts 가 근거 tier 계산해 프롬프트 컨텍스트로 전달

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: "오늘의 근거 상태" 블록을 프롬프트에 표면화

**Files:**
- Modify: `lib/claude-client.ts` (`buildReportPrompt` 내부, 블록 조립부)

- [ ] **Step 1: 근거 상태 블록 생성 함수 추가**

`lib/claude-client.ts` 에 `buildSidewaysBlock` 옆(파일 중단부)에 추가:

```ts
function buildEvidenceBlock(ctx: AntiRepetitionContext): string {
  const ev = ctx.evidence;
  if (!ev) return "";
  const cat = ev.topCatalyst
    ? `[점수 ${ev.topCatalystScore}] ${ev.topCatalyst.title}`
    : "없음 — 강한 forward catalyst 부재";
  const failed = ev.failedSources.length > 0 ? ev.failedSources.join(", ") : "없음";
  return `\n## 오늘의 근거 상태 (tier: ${ev.tier})
- 뉴스: ${ev.newsCount}건 (신선 ${ev.freshCount}건)
- 최상위 catalyst: ${cat}
- 실패한 데이터 소스: ${failed}

이 근거 상태는 아래 [제목 작성 규칙]의 tier 종속 동작을 결정합니다.
`;
}
```

- [ ] **Step 2: buildReportPrompt 에서 블록 삽입**

`buildReportPrompt` 내에서 `contextBlock` 계산부 근처에 추가:

```ts
  const evidenceBlock = buildEvidenceBlock(ctx);
```

그리고 반환 템플릿에서 `${contextBlock}` 바로 앞에 `${evidenceBlock}` 를 끼워 넣는다 (`## 시장 데이터` 위, 근거 컨텍스트와 함께 보이도록).

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 4: 커밋**

```bash
git add lib/claude-client.ts
git commit -m "$(cat <<'EOF'
Layer 0 표면화: 프롬프트에 '오늘의 근거 상태' 블록 추가 (tier·뉴스·catalyst·실패소스)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 제목 작성 규칙 단일 섹션 + 시스템 프롬프트 클리셰 전환 (Layer 1)

**Files:**
- Modify: `lib/claude-client.ts` (`buildSystemPrompt` 비유 문구, `buildReportPrompt` 의 `cover.headline` 스키마 주석 + `## 제목 작성 규칙` 신설, `bigStory 작성 규칙` 에 payoff 추가)

- [ ] **Step 1: 시스템 프롬프트 — "은유 금지"를 "클리셰 금지·신선한 은유 권장"으로 전환**

`buildSystemPrompt` 의 비유 줄을 아래로 교체:

기존:
```
- ❌ AI가 쓴 티가 나는 뻔한 비유 금지: ${BANNED_METAPHORS.map((m) => `"${m}"`).join(", ")} 등
```
신규:
```
- ✅ 신선하고 구체적인 은유·관점은 권장합니다 (제목·본문 모두). 단 **죽은 클리셰**는 금지: ${BANNED_METAPHORS.map((m) => `"${m}"`).join(", ")} 등. "아무 날에나 붙일 수 있는 비유"라면 쓰지 마십시오 — 오늘의 데이터에서 길어올린 은유만 허용.
```

- [ ] **Step 2: cover.headline / subline 스키마 주석 축약**

`buildReportPrompt` 의 JSON 스키마에서 현재 `cover.headline` 의 긴 주석(2단 구조)을 아래 한 줄 포인터로 교체:

```
    "headline": string,   // 오늘 본문을 관통하는 호기심 유발 한 줄. 작성 규칙은 아래 [제목 작성 규칙] 참조.
    "subline": string,    // 헤드라인 보충 1~2문장. 제목에서 뺀 구체 사건명·핵심 수치를 여기서 받침.
    "imageKeywords": string[],  // 제목/본문에서 사용한 핵심 이미지·은유 단어 1~3개. 사실 모드(은유 없음)면 빈 배열 []. (반복 회피 로그용)
```

- [ ] **Step 3: `## 제목 작성 규칙` 섹션 신설**

`buildReportPrompt` 반환 템플릿에서 `### soWhat 작성 규칙` 뒤(또는 스키마 규칙 모음 끝)에 추가:

```
### 제목 작성 규칙

제목(headline)의 본질은 **독자가 읽고 싶게 만드는 호기심의 방아쇠**입니다. 배달 시점(미 마감 직후·한국 개장 전)에 한국 투자자가 관심 가질 토픽을, 그날 본문의 중심 긴장을 압축해 한 줄로 표현하십시오. 정보 요약이 아닙니다.

- **신선한 은유·관점을 적극 허용합니다.** 단 그 은유는 오늘의 지배적 서사(위 [오늘의 관점] 앵글 + 최상위 catalyst)에서 길어올린 것이어야 합니다. 아무 날에나 붙일 수 있는 은유면 실패입니다.
- **클리셰는 금지**합니다(시스템 규칙의 금지 비유 목록).
- **수치 앵커**(코스피 +X%, 환율 N원 등)는 기본적으로 **부제(subline)** 가 받칩니다. 단 그 숫자 자체가 오늘의 후크(예: 코스피 3000 돌파, 환율 1,500 같은 심리적 분기점)라면 제목에 남길지 직접 판단하십시오.
- 길이는 압축 지향(대략 15~25자 권장). 은유가 살아있으면 약간 넘어도 됩니다 — 경직되지 마십시오.
- **본문 연결**: bigStory 의 첫 문단 또는 pullQuote 하나가 제목의 이미지를 명시적으로 받아 전개해야 합니다. 제목이 던진 은유를 본문이 갚으십시오.
- **반복 회피**: 같은 catalyst·이미지가 최근 3일 헤드라인에 등장했다면 (a) 사건의 국면·단계를 다르게 표현하거나 (b) catalyst를 부제로 내리고 제목은 새 각도로.

**근거 상태(tier)에 따른 동작 — 위 [오늘의 근거 상태] 참조:**
- **strong**: 은유가 전면. 최상위 catalyst 에 단단히 근거한 이미지로.
- **thin**: 은유 허용하되 신중. 가격·구조 서사 비중을 높이고 단정을 자제("~로 알려졌다" 수준).
- **hollow**: **사실 모드.** 은유를 만들지 마십시오. 절제된 사실 프레이밍(예: "조용한 N일, 다음 변수는 X")을 쓰고, imageKeywords 는 빈 배열로 두십시오.
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 5: 프롬프트 육안 확인 (선택)**

Run:
```bash
npx tsx -e "import('./lib/claude-client.ts')" 2>&1 | head -3 || true
```
(주: 실제 프롬프트 문자열은 Task 7 백필 로그에서 검증. 이 단계는 import 깨짐만 확인.)

- [ ] **Step 6: 커밋**

```bash
git add lib/claude-client.ts
git commit -m "$(cat <<'EOF'
Layer 1: 제목 규칙 단일 섹션화 — 은유 허용·클리셰 금지·앵커 부제·본문 payoff

- 시스템 프롬프트 '은유 금지' → '클리셰 금지·신선한 은유 권장'
- 흩어진 cover.headline 주석을 [제목 작성 규칙] 단일 섹션으로 이관
- tier(strong/thin/hollow) 종속 동작 명시 — hollow=사실 모드
- imageKeywords 보조 필드 추가 (반복 회피 로그용)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: event 모드 "단정형" 문구 완화

**Files:**
- Modify: `lib/market-mode.ts` (`describeModeForPrompt` event 분기, 약 140행)

- [ ] **Step 1: event 헤드라인 문구 교체**

기존:
```
- 헤드라인은 사건의 무게가 즉시 전달되도록 단정형 + 구체 수치로 씁니다.
```
신규:
```
- 헤드라인은 사건의 무게가 즉시 전달되도록 씁니다. 구체 수치를 살리되, [제목 작성 규칙]에 따라 신선한 은유·관점과 병행할 수 있습니다 (수치만 나열한 제목은 지양).
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 3: 커밋**

```bash
git add lib/market-mode.ts
git commit -m "$(cat <<'EOF'
event 모드 헤드라인 문구 완화 — '단정형' 강제가 은유 규칙과 충돌하지 않도록

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 은유 반복 회피 로그 부활 (metaphors)

**Files:**
- Modify: `lib/types.ts` (`ReportContent.cover`, 약 230행)
- Modify: `scripts/run.ts` (narrativeEntry 조립부, 약 322-330행)

- [ ] **Step 1: ReportContent.cover 에 imageKeywords 추가**

`lib/types.ts` 의 `ReportContent.cover` 를 교체:

```ts
  cover: {
    headline: string;
    subline: string;
    imageKeywords?: string[]; // 제목/본문 핵심 이미지·은유 단어 (반복 회피 로그용). 사실 모드면 빈 배열.
  };
```

- [ ] **Step 2: run.ts 에서 metaphors 저장**

`scripts/run.ts` 의 `narrativeEntry` 조립부에서:

기존:
```ts
      metaphors: [], // JSON 모드에서는 별도 추출 불필요
```
신규:
```ts
      metaphors: reportContent.cover.imageKeywords ?? [],
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음(exit 0).

- [ ] **Step 4: 커밋**

```bash
git add lib/types.ts scripts/run.ts
git commit -m "$(cat <<'EOF'
은유 반복 회피 로그 부활 — Claude imageKeywords 를 narrative 로그 metaphors 에 저장

제목을 은유 중심으로 바꾸면서 같은 이미지 반복 위험이 커지므로,
죽어 있던 metaphors:[] 를 복원해 buildAntiRepetitionBlock 의 반복 금지에 다시 연결.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 통합 검증 (백필 + 프리뷰)

**Files:** (코드 변경 없음 — 실행 검증)

> ⚠️ 주의: 이 단계는 실제 API 를 호출하고 `public/reports/<date>.html` 와 `data/` 인덱스를 덮어쓴다. 검증 후 생성물은 **커밋하지 말 것**(원하면 `git checkout -- public/reports data` 로 되돌림). Telegram 발송은 로컬 실행이라 일어나지 않음.

- [ ] **Step 1: hollow 모드 검증 (컨텍스트 차단)**

Run:
```bash
DISABLE_CONTEXT=true FORCE_REGENERATE=true npx tsx scripts/run.ts 2>&1 | grep -E "근거 tier|헤드라인"
```
Expected: `🧭 근거 tier: hollow — ...` 출력 + 생성된 헤드라인이 은유 없는 **사실형**(예: "조용한 N일…" 류). imageKeywords 빈 배열이어야 하므로 다음 날 로그에 비유 미기록.

- [ ] **Step 2: strong/thin 모드 검증 (정상 실행)**

Run:
```bash
FORCE_REGENERATE=true npx tsx scripts/run.ts 2>&1 | grep -E "근거 tier|헤드라인|근거 상태"
```
Expected: `🧭 근거 tier: strong` 또는 `thin`. 헤드라인이 **은유/관점 중심**, 구체 수치는 subline 으로 이동했는지 생성 파일에서 육안 확인:
```bash
grep -E "cover-headline|cover-subline" public/reports/$(date +%F).html
```

- [ ] **Step 3: 프리뷰 PNG 줄바꿈 확인 (부작용 #4)**

Step 2 가 생성한 프리뷰 PNG 를 연다:
```bash
ls -t public/reports/*.png | head -1
```
열어서 제목이 4줄을 넘겨 잘리지 않는지 확인 (`preview-card.ts` wrapText 15자×4줄). 잘리면 제목 길이 권고를 줄이거나 `wrapText` 한도 조정을 후속 이슈로 기록.

- [ ] **Step 4: 검증 산출물 되돌리기**

Run:
```bash
git checkout -- public/reports data 2>/dev/null; git status --short
```
Expected: Task 1~6 커밋 외 작업 트리 깨끗(기존 미추적 `public/etf-reports/*-test.*` 잔여물 제외).

---

## Self-Review (작성자 체크리스트 결과)

**Spec coverage:** Layer 0(Task 1·2·3) / Layer 1 제목 규칙·앵커 부제·payoff(Task 4) / 시스템 프롬프트 클리셰 전환(Task 4) / event 문구(Task 5, 부작용 #2) / metaphors 부활(Task 6, 보조 변경) / 프리뷰 길이(Task 7 Step 3, 부작용 #4) / tsc·단위·백필(Task 1·7, 검증 계획) — 모두 태스크에 매핑됨.

**미커버 항목 (의도적 deferral):** 임계값 운영 보정(spec §8) — 코드에 명명 상수 + 주석으로 출시, 별도 태스크 없음. hollow 빈도 높을 시 게이트 강화(spec §8) — 운영 데이터 필요, 후속.

**Type consistency:** `EvidenceConfidence`/`EvidenceTier`/`analyzeEvidenceConfidence` 시그니처가 Task 1 정의와 Task 2·3 사용처에서 일치. `cover.imageKeywords?: string[]` 가 Task 6 타입 정의와 Task 4 스키마 지시·run.ts 사용에서 일치. `extractTopCatalysts(news, {topN, recentHeadlines})` 는 기존 시그니처(`catalyst-extractor.ts:108`)와 일치.
