# ETF 제목·문체 프롬프트 통합 정리 (묶음 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ETF 리포트 프롬프트의 제목·문체 지시를 한 정책으로 통합한다. 반복 틀(티커 앞세움·시간명사 종결)과 입력 어휘 에코, ISO 날짜 괄호 누출을 없앤다. 마켓 프롬프트 조각(목표 보이스·시점 블록·요일 리듬)의 결정적 출력은 한 글자도 바꾸지 않는다(모델 응답의 동일성이 아니라 프롬프트 조립의 불변).

**Architecture:** 공유 모듈(`voice-exemplars`·`weekday-rhythm`·`market-calendar`·`temporal-framing`)은 ETF 분기에만 새 동작을 넣는다. 마켓 경로의 출력은 변경 전 스냅샷 픽스처로 바이트 단위 고정한다. ETF 프롬프트(`lib/etf/claude-client.ts`)는 시스템 프롬프트 예외 표기와 헤드라인 규칙 블록 교체로 정리한다. 테스트를 위해 프롬프트 조립 함수를 export한다.

**Tech Stack:** TypeScript 5, Node 24, tsx, `node:test` + `node:assert/strict` (`npx tsx --test <file>`), `npx tsc --noEmit`

**Spec:** `docs/superpowers/specs/2026-09-30-etf-headline-consolidation-design.md`

## Global Constraints

- 범위: ETF 리포트만. 마켓 프롬프트·출력 불변(바이트 단위).
- 커밋 메시지: 한국어 서술형. 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `git add -A` 금지(`public/`에 미추적 테스트 잔여물 다수). 파일을 명시해 add.
- 테스트 러너: `npx tsx --test <file>`. 타입 검사: `npx tsc --noEmit`
- 작업 트리에서 `scripts/run-etf.ts`/`scripts/run.ts` 실행 금지(저장소 파일 기록). 격리 평가는 Task 7의 일회용 worktree에서만.
- 앵글 키 `환율_양면성` 등 로그에 남는 키 이름은 바꾸지 않는다.
- push·머지·dispatch는 사용자 승인 후에만.

## Review Focus

1. **KR만 갭인 날(한국 연휴 뒤, 예 2026-10-06: KR 직전 10-02, US 직전 10-05)** — ETF 시점 블록에 '"간밤"이 아니라' 지시가 나오면 안 되고, KR 갭 경고만 나와야 한다. → Task 4 테스트.
2. **미국 단독 휴장일(2026-01-19)의 ETF 블록** — 휴장 안내가 남되 ISO 날짜 괄호(`(2026-01-16)`)가 없어야 한다. market 블록은 기존처럼 `지난 금요일(2026-01-16)`을 유지해야 한다. → Task 4 테스트.
3. **금요일 market 요일 리듬** — 공유 문자열에서 ETF 헤드라인 줄만 뺄 때 market 문자열이 바뀌기 쉽다. → Task 1 픽스처 + Task 3 테스트.
4. **ETF 프롬프트 조립이 최소 데이터(시세·뉴스 없음)에서도 예외 없이 돈다** — export 후 테스트 픽스처가 이 경로를 쓴다. 실운영에서 수집 실패일과 같은 입력이다. → Task 6 테스트.
5. **최근 헤드라인이 없는 날** — 최근 헤드라인 블록이 통째로 생략되어도 새 헤드라인 규칙은 독립적으로 온전해야 한다(블록 참조 문구가 깨진 참조로 남지 않게). → Task 6 테스트.

---

## File Structure

| 파일 | 변경 | 책임 |
|---|---|---|
| `lib/__fixtures__/market-prompt-freeze.json` | Create | 변경 전 market 경로 출력 스냅샷 |
| `lib/market-prompt-freeze.test.ts` | Create | market 출력 바이트 불변 검사 |
| `scripts/dev/capture-market-freeze.ts` | Create | 스냅샷 생성 스크립트(재생성용, 저장소 파일 1개만 씀) |
| `lib/voice-exemplars.ts` | Modify | `renderVoiceExemplars(target)`, ETF 예시·반례 |
| `lib/voice-exemplars.test.ts` | Modify | ETF 세트 검사 |
| `lib/weekday-rhythm.ts` | Modify | ETF 분기 헤드라인 줄 제거 |
| `lib/weekday-rhythm.test.ts` | Modify | ETF 월·금 헤드라인 부재 |
| `lib/market-calendar.ts` | Modify | `readerPhrase` 추가 |
| `lib/market-calendar.test.ts` | Modify | `readerPhrase` 검사 |
| `lib/temporal-framing.ts` | Modify | ETF 분기: 참고 기준일/독자 표현 분리, KR/US 갭 분리 |
| `lib/temporal-framing.test.ts` | Modify | ETF 새 동작 검사 |
| `lib/etf/narrative-angle.ts` | Modify | 앵글 설명 2곳 중립화 |
| `lib/etf/morning-strategy.ts` | Modify | 반도체 rationale 중립화 |
| `lib/etf/claude-client.ts` | Modify | export, 시스템 예외 표기, 헤드라인 블록 교체, ETF 예시 호출 |
| `lib/etf/claude-client.prompt.test.ts` | Create | 조립된 ETF 프롬프트 검사 |

---

### Task 1: market 출력 스냅샷 고정 (변경 전)

**Files:**
- Create: `scripts/dev/capture-market-freeze.ts`
- Create: `lib/__fixtures__/market-prompt-freeze.json`
- Create: `lib/market-prompt-freeze.test.ts`

**Interfaces:**
- Consumes: `renderVoiceExemplars()`(`lib/voice-exemplars.ts`), `buildTemporalFramingBlock(info, "market")`(`lib/temporal-framing.ts`), `describeWeekdayRhythm(role, "market")`(`lib/weekday-rhythm.ts`), `getMarketCalendarInfo(date)`(`lib/market-calendar.ts`)
- Produces: 스냅샷 JSON 키 `voice`, `temporal_2026-06-30`, `temporal_2026-06-29`, `temporal_2026-01-19`, `temporal_2026-10-06`, `temporal_2026-09-28`, `weekday_monday_setup`, `weekday_friday_recap`, `weekday_midweek`. 이후 모든 Task가 이 테스트로 market 불변을 확인한다.

