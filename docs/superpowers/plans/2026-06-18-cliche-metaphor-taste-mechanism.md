# 클리셰·은유 메커니즘 (규칙→취향) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단어 금지 리스트(규칙)를 목표 보이스 예시+원칙(취향)으로 대체하고, anti-repetition을 구조 인지형으로 강화해, 클리셰 방지를 유지하면서 자연스러움·신선한 은유를 동시에 얻는다.

**Architecture:** 신규 단일 소스 `lib/voice-exemplars.ts`가 예시·원칙·반례·소프트 칼리브레이션을 프롬프트 블록으로 렌더한다. 마켓(`lib/claude-client.ts`)·ETF(`lib/etf/claude-client.ts`) 프롬프트가 이 블록을 주입하고, 인라인 하드 금지 리스트를 결(예시) 참조로 강등한다. 마켓 anti-repetition 블록은 "단어"가 아니라 "구조·골격·이미지" 재사용을 막도록 지시를 강화한다. 연산·렌더러 코드는 변경하지 않는다.

**Tech Stack:** TypeScript · Node.js (`node:test`) · tsx. 프롬프트 = 템플릿 리터럴(`${}` 보간).

**Scope:** sub-project A만. B(헤드라인 앵커/tier)·C(컴플라이언스 정규식 이동)·D(문장 운율) 제외. `lib/narrative-memory.ts:116`(로그필터)·`lib/banned-metaphors.ts`(경고 로그용 `sanitizeBannedExpressions`에서 계속 사용) 불변.

**검증 특수성:** "자연스러움"은 단위테스트 불가. Task 1(순수 모듈)만 TDD하고, 프롬프트 편집(Task 2~4)은 `tsc` + 기존 테스트 green으로 회귀만 막는다. 실제 품질 게이트는 **Task 5 백필 비교(눈으로)** 이며, 사용자 예시 보강도 여기서 한다.

---

### Task 1: 예시 단일 소스 `lib/voice-exemplars.ts`

**Files:**
- Create: `lib/voice-exemplars.ts`
- Test: `lib/voice-exemplars.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `lib/voice-exemplars.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVoiceExemplars, HEADLINE_EXEMPLARS } from "./voice-exemplars";

test("renderVoiceExemplars: 원칙·시드 헤드라인·반례를 한 블록에 담는다", () => {
  const block = renderVoiceExemplars();
  // 원칙(긍정+소프트 칼리브레이션)
  assert.match(block, /진부한 비유와 반복되는 구문 틀은 피하라/);
  // 시드 헤드라인 포함(자사 살아남은 문장)
  assert.ok(block.includes(HEADLINE_EXEMPLARS[0].text));
  // 구조 클리셰 반례 명시
  assert.match(block, /그린 \[지도/);
});

test("HEADLINE_EXEMPLARS: 각 항목은 text와 note를 가진다", () => {
  assert.ok(HEADLINE_EXEMPLARS.length >= 3);
  for (const e of HEADLINE_EXEMPLARS) {
    assert.equal(typeof e.text, "string");
    assert.equal(typeof e.note, "string");
    assert.ok(e.text.length > 0 && e.note.length > 0);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test lib/voice-exemplars.test.ts`
Expected: FAIL — `Cannot find module './voice-exemplars'`

- [ ] **Step 3: 모듈 구현**

Create `lib/voice-exemplars.ts`:

```ts
// lib/voice-exemplars.ts
// 목표 보이스 예시(exemplar) 단일 소스 — Market·ETF 공유.
// banned-metaphors.ts 가 "피할 것(죽은 비유)"의 소스라면, 이 파일은 "지향할 것"의
// 소스다. 규칙(금지 리스트)을 취향(예시+원칙)으로 대체하기 위한 모듈.

export interface VoiceExemplar {
  /** 본보기 문장 (자사 실제 출력 큐레이션, 사용자 보강 대상) */
  text: string;
  /** 왜 좋은가 — 모델이 결을 학습하도록 붙이는 주석 */
  note: string;
}

export const HEADLINE_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "연준이 금리를 올린 밤, 달러는 올랐고 나머지는 내려앉았다",
    note: "숫자 없이 사건의 인과·대비를 한 문장에. 문어체로 펀치.",
  },
  {
    text: "원유가 내려앉은 자리에 주가가 올라섰다",
    note: "두 자산의 교대를 '자리'라는 공간 이미지로. 간결·신선·정확.",
  },
  {
    text: "반도체가 빠진 자리, 금과 건설이 채운 하루",
    note: "'빠진 자리/채운' 대구. ETF인데도 데이터피드가 아님.",
  },
];

export const BODY_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "주식과 채권이 같은 날 함께 내려앉은 밤이었습니다",
    note: "설명문이 아니라 장면. 이미지가 데이터에 진실함.",
  },
  {
    text: "괴리율 확대가 체결 비용을 조용히 갉아먹습니다",
    note: "전문 개념(괴리율·체결비용)에 '조용히 갉아먹는다' 동사 이미지. 정확+생생.",
  },
];

