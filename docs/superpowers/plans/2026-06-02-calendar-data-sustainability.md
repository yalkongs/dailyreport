# 캘린더 데이터 정확성·지속가능성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 휴일 캘린더를 연도별 구조로 바꾸고, 현재 연도 데이터가 없으면 `exit(1)`로 발송을 막아 조용한 오발송을 방지한다.

**Architecture:** `lib/market-calendar.ts`의 단일 연도 배열(`KR_HOLIDAYS_2026`/`US_HOLIDAYS_2026`)을 `Record<number, Holiday[]>`로 재구조화한다. 순수 함수 `isYearCovered(year, market)`를 추가하고, `scripts/run.ts`·`scripts/run-etf.ts`가 KST 날짜 확보 직후 KR 연도 커버리지를 확인해 없으면 `process.exit(1)`(→ GitHub 스케줄 실패 → 자동 이메일), US 누락은 `console.warn`만 한다. `market-calendar.ts`는 순수 유지(I/O 없음).

**Tech Stack:** TypeScript, `tsx` 실행, `node:test` + `node:assert/strict` (프로젝트 기존 테스트 관행, CI 테스트 스텝 없음·수동 실행).

**Spec:** [docs/superpowers/specs/2026-06-02-calendar-data-sustainability-design.md](../specs/2026-06-02-calendar-data-sustainability-design.md)

---

## File Structure

- `lib/market-calendar.ts` (modify) — 휴일 데이터 `Record<number, Holiday[]>` 재구조 + `getKrStatus`/`getUsStatus` 조회 수정 + `isYearCovered` export 추가. 순수 함수 모듈 유지.
- `lib/market-calendar.test.ts` (create) — 2026 휴장일 회귀 + `isYearCovered` 단위 테스트.
- `scripts/run.ts` (modify) — market 파이프라인 안전망(커버리지 체크 → exit).
- `scripts/run-etf.ts` (modify) — ETF 파이프라인 안전망.

브랜치: `calendar-timezone-fixes` (이미 체크아웃됨). 워크플로 변경 없음.

---

## Task 1: 현재 2026 동작 회귀 테스트 (refactor 안전망)

리팩터 전에 현재의 올바른 동작을 테스트로 고정한다. 이 테스트들은 **현재 코드에서 통과**해야 하며, Task 2 리팩터 후에도 계속 통과해야 한다(behavior-preserving 보증).

**Files:**
- Test: `lib/market-calendar.test.ts` (create)

- [ ] **Step 1: 테스트 파일 작성**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getMarketCalendarInfo } from "./market-calendar";

// 2026 KR 휴장일 — 핫픽스 추가분 포함 전수
const KR_CLOSED_2026 = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02",
  "2026-05-01", "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17",
  "2026-08-17", "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09",
  "2026-12-25", "2026-12-31",
];

test("2026 KR 휴장일은 closed_holiday", () => {
  for (const d of KR_CLOSED_2026) {
    assert.equal(getMarketCalendarInfo(d).krStatus, "closed_holiday", `${d} 휴장이어야 함`);
  }
});

test("2026 정상 영업일은 open", () => {
  // 평일·비휴일: 06-02(화), 06-04(목), 06-05(금)
  for (const d of ["2026-06-02", "2026-06-04", "2026-06-05"]) {
    assert.equal(getMarketCalendarInfo(d).krStatus, "open", `${d} 영업일이어야 함`);
  }
});

test("2026 US 휴장일은 usStatus closed_holiday (예: MLK 01-19)", () => {
  assert.equal(getMarketCalendarInfo("2026-01-19").usStatus, "closed_holiday");
});