- [ ] **Step 1: 스냅샷 생성 스크립트 작성**

```ts
// scripts/dev/capture-market-freeze.ts
// market 경로 프롬프트 조각의 현재 출력을 픽스처로 고정한다(묶음 3, 2026-09-30).
// 픽스처를 다시 만들 일은 market 프롬프트를 '의도적으로' 바꿀 때뿐이다.
import fs from "node:fs";
import { renderVoiceExemplars } from "../../lib/voice-exemplars";
import { buildTemporalFramingBlock } from "../../lib/temporal-framing";
import { describeWeekdayRhythm } from "../../lib/weekday-rhythm";
import { getMarketCalendarInfo } from "../../lib/market-calendar";

const out: Record<string, string> = { voice: renderVoiceExemplars() };
for (const d of ["2026-06-30", "2026-06-29", "2026-01-19", "2026-10-06", "2026-09-28"]) {
  out[`temporal_${d}`] = buildTemporalFramingBlock(getMarketCalendarInfo(d), "market");
}
for (const role of ["monday_setup", "friday_recap", "midweek"] as const) {
  out[`weekday_${role}`] = describeWeekdayRhythm(role, "market");
}
fs.mkdirSync("lib/__fixtures__", { recursive: true });
fs.writeFileSync("lib/__fixtures__/market-prompt-freeze.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote", Object.keys(out).length, "keys");
```

역할 이름은 `lib/weekday-rhythm.ts:8`의 `WeekdayRole`(`monday_setup | midweek | friday_recap`)과 같다.

- [ ] **Step 2: 변경 전 main 코드로 스냅샷 생성**

Run: `npx tsx scripts/dev/capture-market-freeze.ts`
Expected: `wrote 9 keys`. 확인: `git diff --stat`에 코드 변경이 없고 새 파일 2개만 보인다.

- [ ] **Step 3: 불변 테스트 작성**

```ts
// lib/market-prompt-freeze.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderVoiceExemplars } from "./voice-exemplars";
import { buildTemporalFramingBlock } from "./temporal-framing";
import { describeWeekdayRhythm } from "./weekday-rhythm";
import { getMarketCalendarInfo } from "./market-calendar";

const frozen: Record<string, string> = JSON.parse(
  fs.readFileSync("lib/__fixtures__/market-prompt-freeze.json", "utf8"),
);

test("market 목표 보이스 블록은 묶음 3 이전과 바이트 단위로 같다", () => {
  assert.equal(renderVoiceExemplars(), frozen.voice);
  assert.equal(renderVoiceExemplars("market"), frozen.voice);
});

for (const d of ["2026-06-30", "2026-06-29", "2026-01-19", "2026-10-06", "2026-09-28"]) {
  test(`market 시점 블록(${d})은 묶음 3 이전과 같다`, () => {
    assert.equal(buildTemporalFramingBlock(getMarketCalendarInfo(d), "market"), frozen[`temporal_${d}`]);
  });
}

for (const role of ["monday_setup", "friday_recap", "midweek"] as const) {
  test(`market 요일 리듬(${role})은 묶음 3 이전과 같다`, () => {
    assert.equal(describeWeekdayRhythm(role, "market"), frozen[`weekday_${role}`]);
  });
}
```

`renderVoiceExemplars("market")`는 Task 2 전에는 인자를 받지 않아 tsc가 실패한다. **Task 1에서는 두 번째 assert 줄을 넣지 않는다.** Task 2 Step 1에서 추가한다.

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/market-prompt-freeze.test.ts`
Expected: 9 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/capture-market-freeze.ts lib/__fixtures__/market-prompt-freeze.json lib/market-prompt-freeze.test.ts
git commit -m "market 프롬프트 조각 출력 스냅샷 고정 — 묶음 3 변경의 market 불변 가드

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ETF 전용 예시·반례 (`renderVoiceExemplars(target)`)

**Files:**
- Modify: `lib/voice-exemplars.ts`
- Modify: `lib/voice-exemplars.test.ts`
- Modify: `lib/market-prompt-freeze.test.ts` (market 인자 assert 추가)

**Interfaces:**
- Produces: `export type VoiceTarget = "market" | "etf"`, `export const ETF_HEADLINE_EXEMPLARS: VoiceExemplar[]`, `export const ETF_ANTI_PATTERN_EXAMPLES: string[]`, `export function renderVoiceExemplars(target: VoiceTarget = "market"): string`. Task 6이 `renderVoiceExemplars('etf')`를 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/voice-exemplars.test.ts` 끝에 추가:

```ts
import { ETF_HEADLINE_EXEMPLARS } from "./voice-exemplars";

test("renderVoiceExemplars('etf'): ETF 예시 6개를 담고 market 예시·형태 반례는 뺀다", () => {
  const block = renderVoiceExemplars("etf");
  for (const t of [
    "원화, 하루 만에 20원 되찾다",
    "금 급락·반도체 하락, 방어 우위 국면 진입",
    "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화",
    "반도체 직격, 방어주가 버텼다",
    "미 국채 5% 벽, 원화가 먼저 무너졌다",
    "무디스 성장률 3.5% 상향, 반도체가 국내 주도",
  ]) assert.ok(block.includes(t), t);
  assert.equal(ETF_HEADLINE_EXEMPLARS.length, 6);
  assert.ok(!block.includes("금리 올린 연준, 달러만 웃었다"));   // market 예시
  assert.ok(!block.includes("데이터피드형 제목"));                // 정책으로 이동한 형태 반례
  assert.ok(!block.includes("2절 문어체 틀"));
  assert.ok(!block.includes("다음 날, [주절]"));
  assert.ok(block.includes("한 주를 닫다"));                      // 추가된 번역투 반례
  assert.ok(block.includes("N포인트를 잃었다"));                  // 유지된 반례
  assert.ok(block.includes("괴리율 확대가 체결 비용을 조용히 갉아먹습니다")); // 공유 본문 예시
});
```