/** "이렇게는 쓰지 말 것" — 구조·형태 클리셰 반례 (단어가 아니라 틀) */
export const ANTI_PATTERN_EXAMPLES: string[] = [
  "'X가 그린 [지도/로드맵/고속도로]' 같은 반복되는 구문 틀",
  "'SOXX +1.44%, …'처럼 티커·숫자를 앞세운 데이터피드형 제목",
];

/** 소프트 칼리브레이션 — '진부함이 무엇인지' 가르치는 짧은 예시 (하드 필터 아님) */
export const TIRED_METAPHOR_HINTS: string[] = [
  "파도", "항해", "롤러코스터", "폭풍", "폭풍전야", "양날의 검",
];

/** 양 프롬프트에 주입할 목표 보이스 블록 */
export function renderVoiceExemplars(): string {
  const hl = HEADLINE_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = ANTI_PATTERN_EXAMPLES.map((a) => `  · ${a}`).join("\n");
  return `## 목표 보이스 — 예시로 익히기 (규칙보다 이 결을 따르라)

데이터에 진실한 구체적 이미지 하나가 제 몫을 하면 환영한다. 매번 어느 날에나
붙일 수 있는 진부한 비유와 반복되는 구문 틀은 피하라(진부함이란 이런 것:
${TIRED_METAPHOR_HINTS.join(" · ")} 등). 문장·제목의 형태를 변주하라.

### 지향할 헤드라인 결
${hl}

### 지향할 본문 결
${body}

### 피할 형태 (구조·틀 클리셰)
${anti}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test lib/voice-exemplars.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/voice-exemplars.ts lib/voice-exemplars.test.ts
git commit -m "feat: voice-exemplars 단일 소스 — 목표 보이스 예시+원칙+반례"
```

---

### Task 2: 마켓 프롬프트 — 예시 주입 + 금지 리스트 강등

**Files:**
- Modify: `lib/claude-client.ts:11` (import), `:58` (금지 리스트 강등), `:62-64` (예시 블록 주입), `:447` (참조 갱신)

- [ ] **Step 1: import 추가**

`lib/claude-client.ts:11` 아래에 한 줄 추가.

Old:
```ts
import { BANNED_METAPHORS } from "./banned-metaphors";
```
New:
```ts
import { BANNED_METAPHORS } from "./banned-metaphors";
import { renderVoiceExemplars } from "./voice-exemplars";
```
(`BANNED_METAPHORS`는 `sanitizeBannedExpressions`(:595)에서 계속 쓰이므로 import 유지.)

- [ ] **Step 2: `:58` 하드 금지 리스트 → 결 참조로 강등**

Old (`:58`):
```ts
- ❌ 죽은 클리셰(뻔한 비유) 금지: ${BANNED_METAPHORS.map((m) => `"${m}"`).join(", ")} 등.
```
New:
```ts
- ❌ 죽은 클리셰(뻔한 비유)는 피하십시오. 무엇이 진부한지는 아래 [목표 보이스] 블록의 예시로 익히고, 매번 어느 날에나 붙일 수 있는 비유는 쓰지 마십시오. (하드 금지어 목록이 아니라 결을 따르는 것입니다.)
```

- [ ] **Step 3: 예시 블록 주입 (`:64` 앞)**

`### ⛔ 허위 정보 생성 금지` 줄(`:64`) 바로 앞에 목표 보이스 블록을 끼운다.

Old:
```ts
### ⛔ 허위 정보 생성 금지 — 이 규칙은 다른 모든 지시보다 우선합니다
```
New:
```ts
${renderVoiceExemplars()}

### ⛔ 허위 정보 생성 금지 — 이 규칙은 다른 모든 지시보다 우선합니다
```
(buildSystemPrompt은 템플릿 리터럴이라 `${renderVoiceExemplars()}` 보간이 동작한다 — `:58`의 기존 `${BANNED_METAPHORS...}` 보간과 동일 방식.)

- [ ] **Step 4: `:447` 헤드라인 클리셰 참조 갱신**

Old (`:447`):
```ts
- **클리셰는 금지**합니다(시스템 규칙의 금지 비유 목록).
```
New:
```ts
- **진부한 클리셰는 피하십시오** — 위 [목표 보이스] 예시의 결을 따르고, 매번 어느 날에나 붙일 수 있는 비유면 실패입니다.
```

- [ ] **Step 5: 타입체크 + 기존 테스트 green**

Run: `npx tsc --noEmit && npx tsx --test lib/voice-exemplars.test.ts lib/*.test.ts`
Expected: tsc 무에러, 모든 테스트 PASS.
(프롬프트 본문은 단위테스트하지 않는다 — 결과 자연스러움은 Task 5 백필에서 검증.)

- [ ] **Step 6: 커밋**

```bash
git add lib/claude-client.ts
git commit -m "feat: 마켓 프롬프트 — 목표 보이스 예시 주입, 금지 리스트 결 참조로 강등"
```

---

### Task 3: 마켓 anti-repetition — 구조 인지형으로 강화

**Files:**
- Modify: `lib/claude-client.ts:123` (반복 금지 지시), `:451` (헤드라인 반복 회피)

- [ ] **Step 1: `:123` 지시를 단어→구조로**

Old (`buildAntiRepetitionBlock`, `:123`):
```ts
    block += `\n위 요소와 동일하거나 유사한 표현은 사용하지 마십시오.\n`;
```
New:
```ts
    block += `\n위 요소와 동일하거나 유사한 **단어**뿐 아니라, **구조·골격·이미지의 재사용**도 피하십시오. 특히 최근 헤드라인들의 공통 구문 틀(예: "…가 그린 …", "…한 자리에 …" 류)이 보이면 같은 문형을 반복하지 말고 다른 골격으로 쓰십시오.\n`;
```

- [ ] **Step 2: `:451` 헤드라인 반복 회피에 구문 틀 추가**

Old (`:451`):
```ts
- **반복 회피**: 같은 catalyst·이미지가 최근 3일 헤드라인에 등장했다면 (a) 사건의 국면·단계를 다르게 표현하거나 (b) catalyst를 부제로 내리고 제목은 새 각도로.
```
New:
```ts
- **반복 회피**: 같은 catalyst·이미지·**구문 틀**이 최근 3일 헤드라인에 등장했다면 (a) 사건의 국면·단계를 다르게 표현하거나 (b) catalyst를 부제로 내리고 제목은 새 각도로. 같은 문형("X가 그린 Y" 류)을 연일 반복하지 마십시오.
```

- [ ] **Step 3: 타입체크 + 기존 테스트 green**

Run: `npx tsc --noEmit && npx tsx --test lib/*.test.ts`
Expected: tsc 무에러, 모든 테스트 PASS.

- [ ] **Step 4: 커밋**

```bash
git add lib/claude-client.ts
git commit -m "feat: 마켓 anti-repetition — 단어가 아니라 구조·구문 틀 반복 차단"
```

---

### Task 4: ETF 프롬프트 — 예시 주입 + 금지 리스트 강등

**Files:**
- Modify: `lib/etf/claude-client.ts:9` (import 정리), `:39` (금지 리스트 강등), `:43` (예시 블록 주입)

- [ ] **Step 1: import 교체**

ETF `:39`가 `BANNED_METAPHORS`·`ETF_EXTRA_BANNED`의 유일한 사용처다(강등하면 미사용). import를 voice-exemplars로 교체.

Old (`:9`):
```ts
import { BANNED_METAPHORS, ETF_EXTRA_BANNED } from '../banned-metaphors'
```
New:
```ts
import { renderVoiceExemplars } from '../voice-exemplars'
```

- [ ] **Step 2: `:39` 하드 금지 리스트 → 결 참조로 강등**

Old (`:39`):
```ts
- 신선하고 구체적인 은유·관점은 권장하되, **죽은 클리셰**는 금지: ${[...BANNED_METAPHORS, ...ETF_EXTRA_BANNED].map(m => `"${m}"`).join(', ')} 등. "아무 날에나 붙일 수 있는 비유"는 쓰지 마십시오.
```
New:
```ts
- 신선하고 구체적인 은유·관점은 권장합니다. 무엇이 진부한지는 아래 [목표 보이스] 예시로 익히고, "아무 날에나 붙일 수 있는 비유"·반복되는 구문 틀은 쓰지 마십시오. (하드 금지어 목록이 아니라 결을 따르는 것입니다.)
```

- [ ] **Step 3: 예시 블록 주입 (SYSTEM_PROMPT 끝, `:43` 앞)**

SYSTEM_PROMPT 닫기 직전(`반드시 지정된 JSON 형식으로만…` `:43`) 앞에 목표 보이스 블록을 끼운다.

Old (`:43`):
```ts
반드시 지정된 JSON 형식으로만 응답하십시오. 다른 텍스트는 일절 포함하지 마십시오.`
```
New:
```ts
${renderVoiceExemplars()}

반드시 지정된 JSON 형식으로만 응답하십시오. 다른 텍스트는 일절 포함하지 마십시오.`
```

- [ ] **Step 4: 타입체크 + 기존 테스트 green**

Run: `npx tsc --noEmit && npx tsx --test lib/*.test.ts lib/**/*.test.ts`
Expected: tsc 무에러(미사용 import 없음), 모든 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/etf/claude-client.ts
git commit -m "feat: ETF 프롬프트 — 목표 보이스 예시 주입, 금지 리스트 결 참조로 강등"
```

---

### Task 5: 백필 비교 검증 + 사용자 예시 보강 (협업·수동)

**Files:**
- Modify (협업): `lib/voice-exemplars.ts` (사용자 보강 시드)
- 검증 대상: 생성된 `public/reports/<date>.html` · `public/etf-reports/<date>.html`

> 이 태스크는 단위테스트가 아니다. "자연스러움"은 눈으로 본다. 로컬 생성은 텔레그램 발송이 없다(발송은 워크플로 step이며 `run.ts`/`run-etf.ts`엔 없음 — 고객 영향 0). ETF는 로컬에 KRX 키가 없어 thin tier로 돌지만 **산문은 정상 생성**되어 자연스러움 점검엔 충분.

- [ ] **Step 1: 변경 전 기준 캡처**

현재 추적 중인 최근 리포트의 헤드라인을 기준으로 둔다(이미 git에 있음). 비교용으로 최근 5일 헤드라인을 적어둔다:

Run: `git show HEAD:data/reports-index.json | python3 -c "import json,sys; [print(r['date'], r['headline']) for r in json.load(sys.stdin)['reports'][:5]]"`
Expected: 변경 전 헤드라인 5개 출력(특히 "X가 그린 …" 류 확인).

- [ ] **Step 2: 마켓 백필 생성 (변경 후)**

오늘 자 리포트를 강제 재생성(중복 가드 우회). `.env.local`에 `ANTHROPIC_API_KEY` 필요.

Run: `FORCE_REGENERATE=true npx tsx scripts/run.ts`
Expected: `public/reports/<오늘>.html` 재생성. 콘솔에 생성 로그.

- [ ] **Step 3: 마켓 결과 눈으로 점검**

Run: `python3 -c "import re,html; t=open([f for f in __import__('glob').glob('public/reports/2026-*.html')][-1]).read(); print('HEADLINE:', html.unescape(re.search(r'cover-headline\"[^>]*>([^<]+)', t).group(1))); print('SUBLINE:', html.unescape(re.search(r'cover-subline\"[^>]*>([^<]+)', t).group(1)))"`
점검 기준 (눈으로):
- ① 헤드라인이 "X가 그린 Y" 등 최근 반복 구문 틀이 아닌가?
- ② 은유가 살아있되 그날 데이터에서 길어올린 신선한 것인가?
- ③ `TIRED_METAPHOR_HINTS`(파도·항해 등) 죽은 클리셰가 없는가?

- [ ] **Step 4: ETF 백필 생성·점검**

Run: `FORCE_REGENERATE=true npx tsx scripts/run-etf.ts`
그다음 생성된 `public/etf-reports/<오늘>.html`의 헤드라인·overnightBrief 산문을 같은 ①②③로 점검.
(thin tier라 strong 전용 은유는 약할 수 있음 — 그건 sub-project B 영역이니 여기선 "클리셰·과잉억제"만 본다.)

- [ ] **Step 5: 사용자 예시 보강 (협업)**

사용자가 `lib/voice-exemplars.ts`의 `HEADLINE_EXEMPLARS`/`BODY_EXEMPLARS`를 검토해 천장을 올린다(자신이 흠모하는 톤의 문장 추가/시드 편집). 보강 후 Step 2~4를 재실행해 결과가 의도에 수렴하는지 확인.

- [ ] **Step 6: 백필 산출물 정리 + 커밋**

백필로 생성된 `public/.../<오늘>.html`은 워크플로가 매일 다시 만드므로 로컬 재생성본은 커밋하지 않거나 되돌린다(`git checkout -- public/`). 사용자 보강이 있었다면 voice-exemplars만 커밋.

```bash
git checkout -- public/ data/ 2>/dev/null || true   # 백필 재생성 산출물 되돌리기
git add lib/voice-exemplars.ts                        # 사용자 보강분이 있을 때만
git commit -m "chore: voice-exemplars 사용자 보강(백필 검증 반영)" || echo "보강 없음 — 스킵"
```

---

## Self-Review

**1. Spec coverage:**
- §1 변경 지점(voice-exemplars 신규·마켓 :58/:447·ETF :39·sanitize 유지·narrative-memory:116 불변) → Task 1·2·4 + 비목표 명시. ✓
- §2 예시 모듈(시드+사용자 보강) → Task 1(시드) + Task 5 Step 5(보강). ✓
- §3 원칙 문구(긍정+소프트 칼리브레이션) → Task 1 `renderVoiceExemplars` 본문. ✓
- §4 anti-repetition 구조 인지 → Task 3. ✓
- §5 범위(마켓·ETF 양쪽)·검증(백필) → Task 2·4(양쪽) + Task 5(백필). ✓
- 트레이드오프 문서화(하드 필터 제거→첫출현 클리셰 가끔 놓침) → 본 plan 헤더 "검증 특수성" + Task 5 ①②③ 관찰. ✓

**2. Placeholder scan:** "TBD/TODO/적절히" 없음. 프롬프트 교체는 전부 실제 before/after 텍스트. 백필 점검은 실행 명령 + 구체 기준 ①②③. 사용자 보강(Task 5 Step 5)은 placeholder가 아니라 의도된 협업 단계. ✓

**3. Type consistency:** `renderVoiceExemplars()`(Task 1 정의 → Task 2·4 사용), `HEADLINE_EXEMPLARS`/`BODY_EXEMPLARS`/`VoiceExemplar`/`ANTI_PATTERN_EXAMPLES`/`TIRED_METAPHOR_HINTS`(Task 1 정의 → 테스트·렌더 사용) 명칭 일치. ETF에서 `BANNED_METAPHORS` import 제거 시 유일 사용처(:39) 동시 제거 → 미사용 없음. 마켓은 `BANNED_METAPHORS`가 `:595`에서 계속 쓰여 import 유지. ✓