test("주말은 closed_weekend (양국)", () => {
  // 2026-06-06 토, 06-07 일
  assert.equal(getMarketCalendarInfo("2026-06-06").krStatus, "closed_weekend");
  assert.equal(getMarketCalendarInfo("2026-06-07").usStatus, "closed_weekend");
});
```

- [ ] **Step 2: 테스트 실행 — 현재 코드에서 통과 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: 4 tests PASS (현재 핫픽스된 데이터 기준 전부 통과).

- [ ] **Step 3: 커밋**

```bash
git add lib/market-calendar.test.ts
git commit -m "test: 2026 캘린더 휴장일 회귀 테스트 (refactor 안전망)"
```

---

## Task 2: 휴일 데이터 `Record<number, Holiday[]>` 재구조

데이터를 연도별 맵으로 바꾸고 조회 로직을 수정한다. Task 1 테스트가 계속 통과하면 behavior-preserving 성공.

**Files:**
- Modify: `lib/market-calendar.ts:43-90` (데이터·맵), `lib/market-calendar.ts:113-127` (getKrStatus/getUsStatus)

- [ ] **Step 1: 데이터 블록 교체 (`:43-90`)**

`lib/market-calendar.ts`에서 `// 한국 (KRX) 휴일 ...` 주석부터 `const US_HOLIDAY_MAP = ...` 줄까지(현재 43~90행)를 아래로 교체:

```ts
// 한국 (KRX) 휴일 — 음력/선거/임시공휴일은 계산 불가하므로 매년 연말
// 공식 KRX 휴장 공고로 다음 해를 추가한다. 연 추가 = 아래 맵에 `2027: [...]` 키 추가.
// 데이터 없는 연도는 isYearCovered()가 false → 파이프라인이 exit(1)로 발송을 막는다.
//
// 2026 출처 교차검증: calendarlabs KRX 2026 + 서울경제 2026 증시 휴장 보도.
const KR_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "신정" },
    // 설날: 음력 1/1 = 양력 2026-02-17 (화)
    { date: "2026-02-16", name: "설날 연휴 (전일)" },
    { date: "2026-02-17", name: "설날" },
    { date: "2026-02-18", name: "설날 연휴 (익일)" },
    // 삼일절 3/1 일요일 → 3/2 대체공휴일
    { date: "2026-03-02", name: "삼일절 대체공휴일" },
    { date: "2026-05-01", name: "근로자의 날" },
    { date: "2026-05-05", name: "어린이날" },
    // 부처님오신날: 음력 4/8 = 양력 2026-05-24 (일) → 5/25 대체공휴일
    { date: "2026-05-25", name: "부처님오신날 대체공휴일" },
    { date: "2026-06-03", name: "제9회 전국동시지방선거" },
    { date: "2026-07-17", name: "제헌절" },
    // 광복절 8/15 토요일 → 8/17 대체공휴일
    { date: "2026-08-17", name: "광복절 대체공휴일" },
    // 추석: 음력 8/15 = 양력 2026-09-25 (금). 9/24~26 연휴 (대체 없음 — 토요일은 대체 X)
    { date: "2026-09-24", name: "추석 연휴 (전일)" },
    { date: "2026-09-25", name: "추석" },
    // 개천절 10/3 토요일 → 10/5 대체공휴일
    { date: "2026-10-05", name: "개천절 대체공휴일" },
    { date: "2026-10-09", name: "한글날" },
    { date: "2026-12-25", name: "성탄절" },
    { date: "2026-12-31", name: "KRX 연말 폐장일" },
  ],
};

// 미국 (NYSE) 휴일 — 규칙(n번째 월요일·observed)으로 매년 도출 가능하나,
// 현재는 정적 유지. 연 추가 = `2027: [...]` 키 추가.
const US_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-01-19", name: "Martin Luther King Jr. Day" },  // 1월 셋째 월요일
    { date: "2026-02-16", name: "Presidents' Day" },              // 2월 셋째 월요일
    { date: "2026-04-03", name: "Good Friday" },                  // Easter 4/5 의 전 금요일
    { date: "2026-05-25", name: "Memorial Day" },                 // 5월 마지막 월요일
    { date: "2026-06-19", name: "Juneteenth" },
    { date: "2026-07-03", name: "Independence Day (observed)" },  // 7/4가 토요일 → 7/3 관측
    { date: "2026-09-07", name: "Labor Day" },                    // 9월 첫 월요일
    { date: "2026-11-26", name: "Thanksgiving" },                 // 11월 넷째 목요일
    { date: "2026-12-25", name: "Christmas" },
    // 조기 폐장(11/27, 12/24)은 종가 있으므로 정상 영업일 처리.
  ],
};

function lookupHoliday(table: Record<number, Holiday[]>, date: string): string | undefined {
  const year = Number(date.slice(0, 4));
  return table[year]?.find(h => h.date === date)?.name;
}
```