`lib/market-prompt-freeze.test.ts`의 첫 테스트에 `assert.equal(renderVoiceExemplars("market"), frozen.voice);` 줄을 추가한다.

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/voice-exemplars.test.ts`
Expected: FAIL (`ETF_HEADLINE_EXEMPLARS` export 없음 또는 includes 실패)

- [ ] **Step 3: 구현**

`lib/voice-exemplars.ts`에서 `ANTI_PATTERN_EXAMPLES` 정의 뒤, `TIRED_METAPHOR_HINTS` 앞에 추가:

```ts
export type VoiceTarget = "market" | "etf";

// 2026-09-30 묶음 3: ETF 전용 제목 예시 — 실제 발송본에서 사용자가 고른 6개.
// 마켓은 위 HEADLINE_EXEMPLARS를 그대로 쓴다(마켓 출력 불변).
export const ETF_HEADLINE_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "원화, 하루 만에 20원 되찾다",
    note: "주어 + 기사체 현재형. 가장 짧은 신문 제목 결.",
  },
  {
    text: "금 급락·반도체 하락, 방어 우위 국면 진입",
    note: "사실을 나열하고 서술성 명사('진입')로 끝맺음. 티커 없이 한국어 명칭.",
  },
  {
    text: "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화",
    note: "사실…의미를 말줄임표로 잇고 '본격화'로 끝맺음.",
  },
  {
    text: "반도체 직격, 방어주가 버텼다",
    note: "명사구 + 짧은 주술로 대비를 압축.",
  },
  {
    text: "미 국채 5% 벽, 원화가 먼저 무너졌다",
    note: "분기점 숫자를 은유('벽') 속에 녹임 — strong 근거일 때의 결.",
  },
  {
    text: "무디스 성장률 3.5% 상향, 반도체가 국내 주도",
    note: "출처 있는 사건을 앞세우고 서술성 명사('주도')로 끝맺음.",
  },
];

// ETF 제목 형태(티커 앞세움·2절 틀·'다음 날' 틀)는 ETF 프롬프트의 [cover.headline 작성 규칙]이
// 직접 다룬다. 여기에는 표현 차원의 반례만 둔다(같은 말을 두 곳에 두지 않는다).
export const ETF_ANTI_PATTERN_EXAMPLES: string[] = [
  "'X가 그린 [지도/로드맵/고속도로]' 같은 반복되는 구문 틀",
  "'분기를 닫다(close a quarter)', '한 주를 닫다', '한 주를 가져갔다', '~을 갈라놓다', 돈이 '꽂히다' 류 억지·번역투 연어 — 한국어 통상 표현으로",
  "'N포인트를 잃었다/얻었다'는 영어 'lost/gained N points' 직역이다 — 한국어는 'N포인트 하락·상승', 'N포인트 빠졌다'로",
];
```

`renderVoiceExemplars`는 **함수 머리와 처음 세 줄만** 바꾼다. 그 아래 `return \`## 목표 보이스 …\`` 템플릿 리터럴(현 `lib/voice-exemplars.ts:66-83`)은 한 글자도 건드리지 않는다.

변경 전(`:61-65`):
```ts
/** 양 프롬프트에 주입할 목표 보이스 블록 */
export function renderVoiceExemplars(): string {
  const hl = HEADLINE_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = ANTI_PATTERN_EXAMPLES.map((a) => `  · ${a}`).join("\n");
```

변경 후:
```ts
/** 양 프롬프트에 주입할 목표 보이스 블록. target 기본값 market — 마켓 출력 불변. */
export function renderVoiceExemplars(target: VoiceTarget = "market"): string {
  const headlines = target === "etf" ? ETF_HEADLINE_EXEMPLARS : HEADLINE_EXEMPLARS;
  const antis = target === "etf" ? ETF_ANTI_PATTERN_EXAMPLES : ANTI_PATTERN_EXAMPLES;
  const hl = headlines.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = antis.map((a) => `  · ${a}`).join("\n");
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/voice-exemplars.test.ts lib/market-prompt-freeze.test.ts`
Expected: 모두 pass (market 불변 포함)

- [ ] **Step 5: Commit**

```bash
git add lib/voice-exemplars.ts lib/voice-exemplars.test.ts lib/market-prompt-freeze.test.ts
git commit -m "ETF 전용 제목 예시 6개·표현 반례 세트 — renderVoiceExemplars(target), market 출력 불변

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 요일 리듬 ETF 분기의 헤드라인 줄 제거

**Files:**
- Modify: `lib/weekday-rhythm.ts:33-49`
- Modify: `lib/weekday-rhythm.test.ts`

**Interfaces:**
- Consumes: 없음(독립). Produces: `describeWeekdayRhythm(role, "etf")` 출력에 "헤드라인" 문자열 없음.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/weekday-rhythm.test.ts`에 추가:

```ts
test("etf 월·금 리듬에는 헤드라인 지시가 없다(묶음 3) — 본문 지시는 유지", () => {
  const mon = describeWeekdayRhythm("monday_setup", "etf");
  const fri = describeWeekdayRhythm("friday_recap", "etf");
  assert.doesNotMatch(mon, /헤드라인/);
  assert.doesNotMatch(fri, /헤드라인/);
  assert.doesNotMatch(fri, /X요일/);
  assert.match(mon, /bigPicture/);
  assert.match(fri, /closingLine/);
});

test("market 금요일 리듬은 헤드라인 톤 지시를 유지한다", () => {
  assert.match(describeWeekdayRhythm("friday_recap", "market"), /한 주를 닫는/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/weekday-rhythm.test.ts`
Expected: FAIL (etf 월요일에 "헤드라인은 "주말 뒤 시작"…" 존재)

- [ ] **Step 3: 구현**

`lib/weekday-rhythm.ts`의 ETF 월요일 return을 다음으로 교체:

```ts
    // etf — overnight 브리핑 설계와 정합(주말 해외 흐름이 주된 데이터).
    // 묶음 3(2026-09-30): 헤드라인 톤 지시 제거 — 제목 형태는 ETF [cover.headline 작성 규칙]이 단일 소스.
    return `\n[요일 리듬 — 월요일 셋업]\n- 오늘은 한 주의 첫 영업일입니다. 주말 사이 미국·유럽 시장 변동과 환율 야간 흐름을 bigPicture 첫 문장에 녹이고, 이번 주 관전 ETF군(반도체·환노출·채권 등 중 한 그룹) 을 closingLine 으로 명시.\n`
```

금요일 분기의 return을 다음으로 교체:

```ts
    // 묶음 3(2026-09-30): 헤드라인 톤 줄은 market에만. ETF는 "~한 금요일"·"한 주를 닫다" 틀의 원인이었다.
    const headlineLine = reportType === "market"
      ? `- 헤드라인은 "한 주를 닫는" 톤. "이번 주 X를 정리한 X요일" 같은 회고 색을 입혀도 좋음.\n`
      : "";
    return `\n[요일 리듬 — 금요일 회수]\n- 오늘은 한 주의 마지막 영업일입니다. ${extra}\n${headlineLine}`;
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/weekday-rhythm.test.ts lib/market-prompt-freeze.test.ts`
Expected: 모두 pass

- [ ] **Step 5: Commit**

```bash
git add lib/weekday-rhythm.ts lib/weekday-rhythm.test.ts
git commit -m "ETF 요일 리듬에서 헤드라인 톤 지시 제거 — 시간명사 종결·'한 주를 닫다' 틀의 원인

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 독자용 날짜 표현 분리 (`readerPhrase` + ETF 시점 블록)

**Files:**
- Modify: `lib/market-calendar.ts:238-254` (`describeSessionRecency`)
- Modify: `lib/market-calendar.test.ts`
- Modify: `lib/temporal-framing.ts:13-38` (etf 분기)
- Modify: `lib/temporal-framing.test.ts`

**Interfaces:**
- Produces: `describeSessionRecency(...)` 반환 타입 `{ gapDays: number; phrase: string; readerPhrase: string; weekday: string }`. `phrase`는 불변.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/market-calendar.test.ts`에 추가:

```ts
test("describeSessionRecency.readerPhrase: 갭1 KR '전 거래일', US '간밤', 기존 phrase 불변", () => {
  const info = getMarketCalendarInfo("2026-06-30");
  const kr = describeSessionRecency("2026-06-30", info.krPrevTradingDay, "kr");
  const us = describeSessionRecency("2026-06-30", info.usPrevTradingDay, "us");
  assert.equal(kr.readerPhrase, "전 거래일");
  assert.equal(us.readerPhrase, "간밤");
  assert.equal(kr.phrase, "전 거래일(어제, 2026-06-29)");
  assert.equal(us.phrase, "간밤(2026-06-29 현지 마감)");
});

test("describeSessionRecency.readerPhrase: 갭>1은 한국어 요일·일자, ISO 없음", () => {
  const info = getMarketCalendarInfo("2026-06-29"); // 월, prev 06-26(금)
  const kr = describeSessionRecency("2026-06-29", info.krPrevTradingDay, "kr");
  assert.equal(kr.readerPhrase, "지난 금요일(26일)");
  assert.equal(kr.phrase, "지난 금요일(2026-06-26)");
  const us = describeSessionRecency("2026-06-29", info.usPrevTradingDay, "us");
  assert.equal(us.readerPhrase, "지난 금요일(26일)");
  const k2 = describeSessionRecency("2026-10-06", "2026-10-02", "kr");
  assert.equal(k2.readerPhrase, "지난 금요일(2일)");
});
```

`lib/temporal-framing.test.ts`에 추가:

```ts
const ISO_PAREN = /\(\d{4}-\d{2}-\d{2}/;

test("etf 블록: 독자 표현 + 참고 기준일 분리, 경고·안내 문구에 ISO 괄호 없음(월 06-29)", () => {
  const block = buildTemporalFramingBlock(getMarketCalendarInfo("2026-06-29"), "etf");
  assert.match(block, /참고 기준일: 2026-06-26/);
  assert.match(block, /지난 금요일\(26일\)/);
  assert.match(block, /YYYY-MM-DD 형식의 숫자 날짜를 쓰지 마십시오/);
  // 양쪽 갭(월요일)이면 두 경고가 모두 있어야 한다(필터 루프가 삭제된 경고를 놓치지 않게).
  assert.match(block, /"간밤"이 아니라 "지난 금요일\(26일\)"로/);
  assert.match(block, /국내 ETF 데이터는 지난 금요일\(26일\) 종가/);
  const warnLines = block.split("\n").filter((l) => l.includes("⚠️"));
  assert.ok(warnLines.length >= 3, `경고 줄 ${warnLines.length}`); // 24h 안내 + US 갭 + KR 갭
  for (const l of warnLines) assert.doesNotMatch(l, ISO_PAREN, l);
});

test("etf 블록: KR만 갭인 날(2026-10-06)은 KR 경고만, '간밤이 아니라' 지시 없음", () => {
  const block = buildTemporalFramingBlock(getMarketCalendarInfo("2026-10-06"), "etf");
  assert.doesNotMatch(block, /"간밤"이 아니라/);
  assert.match(block, /국내 ETF 데이터는 지난 금요일\(2일\) 종가/);
  assert.match(block, /간밤 종가/);
});

test("etf 블록: 미국 단독 휴장(2026-01-19) 안내에 ISO 괄호 없음", () => {
  const block = buildTemporalFramingBlock(getMarketCalendarInfo("2026-01-19"), "etf");
  const note = block.split("\n").find((l) => l.includes("미국 세션이 없습니다"))!;
  assert.ok(note);
  assert.doesNotMatch(note, ISO_PAREN);
  assert.match(note, /지난 금요일\(16일\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/market-calendar.test.ts lib/temporal-framing.test.ts`