> 참고: 기존 `KR_HOLIDAY_MAP`/`US_HOLIDAY_MAP`(Map) 두 줄은 위 교체로 제거된다.
> `interface Holiday`(현재 `:38-41`)는 그대로 둔다.

- [ ] **Step 2: `getKrStatus` 수정 (`:113-119`)**

`KR_HOLIDAY_MAP.get(date)` 사용부를 `lookupHoliday`로 교체:

```ts
function getKrStatus(date: string): { status: MarketStatus; name?: string } {
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { status: "closed_weekend" };
  const name = lookupHoliday(KR_HOLIDAYS, date);
  if (name) return { status: "closed_holiday", name };
  return { status: "open" };
}
```

- [ ] **Step 3: `getUsStatus` 수정 (`:121-127`)**

```ts
function getUsStatus(date: string): { status: MarketStatus; name?: string } {
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return { status: "closed_weekend" };
  const name = lookupHoliday(US_HOLIDAYS, date);
  if (name) return { status: "closed_holiday", name };
  return { status: "open" };
}
```

- [ ] **Step 4: Task 1 테스트로 behavior-preserving 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: 4 tests PASS (리팩터 전과 동일 — 동작 보존됨).

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add lib/market-calendar.ts
git commit -m "refactor: 휴일 데이터를 Record<year,Holiday[]>로 재구조 (behavior-preserving)"
```

---

## Task 3: `isYearCovered` 커버리지 함수 (TDD)

**Files:**
- Test: `lib/market-calendar.test.ts` (modify — 테스트 추가)
- Modify: `lib/market-calendar.ts` (export 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

`lib/market-calendar.test.ts` 상단 import에 `isYearCovered`를 추가하고(`import { getMarketCalendarInfo, isYearCovered } from "./market-calendar";`), 파일 끝에 추가:

```ts
test("isYearCovered: 2026은 양국 모두 true", () => {
  assert.equal(isYearCovered(2026, "kr"), true);
  assert.equal(isYearCovered(2026, "us"), true);
});

test("isYearCovered: 데이터 없는 연도는 false", () => {
  assert.equal(isYearCovered(2099, "kr"), false);
  assert.equal(isYearCovered(2099, "us"), false);
});
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: 새 테스트 FAIL — `isYearCovered is not a function` / import 에러.

- [ ] **Step 3: `isYearCovered` 구현**

`lib/market-calendar.ts`의 `getMarketCalendarInfo` export 근처(또는 status 함수들 아래)에 추가:

```ts
/**
 * 해당 연도의 휴일 데이터가 존재하는지. false면 데이터가 낡은 것 —
 * 호출 측(run.ts/run-etf.ts)이 발송을 막고 exit(1)을 내야 한다.
 */
export function isYearCovered(year: number, market: "kr" | "us"): boolean {
  const table = market === "kr" ? KR_HOLIDAYS : US_HOLIDAYS;
  return table[year] !== undefined;
}
```