Expected: FAIL (`readerPhrase` undefined, 새 문구 없음)

- [ ] **Step 3: `describeSessionRecency` 구현**

`lib/market-calendar.ts`의 함수를 다음으로 교체:

```ts
export function describeSessionRecency(
  reportDate: string,
  prevTradingDay: string,
  market: "kr" | "us"
): { gapDays: number; phrase: string; readerPhrase: string; weekday: string } {
  const gapDays = calendarDaysBetween(prevTradingDay, reportDate);
  const weekday = koreanWeekday(prevTradingDay);
  // phrase: 모델 참고용(ISO 기준일 포함, market 프롬프트가 사용 — 불변).
  // readerPhrase: 독자 문장용(묶음 3, 2026-09-30) — ISO 날짜 없이, 갭 날만 한국어 일자.
  let phrase: string;
  let readerPhrase: string;
  if (gapDays === 1) {
    phrase = market === "kr"
      ? `전 거래일(어제, ${prevTradingDay})`
      : `간밤(${prevTradingDay} 현지 마감)`;
    readerPhrase = market === "kr" ? "전 거래일" : "간밤";
  } else {
    phrase = `지난 ${weekday}요일(${prevTradingDay})`;
    readerPhrase = `지난 ${weekday}요일(${Number(prevTradingDay.slice(8, 10))}일)`;
  }
  return { gapDays, phrase, readerPhrase, weekday };
}
```

- [ ] **Step 4: ETF 시점 블록 구현**

`lib/temporal-framing.ts`의 `if (reportType === "etf") { … }` 블록 전체를 다음으로 교체(위쪽 `usHolidayNote`·`twentyFourHourNote` 정의와 market 분기는 그대로):

```ts
  if (reportType === "etf") {
    // ETF는 시스템 프롬프트가 "발행=개장 전, 전일 국내/간밤 해외"를 이미 명시.
    // 묶음 3(2026-09-30): 모델 참고용 기준일과 독자용 표현을 분리하고, 갭 경고를 시장별로 나눈다.
    // (이전에는 KR만 갭인 날에도 미국 문구로 '"간밤"이 아니라 "간밤(…)"로'라는 모순 지시가 나갔다.)
    const usHolidayNoteEtf = info.isUsClosedOnly
      ? `\n- ⚠️ 오늘 밤 미국 시장은 ${info.usHolidayName ?? "휴일"}로 휴장입니다 — 오늘 밤 새 미국 세션이 없습니다. 미국 데이터는 ${us.readerPhrase} 종가가 최신입니다.`
      : "";
    const usGapLine = us.gapDays > 1
      ? `\n- ⚠️ 직전 미국 세션은 ${us.readerPhrase}입니다. "간밤"이 아니라 "${us.readerPhrase}"로 명시하고, 그 사이 뉴스는 "오늘 개장 시 반영될 변수"로 서술하십시오.`
      : "";
    const krGapLine = kr.gapDays > 1
      ? `\n- ⚠️ 국내 ETF 데이터는 ${kr.readerPhrase} 종가입니다. "어제"로 쓰지 마십시오.`
      : "";
    return `\n## ⏰ 시점 기준 (개장 전 브리핑)\n- 미국 데이터: ${us.readerPhrase} 종가 (참고 기준일: ${info.usPrevTradingDay} 현지 마감). 한국 ETF 데이터: ${kr.readerPhrase} 종가 (참고 기준일: ${info.krPrevTradingDay}).\n- 참고 기준일은 사실 확인용입니다. 제목·서브라인·본문에 YYYY-MM-DD 형식의 숫자 날짜를 쓰지 마십시오. 예외는 하나뿐입니다: 직전 세션이 어제가 아니면(주말·휴일) "지난 금요일(25일)"처럼 한국어 요일·일자를 한 번 쓸 수 있습니다.${usHolidayNoteEtf}${twentyFourHourNote}${usGapLine}${krGapLine}\n`;
  }
```

위쪽의 `const gapWarn = …`은 market 분기가 계속 쓰므로 그대로 둔다.

- [ ] **Step 5: 통과 확인 (기존 테스트 포함)**

Run: `npx tsx --test lib/market-calendar.test.ts lib/temporal-framing.test.ts lib/market-prompt-freeze.test.ts`
Expected: 모두 pass. 기존 "etf 변형은 경량" 테스트의 `/지난 금요일/`도 `readerPhrase`로 통과해야 한다.

- [ ] **Step 6: Commit**

```bash
git add lib/market-calendar.ts lib/market-calendar.test.ts lib/temporal-framing.ts lib/temporal-framing.test.ts
git commit -m "ETF 시점 블록: 참고 기준일과 독자용 표현 분리, KR/US 갭 경고 분리 — 본문 ISO 날짜 괄호 누출 차단

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 입력 문구 중립화

**Files:**
- Modify: `lib/etf/narrative-angle.ts:25,27`
- Modify: `lib/etf/morning-strategy.ts:236`

**Interfaces:** 없음(문자열만). Task 6 테스트가 "옮겨붙"·"두 얼굴"·"불씨가 옮겨가는" 부재를 조립된 프롬프트에서 검사한다.

- [ ] **Step 1: 문자열 교체**

`lib/etf/narrative-angle.ts`:
- 25행 `어떻게 옮겨붙는지를 따라간다` → `어떻게 반영되는지를 따라간다`
- 27행 `부담이라는 두 얼굴을 동시에 풀어낸다` → `부담이라는 상반된 효과를 함께 풀어낸다`

`lib/etf/morning-strategy.ts` 236행:
- `'나스닥이 강해도 SOXX가 따라오지 않으면, 국내 반도체 ETF로 불씨가 옮겨가는 힘은 제한적입니다.'`
- → `'나스닥이 강해도 SOXX가 따라오지 않으면, 국내 반도체 ETF로 이어지는 힘은 제한적입니다.'`

168·192행의 "핵심 입력"은 바꾸지 않는다(`interpretation` 필드는 프롬프트·화면에 쓰이지 않음 — 설계서 문제 5).

- [ ] **Step 2: 잔존 확인**

Run: `grep -rn "옮겨붙\|두 얼굴\|불씨가 옮겨" lib/etf --include=*.ts | grep -v "\.test\.ts"`
Expected: 출력 없음(주석 11행 `옮겨가는지`는 grep 패턴에 걸리지 않는다)

- [ ] **Step 3: 관련 테스트 통과 확인**

Run: `npx tsx --test lib/etf/*.test.ts`
Expected: 모두 pass

- [ ] **Step 4: Commit**

```bash
git add lib/etf/narrative-angle.ts lib/etf/morning-strategy.ts
git commit -m "ETF 입력 문구 중립화 — '옮겨붙'·'두 얼굴'·'불씨가 옮겨가는' 어휘 에코 제거

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: ETF 프롬프트 — 제목 정책 한 블록 + 시스템 예외 + 테스트

**Files:**
- Modify: `lib/etf/claude-client.ts` (23-50 시스템 프롬프트, 174 `buildMorningPrompt`, 322-366 헤드라인 관련, 402)
- Modify: `lib/etf/etf-mode.ts:126,133` (모드별 헤드라인 줄을 통합 블록 참조로)
- Create: `lib/etf/claude-client.prompt.test.ts`

**Interfaces:**
- Consumes: `renderVoiceExemplars('etf')`(Task 2), ETF 요일 리듬(Task 3), ETF 시점 블록(Task 4), 중립화된 문구(Task 5)
- Produces: `export const SYSTEM_PROMPT: string`, `export function buildMorningPrompt(data: CollectedData): string` (동작 불변, export만 추가)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// lib/etf/claude-client.prompt.test.ts
// 묶음 3(2026-09-30): 조립된 ETF 프롬프트가 통합 제목 정책을 담고, 제거한 옛 지시가 없는지.
// 픽스처의 최근 헤드라인·뉴스는 금지 문구가 없는 값으로만 채운다(입력 인용 구간 오탐 방지).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildMorningPrompt } from './claude-client'
import { getMarketCalendarInfo } from '../market-calendar'
import type { CollectedData, MacroContext } from './types'

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
  assert.match(p, /tier 는 강도만 정합니다/)
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
  assert.doesNotMatch(p, /\[최근 ETF 리포트 헤드라인 — 절대/)
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
  assert.match(p, /최근 ETF 리포트 헤드라인\]에 이미 등장했으면/) // 조건부 참조 문구는 "있을 때" 규칙으로 유지
})

test('ETF 시스템 프롬프트: ETF 예시 세트 + 본문 규칙의 제목 예외 표기', () => {
  assert.ok(SYSTEM_PROMPT.includes('원화, 하루 만에 20원 되찾다'))
  assert.ok(!SYSTEM_PROMPT.includes('금리 올린 연준, 달러만 웃었다'))
  assert.match(SYSTEM_PROMPT, /격식체 사용 \("~입니다", "~습니다"\) \(cover\.headline 제외/)
  assert.match(SYSTEM_PROMPT, /도치를 허용합니다\. \(cover\.headline 제외/)
})

test('국내 ETF 6자리 코드 규칙에 제목 예외 표기', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.match(p, /"종목명 \(6자리 코드\)"로 표기하십시오\. \(cover\.headline 제외 — \[cover\.headline 작성 규칙\] 참조\)/)
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/etf/claude-client.prompt.test.ts`
Expected: FAIL (`SYSTEM_PROMPT`/`buildMorningPrompt` export 없음)

- [ ] **Step 3: export 추가**

- `lib/etf/claude-client.ts:23` `const SYSTEM_PROMPT =` → `export const SYSTEM_PROMPT =`
- `:174` `function buildMorningPrompt(` → `export function buildMorningPrompt(`
- 주석 한 줄을 각 선언 위에 추가: `// export: 프롬프트 조립 테스트용(claude-client.prompt.test.ts). 동작 불변.`

- [ ] **Step 4: 시스템 프롬프트 예외 표기 + ETF 예시 호출**

`lib/etf/claude-client.ts` 시스템 프롬프트에서:
- `- 격식체 사용 ("~입니다", "~습니다")` → `- 격식체 사용 ("~입니다", "~습니다") (cover.headline 제외 — [cover.headline 작성 규칙] 참조)`
- `…글의 흐름이 자연스러우면 도치를 허용합니다.` → `…글의 흐름이 자연스러우면 도치를 허용합니다. (cover.headline 제외 — [cover.headline 작성 규칙] 참조)`
- `${renderVoiceExemplars()}` → `${renderVoiceExemplars('etf')}`

402행:
- `- 국내 ETF는 반드시 "종목명 (6자리 코드)"로 표기하십시오.` → `- 국내 ETF는 반드시 "종목명 (6자리 코드)"로 표기하십시오. (cover.headline 제외 — [cover.headline 작성 규칙] 참조)`
  (같은 줄의 뒷부분 `"122630.KS KODEX 레버리지"나 … 금지입니다.`는 그대로 둔다.)

- [ ] **Step 5: 최근 헤드라인 블록 교체 (322-329행 부근)**

다음 두 줄:
```
위 문장들과 3어절 이상 겹치거나 같은 구문 틀("~가 ~로 이어지는지", "~신호를 ~로 확인" 등)을 재사용하지 마십시오.
또한 최근 헤드라인에서 **눈에 띄는 단어·동사도 반복하지 마십시오** — 특히 근래 여러 날 반복돼 온 "역주행/역방향"을 그대로 다시 쓰지 말고, 상황에 맞게 "홀로 하락·나 홀로 약세·반대로 움직임·엇갈림·거꾸로" 등 뜻이 통하는 다른 표현으로 변주하십시오.
```
를 다음 한 줄로 교체:
```
위 문장들과 3어절 이상 겹치거나 같은 구문 틀("~가 ~로 이어지는지", "~신호를 ~로 확인" 등)을 재사용하지 마십시오. 최근 헤드라인에서 눈에 띄는 핵심 단어·동사도 반복하지 마십시오.
```