- [ ] **Step 4: 실행 → 통과 확인**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/market-calendar.ts lib/market-calendar.test.ts
git commit -m "feat: isYearCovered — 연도 휴일 데이터 커버리지 판정"
```

---

## Task 4: market 파이프라인 안전망 — `scripts/run.ts`

KST 날짜 확보 직후(중복 가드 이전), KR 연도 미커버면 발송을 막고 `exit(1)`.

**Files:**
- Modify: `scripts/run.ts:11` (import), `scripts/run.ts:135-137` 직후 (안전망 삽입)

- [ ] **Step 1: import에 `isYearCovered` 추가 (`:11`)**

```ts
import { getMarketCalendarInfo, describeMarketCalendar, isYearCovered } from "../lib/market-calendar";
```

- [ ] **Step 2: 안전망 블록 삽입**

`const marketData = await collectAllMarketData();`(현재 `:135`)와 그 다음 `console.log();` 직후, 중복 가드(`Step 1a`) **이전**에 삽입:

```ts
  // Step 1-guard: 휴일 데이터 커버리지 — 데이터가 낡으면(연도 미커버) 조용한 오발송
  // 대신 큰 소리로 실패한다. exit(1) → GitHub 스케줄 실패 → repo 소유자 자동 이메일.
  // (정상 휴장 skip은 아래 Step 1c에서 exit(0) — exit 코드로 구분된다.)
  {
    const year = Number(marketData.date.slice(0, 4));
    if (!isYearCovered(year, "kr")) {
      console.error(`❌ ${year}년 KR 휴일 데이터 없음 — lib/market-calendar.ts 갱신 필요. 안전을 위해 발송 중단.`);
      process.exit(1);
    }
    if (!isYearCovered(year, "us")) {
      console.warn(`⚠️ ${year}년 US 휴일 데이터 없음 — 미국 휴장 가드레일 저하(별 sub-project B). 발송은 계속.`);
    }
  }
```

- [ ] **Step 3: 타입 체크 + 정상 연도 동작 불변 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

Run (정상 연도가 통과하는지 — dry, 네트워크 발생): `DISABLE_CONTEXT=true npx tsx scripts/run.ts` 를 짧게 띄워 "Step 1a 중복 실행 방지 체크" 로그까지 도달하는지 확인(2026이므로 커버리지 통과). 또는 시간이 걸리면 Step 4의 단위 근거로 대체.
Expected: 커버리지 단계에서 멈추지 않고 진행(2026 커버됨).

- [ ] **Step 4: 안전망 발동 스모크 (미커버 연도)**

Run: `TEST_DATE=2099-01-05 npx tsx scripts/run.ts; echo "exit=$?"`
Expected: 실시간 데이터 수집(~수십 초, Yahoo 등 — TEST_DATE는 라벨만 바꿀 뿐 수집은 정상)이 먼저 돈 뒤 `❌ 2099년 KR 휴일 데이터 없음 …` 출력, 이어서 `exit=1`. (`TEST_DATE`는 `market-data.ts:199` `getEffectiveDate`가 인식해 `marketData.date`에 반영. run.ts는 날짜가 수집 결과에서 나오므로 체크가 수집 뒤에 위치 — run-etf와의 의도된 비대칭.)

- [ ] **Step 5: 커밋**

```bash
git add scripts/run.ts
git commit -m "feat: market 파이프라인 휴일 데이터 커버리지 안전망 (미커버 시 exit 1)"
```

---

## Task 5: ETF 파이프라인 안전망 — `scripts/run-etf.ts`

**Files:**
- Modify: `scripts/run-etf.ts:23` (import), `scripts/run-etf.ts:54` 직후 (안전망 삽입)

- [ ] **Step 1: import에 `isYearCovered` 추가 (`:23`)**

```ts
import { getMarketCalendarInfo, describeMarketCalendar, isYearCovered } from '../lib/market-calendar'
```

- [ ] **Step 2: 안전망 블록 삽입**

`date` 계산 직후(`console.log(\`\n=== ETF Morning Pipeline ...\`)` 다음, 현재 `:54`)와 중복 가드(`Step 0`) **이전**에 삽입:

```ts
  // 휴일 데이터 커버리지 안전망 — run.ts와 동일 정책. 미커버 = 데이터 낡음 → exit(1).
  // 정상 휴장 skip(아래 krStatus !== 'open')은 return → exit(0)으로 구분된다.
  {
    const year = Number(date.slice(0, 4))
    if (!isYearCovered(year, 'kr')) {
      console.error(`❌ ${year}년 KR 휴일 데이터 없음 — lib/market-calendar.ts 갱신 필요. 안전을 위해 ETF 발송 중단.`)
      process.exit(1)
    }
    if (!isYearCovered(year, 'us')) {
      console.warn(`⚠️ ${year}년 US 휴일 데이터 없음 — 미국 휴장 가드레일 저하(별 sub-project B). 발송은 계속.`)
    }
  }
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 안전망 발동 스모크 (미커버 연도)**

Run: `ETF_REPORT_DATE=2099-01-05 npx tsx scripts/run-etf.ts; echo "exit=$?"`
Expected: `❌ 2099년 KR 휴일 데이터 없음 …` 출력 후 `exit=1`. (`ETF_REPORT_DATE`는 `run-etf.ts:49`가 인식 — date override.)

- [ ] **Step 5: 커밋**

```bash
git add scripts/run-etf.ts
git commit -m "feat: ETF 파이프라인 휴일 데이터 커버리지 안전망 (미커버 시 exit 1)"
```

---

## Task 6: 2026 07-17 재확인 + 연 갱신 절차 문서화

핫픽스가 추가한 07-17 제헌절은 국내 금융지 보도 기준이었다. 공식 출처로 확정하고, 연 갱신 절차를 코드 주석으로 남긴다.

**Files:**
- Modify: `lib/market-calendar.ts` (07-17 주석 정리 — Task 2에서 이미 "재확인 필요" 문구는 제거됨; 여기선 확정 결과 반영)

- [ ] **Step 1: 07-17 제헌절 2026 KRX 휴장 여부 공식 확인**

WebSearch/WebFetch로 KRX 공식 2026 휴장 공고(또는 증권사 재공지)에서 `2026-07-17` 휴장 여부 확인.
- 휴장 확정이면: 데이터 유지. 코드 주석에 출처 1줄 갱신.
- 휴장 아님으로 밝혀지면: `KR_HOLIDAYS[2026]`에서 `2026-07-17` 항목 제거 + Task 1 회귀 테스트의 `KR_CLOSED_2026` 배열에서도 제거.

Expected: 확정 결과 1줄 기록 (예: "2026-07-17 제헌절 — KRX 휴장 확정, 출처: …").

- [ ] **Step 2: 연 갱신 절차 주석이 명확한지 확인**

`lib/market-calendar.ts`의 `KR_HOLIDAYS` 위 주석(Task 2에서 작성)에 "매년 연말 공식 KRX 공고로 다음 해 추가, 데이터 없으면 isYearCovered→exit(1)" 절차가 들어있는지 확인. 누락 시 보강.

- [ ] **Step 3: 07-17 변경이 있었다면 테스트 재실행**

Run: `npx tsx --test lib/market-calendar.test.ts`
Expected: 전부 PASS.

- [ ] **Step 4: 커밋 (변경이 있을 때만)**

```bash
git add lib/market-calendar.ts lib/market-calendar.test.ts
git commit -m "chore: 2026 제헌절(07-17) 공식 출처 확정 + 연 갱신 절차 주석"
```

---

## 최종 검증

- [ ] **전체 테스트**: `npx tsx --test lib/market-calendar.test.ts` → 6 tests PASS
- [ ] **기존 테스트 회귀 없음**: `npx tsx --test lib/*.test.ts lib/etf/*.test.ts` (또는 프로젝트 관행대로) → 통과
- [ ] **타입 체크**: `npx tsc --noEmit` → 에러 없음
- [ ] **안전망 양 파이프라인**: `TEST_DATE=2099-01-05 npx tsx scripts/run.ts; echo $?` 및 `ETF_REPORT_DATE=2099-01-05 npx tsx scripts/run-etf.ts; echo $?` 모두 exit 1
- [ ] **정상 동작 불변**: 2026 휴장일 skip(exit 0)·영업일 진행 — Task 1 테스트로 보증됨

## 비범위 (별 sub-project)

B(가드레일 US 하루어긋남·KR 대칭·EU/JP/CN), C(신선도 태깅), D(FRED 쿼리), E(getDay 하드닝), F(운영자 Telegram 알림). 본 계획은 워크플로(.github)를 변경하지 않는다.