- [ ] **Step 6: 헤드라인 규칙 블록 교체**

`[cover.headline 작성 규칙 — tier 종속 (위 [오늘의 근거 상태] 참조)]` 줄부터 `- 위 [최근 ETF 리포트 헤드라인] 블록의 문장 구조·핵심 단어 조합을 재사용하지 마십시오.` 줄까지(현 349~365행)를 다음으로 교체한다. 바로 뒤의 빈 줄과 `- cover.subline은 결론과 제약 조건을 함께 담습니다.` 이하는 그대로 둔다.

```
[cover.headline 작성 규칙]

이 헤드라인은 개장 전 한국 개인투자자가 가장 먼저 만나는 한 줄이며, 렌더 시 "오늘의 초점 · " 뒤에 붙는 표제어입니다. 한국 신문 편집자가 쓰듯 씁니다.

1. 형태 (모든 tier 공통)
- 주어·핵심 사실을 앞세워 한 호흡으로 씁니다. 정확한 등락률·티커는 cover.subline 이 받칩니다.
- 제목에는 티커·6자리 코드 대신 한국어 명칭을 씁니다 (예: SOXX → 미 반도체, GDX → 금광주, TLT → 미 장기채).
- 등락률·티커를 제목 맨 앞 앵커로 두지 마십시오. 사건의 규모를 전하는 수치 하나(20원·45조·성장률 3.5% 상향 등)는 문장 안에 둘 수 있고, 코스피 7,000·환율 1,500원 같은 심리적 분기점 숫자는 앞에 와도 됩니다.

2. 종결
- 기사체 '~다' 또는 서술성 명사(급등·반등·마감·경신·진입·본격화 등)로 끝냅니다.
- '~다'는 짧은 기사체 술어로 씁니다(되찾다·버텼다·무너졌다). 목적어·부사가 늘어진 산문 문장은 표제어가 아닙니다.
- 피할 형태: 시간명사 종결("~한 날", "~한 밤", "~한 하루", "~한 주말", "~한 금요일"), "~ 다음 날,"로 시작하는 틀, 존댓말 '~습니다', 체크리스트형 어미("확인", "점검", "~해야").

3. tier 는 강도만 정합니다 (위 [오늘의 근거 상태] 참조 — 블록이 없으면 thin)
- strong: 오늘의 지배적 서사(서사 앵글 + 최상위 catalyst)에서 길어올린 신선한 은유와 단정을 허용합니다.
- thin: 형태는 같고, 은유는 절제하고 단정은 자제합니다.
- hollow: 사실 모드. 은유를 만들지 않고 절제된 사실로 씁니다. catalyst 반영 의무는 없습니다.

4. 그 밖의 규칙
- catalyst 반영 (기본 + 예외): strong·thin 에서 [🔥 오늘의 forward catalyst] 항목이 있으면 사건을 근거로 반영합니다. [반복 회피 — 기본보다 우선] 같은 catalyst·anchor 가 [최근 ETF 리포트 헤드라인]에 이미 등장했으면 (a) 사건의 국면·단계를 다르게(진전→타결→후속/확산/정착) 쓰거나 (b) anchor 를 subline 으로 내리고 새 각도(환율·금·은·원유·국내 ETF 등 오늘 의미 있게 움직인 지표)로 씁니다.
- 시장 특정: "지수/시장/증시" 단독 표기 금지. 어느 시장인지 명시합니다(S&P500·나스닥·코스피 등 구체 명칭, 또는 "미·국내·채권" 수식어).
- 길이: 14~26자 권장, 최대 28자. 프리뷰는 3줄까지만 깔끔히 렌더되므로 보조 수치·맥락은 subline 으로 넘깁니다.
- 본문 payoff: narrativeNotes.bigPicture 첫 부분이 헤드라인의 이미지를 받아 전개하되, 헤드라인 문장을 그대로 되풀이하지 않습니다.
```

- [ ] **Step 6b: 모드별 헤드라인 줄을 통합 블록 참조로**

`lib/etf/etf-mode.ts`의 `describeEtfModeForPrompt`에서:
- event(126행): `- 헤드라인은 [제목 작성 규칙]을 따르되, 사건의 무게가 즉시 전달되도록 씁니다 (수치만 나열 지양).`
  → `- 헤드라인은 [cover.headline 작성 규칙]을 따르되, 사건의 무게가 즉시 전달되도록 씁니다 (수치만 나열 지양).`
- quiet(133행): `- 헤드라인은 차분한 톤. 횡보 자체를 명시하는 것도 좋음.`
  → `- 헤드라인은 [cover.headline 작성 규칙]을 따르되 차분한 톤으로. 횡보 자체를 명시하는 것도 좋음.`

(`[제목 작성 규칙]`은 ETF 프롬프트에 없는 이름이다 — 마켓 프롬프트의 블록 이름이 섞여 들어온 깨진 참조.)

- [ ] **Step 7: 잔존 옛 지시 grep**

Run: `grep -n "앵커(수치·티커)\|반드시 명사구\|홀로 하락\|반도체 6% 붕괴\|tier 종속" lib/etf/claude-client.ts; grep -n "\[제목 작성 규칙\]" lib/etf/*.ts`
Expected: 출력 없음. 다른 곳(`catalyst` 블록 끝 `헤드라인 반영 여부·방식은 아래 [cover.headline 작성 규칙]을 따르십시오`)의 참조 이름이 새 블록 제목과 일치하는지 확인한다(`grep -n "cover.headline 작성 규칙" lib/etf/claude-client.ts`).

- [ ] **Step 8: 통과 확인**

Run: `npx tsx --test lib/etf/claude-client.prompt.test.ts lib/etf/claude-client.macro.test.ts lib/etf/etf-mode.test.ts lib/market-prompt-freeze.test.ts`
Expected: 모두 pass

- [ ] **Step 9: Commit**

```bash
git add lib/etf/claude-client.ts lib/etf/etf-mode.ts lib/etf/claude-client.prompt.test.ts
git commit -m "ETF 제목 정책을 한 블록으로 통합 — thin 앵커 앞세움·명사구 계약·대안 단어 나열 제거, 본문 규칙에 제목 예외 표기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 전체 검증 + 격리 평가 (발송 없음)

**Files:** 없음(검증만). 격리 worktree는 스크래치패드에 만들고 삭제한다.

- [ ] **Step 1: 전체 테스트와 타입 검사**

Run: `npx tsx --test $(git ls-files '*.test.ts') && npx tsc --noEmit`
Expected: 전부 pass, tsc 출력 없음. 기준선(main): 154+ pass.

- [ ] **Step 2: 일회용 worktree 생성 (새 경로·커밋 고정·실패 시 중단)**

```bash
set -euo pipefail
cd /Users/yalkongs/Project/dailyreport
test -z "$(git status --porcelain --untracked-files=no)"          # 커밋 안 된 변경이 있으면 중단
REV=$(git rev-parse feat/etf-headline-consolidation)
WT=$(mktemp -d /private/tmp/claude-501/-Users-yalkongs-Project-dailyreport/2d0159af-6c5a-4c01-b37d-ab59ce222806/scratchpad/etf-eval.XXXX)
rmdir "$WT"
git worktree add --detach "$WT" "$REV"
ln -s /Users/yalkongs/Project/dailyreport/node_modules "$WT/node_modules"
echo "WT=$WT REV=$REV"
```

격리는 파일 출력에 대한 것이다. worktree 추가·삭제는 저장소 관리 정보를 건드리고, `node_modules`는 본 작업 트리를 공유한다(읽기 전용으로 쓰인다).

- [ ] **Step 3: 격리 생성 1회 (종료 코드 확인)**

```bash
set -uo pipefail
cd "$WT"
set -a; source /Users/yalkongs/Project/dailyreport/.env.local; set +a
test -n "${ANTHROPIC_API_KEY:-}" || { echo "ANTHROPIC_API_KEY 없음 — 중단"; exit 1; }
[ -n "${KRX_AUTH_KEY:-}" ] || echo "주의: KRX_AUTH_KEY 없음 — 국내 NAV·괴리율 없이 생성됨(운영과 다름)"
FORCE_REGENERATE=true npx tsx scripts/run-etf.ts > "$WT.log" 2>&1; echo "exit=$?"
grep -E "근거 tier|ETF 모드|회 실패|fallback|soft-warn|KRX BAS_DD" "$WT.log"
```

Expected: `exit=0`. 0이 아니면 로그 끝 40줄을 보고 판독을 멈춘다. run-etf에는 git·Telegram·배포 호출이 없다(발송은 워크플로 step 몫, `scripts/run-etf.ts:222-268`). 출력은 `process.cwd()` 기준이라 worktree에만 남는다. 한국 휴장일에는 `FORCE_REGENERATE`로도 생성하지 않는다(`:93-103`). 휴장일이면 다음 거래일에 실행한다.

2회 실행은 하지 않는다. 첫 실행이 렌즈·앵글 기록을 갱신하고 선택이 무작위라 두 번째 실행은 같은 조건의 반복이 아니다. 제목 변동성은 2주 관찰로 본다.

- [ ] **Step 4: 결과 판독 기록**

```bash
cd "$WT"
DATE=$(TZ=Asia/Seoul date +%F)
HTML=$(ls -t public/etf-reports/*${DATE}*.html | head -1); ls -l "$HTML"      # 방금 생성됐는지 시각 확인
node -e 'const i=require("./data/etf-reports-index.json");const r=(i.reports||i).find(x=>x.date===process.argv[1]);console.log(r&&r.headline)' "$DATE"
grep -oE "[0-9]{4}-[0-9]{2}-[0-9]{2}" "$HTML" | sort | uniq -c              # ISO 날짜(메타·URL 포함 — 본문 여부는 문맥 확인)
grep -cE "옮겨붙|두 얼굴|거꾸로|홀로|뒷걸음" "$HTML" || true
```

HTML에서 서브라인과 bigPicture를 읽는다(인덱스에는 헤드라인만 있다). 다음을 표로 기록한다(보고용, 파일 커밋 없음): 제목, 서브라인, ① 티커/등락률 앞세움 여부, ② 시간명사 종결 여부, 본문·서브라인의 ISO 날짜, 에코 문구, 1회차 품질 검증 통과 여부, tier·모드.

- [ ] **Step 5: worktree 삭제**

```bash
cd /Users/yalkongs/Project/dailyreport && git worktree remove --force "$WT" && git worktree prune && rm -f "$WT.log" && git status --short
```
Expected: 작업 트리 변경 없음.

- [ ] **Step 6: Codex 최종 점검(읽기 전용) → 결과 재검증 → 사용자 보고**

`main...feat/etf-headline-consolidation` diff를 Codex(`--model gpt-6-astra`, 읽기 전용)에 맡긴다. 확인 사항: market 불변, ETF 프롬프트 모순 잔존, 검증기 충돌. 지적은 코드로 재검증해 반영 여부를 정한다. 머지·push는 사용자 승인 후에 한다(다음 거래일 08:15 ETF가 첫 적용).

---

## Self-Review 결과

- 설계서 섹션 1 → Task 6(블록·예외·최근 헤드라인), Task 3(요일 리듬). 섹션 2 → Task 2. 섹션 3 → Task 5. 섹션 4 → Task 4. 섹션 5 → Task 1(불변 픽스처)·각 Task 테스트·Task 7(격리 평가·Codex). 2주 관찰은 배포 후 운영 과제(메모리 기록).
- Review Focus 5항목은 각각 Task 4(1·2), Task 1+3(3), Task 6(4·5)의 테스트로 고정했다.
- 이름 일관성: `readerPhrase`, `renderVoiceExemplars(target)`, `ETF_HEADLINE_EXEMPLARS`, `ETF_ANTI_PATTERN_EXAMPLES`, `SYSTEM_PROMPT`, `buildMorningPrompt`.
