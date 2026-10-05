# 정책금리 사실 블록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마켓 리포트 프롬프트에 연준·한은 정책금리의 현재 수준, 최근·직전 변경, 국면 라벨을 데이터로 주입한다. 그래서 모델이 금리 국면을 추론하지 않고 입력에서 읽게 한다.

**Architecture:** 새 모듈 `lib/policy-rate.ts`가 네 가지를 맡는다.
- 수집: FRED `DFEDTARU`/`DFEDTARL`, ECOS `722Y001/0101000` 일별 3년치
- 요약: 순수 함수로 변경점을 찾고 국면 라벨을 붙인다
- 렌더: 프롬프트 블록 문자열과 규칙 문구
- 측정: soft-warn 판정

`context-data.ts`가 수집을 연결하고, `claude-client.ts`는 렌더 결과와 규칙 문구를 끼워 넣는다. 테스트는 `claude-client.ts`를 import하지 않는다. import 시점에 `new Anthropic()`을 실행하기 때문이다. 그래서 문자열 로직을 모두 `policy-rate.ts`에 둔다.

**Tech Stack:** TypeScript, tsx, `node:test`/`node:assert/strict`(`npx tsx --test`)

**Spec:** `docs/superpowers/specs/2026-10-05-policy-rate-block-design.md`

## Global Constraints

- 범위는 마켓 리포트만이다. `lib/etf/**`는 건드리지 않는다(묶음 3 관찰 중).
- 기존 `fredIndicators`(FEDFUNDS 월평균 등)는 제거하지 않는다.
- ECOS 월별(M) 주기는 쓰지 않는다. 일별(D)만 쓰고 `list_total_count`를 보며 페이지를 이어 받는다.
- 이력 신뢰성 기준
  - 첫 유효 관측이 조회 시작일보다 30일 넘게 늦으면 `null`
  - 유효 관측 간격이 7일을 넘은 직후에 값이 바뀌면 `null`
  - 마지막 관측이 오늘보다 7일 넘게 오래되면 `null`
- 국면 경계는 365일이다. 마지막 변경 후 365일이 넘으면 동결 지속이고, 두 변경 사이가 365일을 넘으면 연속·전환 판정을 끊는다.
- 블록 제목은 정확히 `### 정책금리 (확정 사실 — 중앙은행의 현재 국면·지난 결정 서술의 유일한 근거)`
- 소스가 없을 때의 줄은 정확히 `- {label}: 오늘 확인 불가 — 국면·지난 결정 언급 금지`
- 날짜에는 `(효력일)`을 붙인다. 변화폭 형식은 `+0.25%p` / `−0.25%p`(U+2212)다.
- soft-warn은 기록 전용이다. 기각이나 재시도를 하지 않는다.
- 커밋 메시지는 한국어로 쓰고, 끝에 다음 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s
  ```
- 전체 테스트: `npx tsx --test lib/*.test.ts lib/etf/*.test.ts`(기준선 180/180), 타입: `npx tsc --noEmit -p .`(기준선 clean)

## Review Focus

1. **FRED 결측값 `"."`**: 휴일 등에 `value: "."`가 섞여도 요약이 깨지지 않아야 한다. Task 2에서 `"."` 포함 응답 테스트로 고정한다.
2. **ECOS 오류 응답**: `{"RESULT":{"CODE":"INFO-200",...}}`(데이터 없음)이 와도 throw하지 않고, `null`과 `errors` 기록으로 끝나야 한다. Task 2에서 고정한다.
3. **한쪽 소스만 성공**: 블록에 성공한 쪽 줄과 "오늘 확인 불가" 줄이 함께 나와야 한다. Task 3에서 고정한다.
4. **soft-warn 입력이 중첩 리포트 객체**: 객체 경계에서 서로 다른 문장이 합쳐지면 안 된다. `extractReportText`로 문자열 값만 모아 검사한다. Task 5에서 고정한다.
5. **부동소수 비교**: `4.00`과 `4` 같은 표현 차이나 `0.1+0.2` 류 오차가 가짜 변경으로 잡히면 안 된다. Task 1에서 오차 1e-9 이하 무시 테스트로 고정한다.

---

## File Structure

- Create `lib/policy-rate.ts`: 타입 재사용, `summarizePolicyRate`, `collectPolicyRates`, `renderPolicyRateBlock`, `formatPolicyRateLog`, `POLICY_RATE_RULE`, `findPolicyDirectionMismatches`
- Create `lib/policy-rate.test.ts`: 위 함수 단위 테스트, 그리고 `claude-client.ts`·`sideways-detector.ts` 소스 문구 검사(파일을 텍스트로 읽음)
- Modify `lib/types.ts`: `PolicyRateChange`, `PolicyRateSummary`, `PolicyRates` 추가, `ContextData.policyRates` 추가
- Modify `lib/context-data.ts`: 수집 연결과 로그 한 줄
- Modify `lib/evidence-confidence.test.ts`: fixture에 `policyRates` 추가
- Modify `lib/claude-client.ts`: 블록 삽입, 규칙 문구, 과거 수치 출처 3곳, 좋은 글 예시, soft-warn 로그
- Modify `lib/sideways-detector.ts`: 딥다이브 주제 1줄

---

### Task 1: 타입과 `summarizePolicyRate`

**Files:**
- Modify: `lib/types.ts`(`ContextError` 정의 뒤, `ContextData` 앞)
- Create: `lib/policy-rate.ts`
- Test: `lib/policy-rate.test.ts`

**Interfaces:**
- Produces:
  - `export interface RatePoint { date: string; value: number }` (`lib/policy-rate.ts`, date는 `YYYY-MM-DD`)
  - `export function summarizePolicyRate(points: RatePoint[], opts: { label: string; today: string; windowStart: string; currentText?: string }): PolicyRateSummary | null`
  - `export function daysBetween(a: string, b: string): number` (b − a, 일 단위)
  - `lib/types.ts`: `PolicyRateChange`, `PolicyRateSummary`, `PolicyRates`

- [ ] **Step 1: 타입 추가** — `lib/types.ts`의 `ContextError` 인터페이스 바로 뒤에 넣는다.

```ts
export interface PolicyRateChange {
  date: string; // 효력일 YYYY-MM-DD
  delta: number; // %p, 양수=인상
}

export interface PolicyRateSummary {
  label: string; // "미 연준 목표범위" | "한국은행 기준금리"
  currentText: string; // "3.75~4.00%" | "3.00%"
  current: number; // 판정용(연준은 상단)
  lastChange: PolicyRateChange | null;
  prevChange: PolicyRateChange | null;
  stance: string;
  stanceDirection: "hike" | "cut" | "hold";
  asOf: string;
}

export interface PolicyRates {
  fed: PolicyRateSummary | null;
  bok: PolicyRateSummary | null;
}
```

`ContextData`는 Task 4에서 바꾼다. 여기서 바꾸면 fixture가 깨지기 때문이다.

- [ ] **Step 2: 실패하는 테스트 작성** — `lib/policy-rate.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePolicyRate, daysBetween, type RatePoint } from "./policy-rate";

const TODAY = "2026-10-05";
const WINDOW = "2023-10-05";

/** start~end 매일 값. changes: [효력일, 새 값] */
function daily(start: string, end: string, initial: number, changes: [string, number][] = []): RatePoint[] {
  const out: RatePoint[] = [];
  let v = initial;
  const map = new Map(changes);
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (map.has(d)) v = map.get(d)!;
    out.push({ date: d, value: v });
  }
  return out;
}

const opts = (label = "한국은행 기준금리") => ({ label, today: TODAY, windowStart: WINDOW });

test("daysBetween", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-05"), 4);
});

test("실제 연준 이력: 인하 사이클 뒤 첫 인상 → 전환", () => {
  const pts = daily(WINDOW, "2026-10-04", 5.5, [
    ["2024-09-19", 5.0], ["2024-11-08", 4.75], ["2024-12-19", 4.5],
    ["2025-09-18", 4.25], ["2025-10-30", 4.0], ["2025-12-11", 3.75], ["2026-09-17", 4.0],
  ]);
  const s = summarizePolicyRate(pts, { ...opts("미 연준 목표범위"), currentText: "3.75~4.00%" })!;
  assert.equal(s.current, 4);
  assert.equal(s.currentText, "3.75~4.00%");
  assert.deepEqual(s.lastChange, { date: "2026-09-17", delta: 0.25 });
  assert.deepEqual(s.prevChange, { date: "2025-12-11", delta: -0.25 });
  assert.equal(s.stance, "인상(인하→인상 전환)");
  assert.equal(s.stanceDirection, "hike");
  assert.equal(s.asOf, "2026-10-04");
});

test("한은 2회 연속 인상", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.currentText, "3.00%");
  assert.equal(s.stance, "인상(2회 연속)");
  assert.equal(s.stanceDirection, "hike");
});

test("단일 인하", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2026-08-01", 2.75]]), opts())!;
  assert.equal(s.stance, "인하");
  assert.equal(s.stanceDirection, "cut");
  assert.equal(s.prevChange, null);
});

test("마지막 변경 후 365일 초과 → 동결 지속", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2025-01-10", 3.25]]), opts())!;
  assert.equal(s.stance, "동결 지속(마지막 변경: 인상 2025-01-10)");
  assert.equal(s.stanceDirection, "hold");
});

test("3년 무변경", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.5), opts())!;
  assert.equal(s.lastChange, null);
  assert.equal(s.stance, "동결 지속(최근 3년 변경 없음)");
  assert.equal(s.stanceDirection, "hold");
});

test("365일 넘게 떨어진 같은 방향 두 변경은 연속이 아니다", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2024-01-10", 3.25], ["2026-09-01", 3.5]]), opts())!;
  assert.equal(s.stance, "인상(장기 동결 후 첫 변경)");
});

test("NaN 관측은 건너뛴다", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  pts.splice(100, 0, { date: pts[100].date, value: NaN });
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.stance, "인상(2회 연속)");
});

test("부동소수 오차는 변경이 아니다", () => {
  const pts = daily(WINDOW, "2026-10-04", 0.3);
  pts[500] = { ...pts[500], value: 0.1 + 0.2 };
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.lastChange, null);
});

test("빈 입력 → null", () => {
  assert.equal(summarizePolicyRate([], opts()), null);
});

test("마지막 관측이 7일 넘게 오래됨 → null", () => {
  assert.equal(summarizePolicyRate(daily(WINDOW, "2026-09-20", 3.0), opts()), null);
});

test("이력이 조회 시작보다 30일 넘게 늦게 시작 → null", () => {
  assert.equal(summarizePolicyRate(daily("2026-01-01", "2026-10-04", 3.0), opts()), null);
});

test("7일 초과 공백 직후 값이 바뀌면 → null", () => {
  const pts = daily(WINDOW, "2026-10-04", 3.75, [["2026-09-17", 4.0]])
    .filter((p) => p.date < "2026-09-08" || p.date > "2026-09-17");
  assert.equal(summarizePolicyRate(pts, opts()), null);
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: FAIL — `Cannot find module './policy-rate'`

- [ ] **Step 4: 구현** — `lib/policy-rate.ts`

```ts
/**
 * 정책금리(연준 목표범위·한은 기준금리) 수집·요약·프롬프트 블록.
 * 마켓 리포트가 금리 국면을 추론하지 않고 입력에서 읽게 하기 위한 사실 블록.
 * 설계: docs/superpowers/specs/2026-10-05-policy-rate-block-design.md
 */

import type { PolicyRateChange, PolicyRateSummary } from "./types";

export interface RatePoint {
  date: string;
  value: number;
}

const EPS = 1e-9;
const STALE_DAYS = 7;
const START_SLACK_DAYS = 30;
const GAP_DAYS = 7;
const PHASE_DAYS = 365;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

const dirWord = (delta: number) => (delta > 0 ? "인상" : "인하");

export function summarizePolicyRate(
  points: RatePoint[],
  opts: { label: string; today: string; windowStart: string; currentText?: string },
): PolicyRateSummary | null {
  const valid = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (valid.length === 0) return null;

  const last = valid[valid.length - 1];
  if (daysBetween(last.date, opts.today) > STALE_DAYS) return null;
  if (daysBetween(opts.windowStart, valid[0].date) > START_SLACK_DAYS) return null;

  const changes: PolicyRateChange[] = [];
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const cur = valid[i];
    if (Math.abs(cur.value - prev.value) <= EPS) continue;
    if (daysBetween(prev.date, cur.date) > GAP_DAYS) return null;
    changes.push({ date: cur.date, delta: Math.round((cur.value - prev.value) * 10000) / 10000 });
  }

  const lastChange = changes.at(-1) ?? null;
  const prevChange = changes.at(-2) ?? null;
  const base = {
    label: opts.label,
    currentText: opts.currentText ?? `${last.value.toFixed(2)}%`,
    current: last.value,
    lastChange,
    prevChange,
    asOf: last.date,
  };

  if (!lastChange) {
    return { ...base, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };
  }
  if (daysBetween(lastChange.date, opts.today) > PHASE_DAYS) {
    return {
      ...base,
      stance: `동결 지속(마지막 변경: ${dirWord(lastChange.delta)} ${lastChange.date})`,
      stanceDirection: "hold",
    };
  }

  const dir = dirWord(lastChange.delta);
  const direction = lastChange.delta > 0 ? "hike" : "cut";
  let streak = 1;
  for (let j = changes.length - 2; j >= 0; j--) {
    const sameSign = Math.sign(changes[j].delta) === Math.sign(lastChange.delta);
    const close = daysBetween(changes[j].date, changes[j + 1].date) <= PHASE_DAYS;
    if (sameSign && close) streak++;
    else break;
  }

  let stance = dir;
  if (streak >= 2) {
    stance = `${dir}(${streak}회 연속)`;
  } else if (prevChange) {
    if (daysBetween(prevChange.date, lastChange.date) > PHASE_DAYS) {
      stance = `${dir}(장기 동결 후 첫 변경)`;
    } else if (Math.sign(prevChange.delta) !== Math.sign(lastChange.delta)) {
      stance = `${dir}(${dirWord(prevChange.delta)}→${dir} 전환)`;
    }
  }
  return { ...base, stance, stanceDirection: direction };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: 모든 테스트 PASS(13건)

- [ ] **Step 6: 커밋**

```bash
git add lib/types.ts lib/policy-rate.ts lib/policy-rate.test.ts
git commit -m "정책금리 요약 순수 함수 — 변경점·국면 라벨·이력 신뢰성 검사

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s"
```

---

### Task 2: `collectPolicyRates` (FRED·ECOS 수집)

**Files:**
- Modify: `lib/policy-rate.ts`
- Test: `lib/policy-rate.test.ts`(추가)

**Interfaces:**
- Consumes: `summarizePolicyRate`, `RatePoint`(Task 1), `ContextError`(`lib/types.ts`), `fetchWithTimeout`(`lib/fetch-utils.ts`)
- Produces:
  - `export type JsonFetcher = (url: string) => Promise<unknown>`
  - `export async function collectPolicyRates(opts?: { today?: string; fetcher?: JsonFetcher; fredKey?: string; ecosKey?: string }): Promise<{ rates: PolicyRates; errors: ContextError[] }>`
  - 오류 source 값: `"policy-rate-fed"`, `"policy-rate-bok"`

- [ ] **Step 1: 실패하는 테스트 추가** — `lib/policy-rate.test.ts` 하단에 붙인다. import 줄은 파일 상단의 기존 import에 합친다.

```ts
import { collectPolicyRates } from "./policy-rate";

function fredObs(start: string, end: string, initial: number, changes: [string, number][] = []) {
  return { observations: daily(start, end, initial, changes).map((p) => ({ date: p.date, value: String(p.value) })) };
}
function ecosRows(start: string, end: string, initial: number, changes: [string, number][] = []) {
  return daily(start, end, initial, changes).map((p) => ({ TIME: p.date.replaceAll("-", ""), DATA_VALUE: String(p.value) }));
}
const FED_CHANGES: [string, number][] = [["2025-12-11", 3.75], ["2026-09-17", 4.0]];
const FED_LOWER: [string, number][] = [["2025-12-11", 3.5], ["2026-09-17", 3.75]];
const BOK_CHANGES: [string, number][] = [["2026-07-16", 2.75], ["2026-08-27", 3.0]];

function makeFetcher(overrides: Record<string, unknown | Error> = {}) {
  const calls: string[] = [];
  const bokAll = ecosRows(WINDOW, "2026-10-04", 2.5, BOK_CHANGES);
  const fetcher = async (url: string) => {
    calls.push(url);
    for (const [k, v] of Object.entries(overrides)) {
      if (url.includes(k)) {
        if (v instanceof Error) throw v;
        return v;
      }
    }
    if (url.includes("DFEDTARU")) return fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES);
    if (url.includes("DFEDTARL")) return fredObs(WINDOW, "2026-10-04", 3.75, FED_LOWER);
    const m = url.match(/\/json\/kr\/(\d+)\/(\d+)\//);
    if (m) {
      const [s, e] = [Number(m[1]), Number(m[2])];
      return { StatisticSearch: { list_total_count: bokAll.length, row: bokAll.slice(s - 1, e) } };
    }
    throw new Error("unexpected url " + url);
  };
  return { fetcher, calls };
}

test("collectPolicyRates: 두 소스 정상 + ECOS 페이지 이어받기", async () => {
  const { fetcher, calls } = makeFetcher();
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(errors, []);
  assert.equal(rates.fed!.currentText, "3.75~4.00%");
  assert.equal(rates.fed!.stance, "인상(인하→인상 전환)");
  assert.equal(rates.bok!.currentText, "3.00%");
  assert.equal(rates.bok!.stance, "인상(2회 연속)");
  assert.ok(calls.some((u) => u.includes("/1/1000/722Y001/D/")));
  assert.ok(calls.some((u) => u.includes("/1001/2000/722Y001/D/")));
  assert.ok(calls.every((u) => !u.includes("/722Y001/M/")));
});

test("collectPolicyRates: 키 없으면 조용히 null", async () => {
  const { fetcher, calls } = makeFetcher();
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "", ecosKey: "" });
  assert.deepEqual(rates, { fed: null, bok: null });
  assert.deepEqual(errors, []);
  assert.equal(calls.length, 0);
});

test("collectPolicyRates: FRED 실패는 fed만 null + errors 기록", async () => {
  const { fetcher } = makeFetcher({ DFEDTARU: new Error("HTTP 500") });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed, null);
  assert.ok(rates.bok);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, "policy-rate-fed");
  assert.match(errors[0].message, /HTTP 500/);
});

test("collectPolicyRates: FRED 결측 '.' 섞여도 요약", async () => {
  const obs = fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES);
  obs.observations[200].value = ".";
  const { fetcher } = makeFetcher({ DFEDTARU: obs });
  const { rates } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed!.stance, "인상(인하→인상 전환)");
});

test("collectPolicyRates: 하단 관측일이 상단과 다르면 fed null + errors", async () => {
  const { fetcher } = makeFetcher({ DFEDTARL: fredObs(WINDOW, "2025-12-11", 3.75, [["2025-12-11", 3.5]]) });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.fed, null);
  assert.equal(errors[0].source, "policy-rate-fed");
  assert.match(errors[0].message, /관측일 불일치/);
});

test("collectPolicyRates: 빈 정상 응답 → 요약 불가 errors", async () => {
  const { fetcher } = makeFetcher({
    DFEDTARU: { observations: [] },
    "722Y001": { StatisticSearch: { list_total_count: 0, row: [] } },
  });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(rates, { fed: null, bok: null });
  assert.deepEqual(errors.map((e) => e.source).sort(), ["policy-rate-bok", "policy-rate-fed"]);
  assert.ok(errors.every((e) => /요약 불가/.test(e.message)));
});

test("collectPolicyRates: 실제 응답 형식(추가 필드 포함) 파싱", async () => {
  // FRED observations 실제 형식(realtime_* 필드 포함), ECOS 2026-10-05 sample 키 실제 응답 행 형식
  const fredReal = (obs: { observations: { date: string; value: string }[] }) => ({
    realtime_start: TODAY, realtime_end: TODAY, units: "lin", count: obs.observations.length,
    observations: obs.observations.map((o) => ({ realtime_start: TODAY, realtime_end: TODAY, ...o })),
  });
  const bok = ecosRows(WINDOW, "2026-10-04", 2.5, BOK_CHANGES).map((r) => ({
    STAT_CODE: "722Y001", STAT_NAME: "1.3.1. 한국은행 기준금리 및 여수신금리",
    ITEM_CODE1: "0101000", ITEM_NAME1: "한국은행 기준금리", ITEM_CODE2: null, ITEM_NAME2: null,
    UNIT_NAME: "연%", WGT: null, ...r,
  }));
  const fetcher = async (url: string) => {
    if (url.includes("DFEDTARU")) return fredReal(fredObs(WINDOW, "2026-10-04", 4.0, FED_CHANGES));
    if (url.includes("DFEDTARL")) return fredReal(fredObs(WINDOW, "2026-10-04", 3.75, FED_LOWER));
    const m = url.match(/\/json\/kr\/(\d+)\/(\d+)\//)!;
    return { StatisticSearch: { list_total_count: bok.length, row: bok.slice(Number(m[1]) - 1, Number(m[2])) } };
  };
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.deepEqual(errors, []);
  assert.equal(rates.fed!.currentText, "3.75~4.00%");
  assert.equal(rates.bok!.lastChange!.date, "2026-08-27");
});

test("collectPolicyRates: 윤일 today도 존재하는 조회 시작일로", async () => {
  const { fetcher, calls } = makeFetcher();
  await collectPolicyRates({ today: "2028-02-29", fetcher, fredKey: "k", ecosKey: "k" });
  assert.ok(calls.some((u) => u.includes("observation_start=2025-03-01")));
  assert.ok(calls.some((u) => u.includes("/20250301/20280229/")));
});

test("collectPolicyRates: ECOS 데이터 없음 응답 → bok null + errors", async () => {
  const { fetcher } = makeFetcher({ "722Y001": { RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } } });
  const { rates, errors } = await collectPolicyRates({ today: TODAY, fetcher, fredKey: "k", ecosKey: "k" });
  assert.equal(rates.bok, null);
  assert.ok(rates.fed);
  assert.equal(errors[0].source, "policy-rate-bok");
  assert.match(errors[0].message, /INFO-200|요약 불가/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: FAIL — `collectPolicyRates` export 없음

- [ ] **Step 3: 구현** — `lib/policy-rate.ts`에 추가한다. 파일 상단 import를 다음으로 바꾼다.

```ts
import { fetchWithTimeout } from "./fetch-utils";
import type { ContextError, PolicyRateChange, PolicyRateSummary, PolicyRates } from "./types";
```

파일 끝에 추가한다.

```ts
export type JsonFetcher = (url: string) => Promise<unknown>;

const defaultFetcher: JsonFetcher = (url) => fetchWithTimeout<unknown>(url, { timeoutMs: 10000 });

const ECOS_PAGE = 1000;
const ECOS_MAX_PAGES = 5;

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function minusYears(date: string, years: number): string {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCFullYear(t.getUTCFullYear() - years); // 2028-02-29 → 2025-03-01 (존재하는 날짜로 보정)
  return t.toISOString().slice(0, 10);
}

interface FredResp {
  observations?: { date: string; value: string }[];
}

async function fetchFredSeries(fetcher: JsonFetcher, id: string, key: string, start: string): Promise<RatePoint[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}` +
    `&file_type=json&observation_start=${start}&sort_order=asc`;
  const data = (await fetcher(url)) as FredResp;
  return (data.observations ?? []).map((o) => ({ date: o.date, value: o.value === "." ? NaN : parseFloat(o.value) }));
}

interface EcosResp {
  StatisticSearch?: { list_total_count?: number; row?: { TIME: string; DATA_VALUE: string }[] };
  RESULT?: { CODE?: string; MESSAGE?: string };
}

async function fetchEcosBaseRate(fetcher: JsonFetcher, key: string, start: string, end: string): Promise<RatePoint[]> {
  const from = start.replaceAll("-", "");
  const to = end.replaceAll("-", "");
  const out: RatePoint[] = [];
  for (let page = 0; page < ECOS_MAX_PAGES; page++) {
    const s = page * ECOS_PAGE + 1;
    const e = (page + 1) * ECOS_PAGE;
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/kr/${s}/${e}/722Y001/D/${from}/${to}/0101000`;
    const data = (await fetcher(url)) as EcosResp;
    if (!data.StatisticSearch) {
      throw new Error(`ECOS ${data.RESULT?.CODE ?? "응답 없음"}: ${data.RESULT?.MESSAGE ?? ""}`.trim());
    }
    const rows = data.StatisticSearch.row ?? [];
    for (const r of rows) {
      const t = r.TIME;
      out.push({ date: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`, value: parseFloat(r.DATA_VALUE) });
    }
    const total = data.StatisticSearch.list_total_count ?? rows.length;
    if (out.length >= total || rows.length === 0) break;
  }
  return out;
}

export async function collectPolicyRates(
  opts: { today?: string; fetcher?: JsonFetcher; fredKey?: string; ecosKey?: string } = {},
): Promise<{ rates: PolicyRates; errors: ContextError[] }> {
  const today = opts.today ?? kstToday();
  const fetcher = opts.fetcher ?? defaultFetcher;
  const fredKey = opts.fredKey ?? process.env.FRED_API_KEY ?? "";
  const ecosKey = opts.ecosKey ?? process.env.ECOS_API_KEY ?? "";
  const windowStart = minusYears(today, 3);
  const errors: ContextError[] = [];

  const fedTask = async (): Promise<PolicyRateSummary | null> => {
    if (!fredKey) return null;
    const [upper, lower] = await Promise.all([
      fetchFredSeries(fetcher, "DFEDTARU", fredKey, windowStart),
      fetchFredSeries(fetcher, "DFEDTARL", fredKey, windowStart),
    ]);
    const lowerLatest = [...lower].reverse().find((p) => Number.isFinite(p.value));
    const upperLatest = [...upper].reverse().find((p) => Number.isFinite(p.value));
    if (!lowerLatest || !upperLatest) throw new Error("요약 불가: FRED 목표범위 관측 없음");
    if (lowerLatest.date !== upperLatest.date) {
      throw new Error(`요약 불가: 목표범위 상·하단 관측일 불일치(${lowerLatest.date} vs ${upperLatest.date})`);
    }
    const s = summarizePolicyRate(upper, {
      label: "미 연준 목표범위",
      today,
      windowStart,
      currentText: `${lowerLatest.value.toFixed(2)}~${upperLatest.value.toFixed(2)}%`,
    });
    if (!s) throw new Error("요약 불가: 이력 불완전 또는 오래됨");
    return s;
  };

  const bokTask = async (): Promise<PolicyRateSummary | null> => {
    if (!ecosKey) return null;
    const pts = await fetchEcosBaseRate(fetcher, ecosKey, windowStart, today);
    const s = summarizePolicyRate(pts, { label: "한국은행 기준금리", today, windowStart });
    if (!s) throw new Error("요약 불가: 이력 불완전 또는 오래됨");
    return s;
  };

  const [fed, bok] = await Promise.allSettled([fedTask(), bokTask()]);
  const pick = (r: PromiseSettledResult<PolicyRateSummary | null>, source: string) => {
    if (r.status === "fulfilled") return r.value;
    errors.push({ source, status: "error", message: (r.reason as Error).message });
    return null;
  };
  return {
    rates: { fed: pick(fed, "policy-rate-fed"), bok: pick(bok, "policy-rate-bok") },
    errors,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: 모든 테스트 PASS(22건)

- [ ] **Step 5: 커밋**

```bash
git add lib/policy-rate.ts lib/policy-rate.test.ts
git commit -m "정책금리 수집 — FRED 목표범위·ECOS 기준금리 일별, 페이지 이어받기, 실패를 errors로 반환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s"
```

---

### Task 3: 프롬프트 블록·규칙 문구·로그 포맷

**Files:**
- Modify: `lib/policy-rate.ts`
- Test: `lib/policy-rate.test.ts`(추가)

**Interfaces:**
- Consumes: `PolicyRates`, `PolicyRateSummary`(Task 1)
- Produces:
  - `export function renderPolicyRateBlock(rates: PolicyRates): string` — 앞에 `\n`이 붙고 끝은 `\n`
  - `export function formatPolicyRateLog(rates: PolicyRates): string`
  - `export const POLICY_RATE_RULE: string` — 시스템 프롬프트 "허위 정보 생성 금지" 블록에 넣을 한 줄(`- ❌ ...`)

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
import { renderPolicyRateBlock, formatPolicyRateLog, POLICY_RATE_RULE } from "./policy-rate";
import type { PolicyRateSummary } from "./types";

const FED: PolicyRateSummary = {
  label: "미 연준 목표범위", currentText: "3.75~4.00%", current: 4,
  lastChange: { date: "2026-09-17", delta: 0.25 }, prevChange: { date: "2025-12-11", delta: -0.25 },
  stance: "인상(인하→인상 전환)", stanceDirection: "hike", asOf: "2026-10-04",
};
const BOK: PolicyRateSummary = {
  label: "한국은행 기준금리", currentText: "3.00%", current: 3,
  lastChange: { date: "2026-08-27", delta: 0.25 }, prevChange: { date: "2026-07-16", delta: 0.25 },
  stance: "인상(2회 연속)", stanceDirection: "hike", asOf: "2026-10-04",
};
const HEAD = "### 정책금리 (확정 사실 — 중앙은행의 현재 국면·지난 결정 서술의 유일한 근거)";

test("renderPolicyRateBlock: 두 소스", () => {
  assert.equal(
    renderPolicyRateBlock({ fed: FED, bok: BOK }),
    `\n${HEAD}\n` +
      "- 미 연준 목표범위: 3.75~4.00% — 최근 변경 2026-09-17(효력일) +0.25%p, 직전 변경 2025-12-11 −0.25%p\n" +
      "  → 현재 국면: 인상(인하→인상 전환)\n" +
      "- 한국은행 기준금리: 3.00% — 최근 변경 2026-08-27(효력일) +0.25%p, 직전 변경 2026-07-16 +0.25%p\n" +
      "  → 현재 국면: 인상(2회 연속)\n",
  );
});

test("renderPolicyRateBlock: 한쪽 없음 → 확인 불가 줄", () => {
  const out = renderPolicyRateBlock({ fed: FED, bok: null });
  assert.ok(out.includes("- 미 연준 목표범위: 3.75~4.00%"));
  assert.ok(out.endsWith("- 한국은행 기준금리: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n"));
});

test("renderPolicyRateBlock: 둘 다 없음 → 제목 + 확인 불가 두 줄", () => {
  assert.equal(
    renderPolicyRateBlock({ fed: null, bok: null }),
    `\n${HEAD}\n` +
      "- 미 연준 목표범위: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n" +
      "- 한국은행 기준금리: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n",
  );
});

test("renderPolicyRateBlock: 변경 없음·직전 없음", () => {
  const hold: PolicyRateSummary = { ...BOK, lastChange: null, prevChange: null, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };
  const single: PolicyRateSummary = { ...BOK, prevChange: null, stance: "인상" };
  assert.ok(renderPolicyRateBlock({ fed: null, bok: hold }).includes("- 한국은행 기준금리: 3.00% — 최근 3년 변경 없음\n  → 현재 국면: 동결 지속(최근 3년 변경 없음)\n"));
  assert.ok(renderPolicyRateBlock({ fed: null, bok: single }).includes("최근 변경 2026-08-27(효력일) +0.25%p\n  → 현재 국면: 인상\n"));
});

test("formatPolicyRateLog", () => {
  assert.equal(formatPolicyRateLog({ fed: FED, bok: BOK }), "🏛️ 정책금리: 연준 3.75~4.00%(인상(인하→인상 전환)) / 한은 3.00%(인상(2회 연속))");
  assert.equal(formatPolicyRateLog({ fed: null, bok: null }), "🏛️ 정책금리: 연준 없음 / 한은 없음");
});

test("POLICY_RATE_RULE: 국면은 블록만, 전망은 출처 인용", () => {
  assert.ok(POLICY_RATE_RULE.startsWith("- ❌ **중앙은행 금리 국면 추정 금지**"));
  assert.ok(POLICY_RATE_RULE.includes("[정책금리] 블록에 적힌 대로만"));
  assert.ok(POLICY_RATE_RULE.includes("FRED 연방기금금리 월평균"));
  assert.ok(POLICY_RATE_RULE.includes("블록에 없는 중앙은행(ECB·일본은행 등)"));
  assert.ok(POLICY_RATE_RULE.includes("출처가 있을 때만"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: FAIL — export 없음

- [ ] **Step 3: 구현** — `lib/policy-rate.ts` 끝에 추가

```ts
const BLOCK_HEAD = "### 정책금리 (확정 사실 — 중앙은행의 현재 국면·지난 결정 서술의 유일한 근거)";

function fmtDelta(delta: number): string {
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}%p`;
}

function renderLine(label: string, s: PolicyRateSummary | null): string {
  if (!s) return `- ${label}: 오늘 확인 불가 — 국면·지난 결정 언급 금지\n`;
  let facts: string;
  if (!s.lastChange) {
    facts = "최근 3년 변경 없음";
  } else {
    facts = `최근 변경 ${s.lastChange.date}(효력일) ${fmtDelta(s.lastChange.delta)}`;
    if (s.prevChange) facts += `, 직전 변경 ${s.prevChange.date} ${fmtDelta(s.prevChange.delta)}`;
  }
  return `- ${s.label}: ${s.currentText} — ${facts}\n  → 현재 국면: ${s.stance}\n`;
}

export function renderPolicyRateBlock(rates: PolicyRates): string {
  return `\n${BLOCK_HEAD}\n` + renderLine("미 연준 목표범위", rates.fed) + renderLine("한국은행 기준금리", rates.bok);
}

export function formatPolicyRateLog(rates: PolicyRates): string {
  const one = (s: PolicyRateSummary | null) => (s ? `${s.currentText}(${s.stance})` : "없음");
  return `🏛️ 정책금리: 연준 ${one(rates.fed)} / 한은 ${one(rates.bok)}`;
}

export const POLICY_RATE_RULE =
  "- ❌ **중앙은행 금리 국면 추정 금지**: 연준·한은의 **현재 국면과 지난 결정**(인상·인하·동결, 언제 얼마나)은 [정책금리] 블록에 적힌 대로만 쓸 것. " +
  "블록에서 '오늘 확인 불가'인 연준·한은은 국면·지난 결정을 언급하지 말 것(FRED 연방기금금리 월평균 값으로 대신 추정하지 말 것). " +
  "블록에 없는 중앙은행(ECB·일본은행 등)의 국면·결정은 추정하지 말고, 뉴스에 출처가 있을 때만 출처를 밝혀 인용할 것. " +
  "**앞으로의 방향**(추가 인상·인하 전망)은 뉴스에 출처가 있을 때만 출처를 밝혀 인용할 것 — 현재 국면과 반대되는 전망이면 " +
  "\"인상 국면 속에서도 ○○는 인하 가능성을 제기했다\"처럼 국면을 함께 밝힐 것.";
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: 모든 테스트 PASS(28건)

- [ ] **Step 5: 커밋**

```bash
git add lib/policy-rate.ts lib/policy-rate.test.ts
git commit -m "정책금리 프롬프트 블록·규칙 문구·로그 포맷 — 없는 소스는 '확인 불가' 줄로 명시

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s"
```

---

### Task 4: 컨텍스트 수집 연결

**Files:**
- Modify: `lib/types.ts`(`ContextData`)
- Modify: `lib/context-data.ts:47-110`
- Modify: `lib/evidence-confidence.test.ts:6-17`
- Test: `lib/policy-rate.test.ts`(소스 검사 추가)

**Interfaces:**
- Consumes: `collectPolicyRates`, `formatPolicyRateLog`(Task 2·3)
- Produces: `ContextData.policyRates: PolicyRates`(필수)

- [ ] **Step 1: 타입 변경** — `lib/types.ts`의 `ContextData`에 필드를 추가한다(`koreanBonds` 다음 줄).

```ts
  koreanBonds: KoreanBondYield[];
  policyRates: PolicyRates;
```

- [ ] **Step 2: 타입 오류로 실패 확인**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — `lib/context-data.ts`와 `lib/evidence-confidence.test.ts`에서 `Property 'policyRates' is missing`. 다른 파일이 나오면 그 파일도 같은 방식(`policyRates: { fed: null, bok: null }`)으로 보완하고, 보완한 목록을 커밋 메시지에 적는다.

- [ ] **Step 3: fixture 보완** — `lib/evidence-confidence.test.ts`의 `ctx()` 반환 객체에 `koreanBonds: [],` 다음 줄로 추가한다.

```ts
    policyRates: { fed: null, bok: null },
```

- [ ] **Step 4: 수집 연결** — `lib/context-data.ts`

import 추가(기존 `collectEcosData` import 아래):

```ts
import { collectPolicyRates, formatPolicyRateLog } from "./policy-rate";
```

`Promise.all` 구조분해에 `policyRateResult`를 추가하고, 배열 끝(`collectHistoricalData()...` 다음)에 넣는다.

```ts
  const [news, calendar, fred, ecos, investorFlow, vix, fearGreed, historical, policyRateResult] =
```

```ts
      collectPolicyRates().catch((err) => ({
        rates: { fed: null, bok: null },
        errors: [{ source: "policy-rate", status: "error", message: (err as Error).message }],
      })),
```

`Promise.all` 바로 뒤(`const sentiment` 앞)에 넣는다.

```ts
  errors.push(...policyRateResult.errors);
```

`contextData` 객체의 `koreanBonds: ecos,` 다음 줄에 넣는다.

```ts
    policyRates: policyRateResult.rates,
```

로그 블록의 `🏦 ECOS` 줄 다음에 넣는다.

```ts
  console.log(`  ${formatPolicyRateLog(policyRateResult.rates)}`);
```

- [ ] **Step 5: 연결 검사 테스트 추가** — `lib/policy-rate.test.ts`. `context-data.ts`는 네트워크 수집기를 import하므로 소스 텍스트로 검사한다.

```ts
import fs from "node:fs";

test("context-data: 정책금리 수집·errors 병합·로그 연결", () => {
  const src = fs.readFileSync("lib/context-data.ts", "utf8");
  assert.ok(src.includes("collectPolicyRates()"));
  assert.ok(src.includes("errors.push(...policyRateResult.errors)"));
  assert.ok(src.includes("policyRates: policyRateResult.rates"));
  assert.ok(src.includes("formatPolicyRateLog(policyRateResult.rates)"));
});
```

- [ ] **Step 6: 확인**

Run: `npx tsc --noEmit -p . && npx tsx --test lib/*.test.ts lib/etf/*.test.ts`
Expected: tsc clean, 209/209 PASS(기준선 180 + 이번 브랜치 29)

- [ ] **Step 7: 커밋**

```bash
git add lib/types.ts lib/context-data.ts lib/evidence-confidence.test.ts lib/policy-rate.test.ts
git commit -m "컨텍스트 수집에 정책금리 연결 — ContextData.policyRates, 실패는 contextErrors로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s"
```

---

### Task 5: 마켓 프롬프트 반영 + soft-warn

**Files:**
- Modify: `lib/policy-rate.ts`(soft-warn 함수)
- Modify: `lib/claude-client.ts:16-18`(import), `:71-75`(규칙), `:82`(예시), `:89`(구조 원칙 4), `:214`(블록 삽입 위치), `:248`(과거 비교 안내), `:584-585`(soft-warn 로그)
- Modify: `lib/sideways-detector.ts:7`
- Test: `lib/policy-rate.test.ts`(추가)

**Interfaces:**
- Consumes: `renderPolicyRateBlock`, `POLICY_RATE_RULE`(Task 3), `ContextData.policyRates`(Task 4)
- Produces: `export function findPolicyDirectionMismatches(text: string, rates: PolicyRates): string[]`

- [ ] **Step 1: 실패하는 테스트 추가** — `lib/policy-rate.test.ts`

```ts
import { findPolicyDirectionMismatches, extractReportText } from "./policy-rate";

const CUT_BOK: PolicyRateSummary = { ...BOK, stance: "인하", stanceDirection: "cut" };
const HOLD_BOK: PolicyRateSummary = { ...BOK, stance: "동결 지속(최근 3년 변경 없음)", stanceDirection: "hold" };

test("soft-warn: 인상 국면에서 인하 전제 표현 탐지(10-02 실문장)", () => {
  const text = "수치가 예상보다 높게 나오면 한국은행 금리 인하 기대가 후퇴하며 채권·주식 모두 단기 부담을 받을 수 있습니다. 반도체는 강했습니다.";
  const hits = findPolicyDirectionMismatches(text, { fed: FED, bok: BOK });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].includes("금리 인하 기대"));
  assert.ok(hits[0].length <= 80);
});

test("soft-warn: <strong> 낀 표현과 '금리를 내렸다'도 탐지", () => {
  const text = "연준의 금리 <strong>인하</strong> 기대가 커졌습니다. 한은이 금리를 내렸습니다.";
  assert.equal(findPolicyDirectionMismatches(text, { fed: FED, bok: BOK }).length, 2);
});

test("extractReportText: 중첩 객체의 문자열 값만 줄 단위로 모은다", () => {
  const content = { bigStory: { content: [
    { type: "paragraph", text: "연준이 동결했습니다." },
    { text: "한은의 추가 인상 기대가 커졌습니다.", type: "paragraph" },
  ] }, n: 3 };
  const text = extractReportText(content);
  assert.ok(text.includes("연준이 동결했습니다.\n"));
  assert.ok(!text.includes("{"));
  // 객체 경계가 문장을 합치지 않는다: 연준 hike·한은 cut 에서 두 번째 문장만 탐지
  assert.equal(findPolicyDirectionMismatches(text, { fed: FED, bok: CUT_BOK }).length, 1);
});

test("soft-warn: 은행이 엇갈리면 문장 단서로 구분", () => {
  const rates = { fed: FED, bok: CUT_BOK };
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인하 기대가 커졌습니다.", rates).length, 0);
  assert.equal(findPolicyDirectionMismatches("연준의 추가 인하 기대가 커졌습니다.", rates).length, 1);
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인상 기대가 커졌습니다.", rates).length, 1);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", rates).length, 0);
});

test("soft-warn: 단서 없는 문장은 두 은행이 모두 있고 같은 방향일 때만", () => {
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", { fed: FED, bok: null }).length, 0);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대가 커졌습니다.", { fed: FED, bok: BOK }).length, 1);
});

test("soft-warn: hold·없음은 검사하지 않음", () => {
  assert.equal(findPolicyDirectionMismatches("한은의 추가 인하 기대.", { fed: null, bok: HOLD_BOK }).length, 0);
  assert.equal(findPolicyDirectionMismatches("추가 인하 기대.", { fed: null, bok: null }).length, 0);
});

test("프롬프트 소스: 규칙 삽입·과거 수치 출처 통합·인하 프레임 제거", () => {
  const cc = fs.readFileSync("lib/claude-client.ts", "utf8");
  assert.ok(cc.includes("${POLICY_RATE_RULE}"));
  assert.ok(cc.includes("renderPolicyRateBlock(context.policyRates)"));
  assert.ok(cc.includes("findPolicyDirectionMismatches(extractReportText(content), context.policyRates)"));
  assert.ok(!cc.includes("금리 인하를 준비하던"));
  assert.ok(cc.includes("historicalComparison 필드 또는 [정책금리] 블록의 수치만"));
  assert.ok(cc.includes("historicalComparison·[정책금리] 블록에 포함되지 않은 과거 수치는 절대 사용 금지"));
  assert.ok(cc.includes("반드시 이 데이터 또는 [정책금리] 블록만 사용하십시오"));
  const sd = fs.readFileSync("lib/sideways-detector.ts", "utf8");
  assert.ok(!sd.includes("미국 금리 인하가 진짜 시작되면"));
  assert.ok(sd.includes("미국 금리 경로가 바뀌면 무슨 일이 벌어지나 — 시나리오 분석"));
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/policy-rate.test.ts`
Expected: FAIL — `findPolicyDirectionMismatches` 없음, 소스 검사 실패

- [ ] **Step 3: soft-warn 구현** — `lib/policy-rate.ts` 끝에 추가

```ts
const FED_CUE = /연준|Fed|FOMC|워시|미국 (기준)?금리/;
const BOK_CUE = /한국은행|한은|금통위|국내 기준금리/;
const EASE_RE = /금리 인하 기대|인하 기대|추가 (금리 )?인하|금리 인하 (시점|속도|여력|여지|국면)|인하 방향|인하 사이클|금리를 (내렸|내린|인하했)|인하를 준비/;
const TIGHT_RE = /금리 인상 기대|인상 기대|추가 (금리 )?인상|금리 인상 (시점|속도|여력|여지|국면)|인상 방향|인상 사이클|금리를 (올렸|올린|인상했)|인상을 준비/;

/** 리포트 콘텐츠 객체의 모든 문자열 값을 줄 단위로 모은다(JSON 구조 기호가 문장을 합치지 않게). */
export function extractReportText(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out.join("\n") + "\n";
}

/** 국면 라벨과 반대 방향 전제 문장 발췌(기록 전용). hold·null 은 검사하지 않는다. */
export function findPolicyDirectionMismatches(text: string, rates: PolicyRates): string[] {
  const plain = text.replace(/<[^>]+>/g, "");
  const sentences = plain.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean);
  const hits: string[] = [];
  for (const sent of sentences) {
    const fedCue = FED_CUE.test(sent);
    const bokCue = BOK_CUE.test(sent);
    const targets = fedCue || bokCue
      ? [fedCue ? rates.fed : null, bokCue ? rates.bok : null].filter((s): s is PolicyRateSummary => !!s)
      : rates.fed && rates.bok ? [rates.fed, rates.bok] : [];
    const dirs = new Set(targets.map((s) => s.stanceDirection));
    if (dirs.size !== 1) continue;
    const dir = [...dirs][0];
    const re = dir === "hike" ? EASE_RE : dir === "cut" ? TIGHT_RE : null;
    if (re && re.test(sent)) hits.push(sent.slice(0, 80));
  }
  return hits;
}
```

`targets`는 단서가 가리킨 은행 중 데이터가 있는 쪽이다. 단서가 없으면 두 은행이 모두 있을 때만 둘 다 본다(스펙: "두 은행이 같은 방향일 때만"). 방향이 하나로 모이지 않으면(엇갈림 또는 대상 없음) 건너뛴다. 예를 들어 "추가 인하 기대"(단서 없음)는 연준 hike·한은 cut이면 `dirs`가 2개라 건너뛰고, 한은 데이터가 없으면 대상이 0개라 건너뛴다.

- [ ] **Step 4: `lib/claude-client.ts` 수정**

(a) import — `import { softFixUnquotableSources, ... } from "./quotable-sources";` 다음 줄에 추가한다.

```ts
import { renderPolicyRateBlock, POLICY_RATE_RULE, findPolicyDirectionMismatches, extractReportText } from "./policy-rate";
```

(b) "⛔ 허위 정보 생성 금지" 블록: 첫 숫자 규칙 문구를 바꾸고, `가상 통계/설문 결과 금지` 줄 다음에 규칙을 넣는다.

변경 전:
```
- ❌ **제공되지 않은 숫자 날조 금지**: 과거 비교가 필요하면 반드시 historicalComparison 필드의 수치만 사용할 것. 해당 데이터가 없으면 과거 비교를 생략할 것.
- ❌ **가상 통계/설문 결과 금지**: "최근 설문에 따르면" 등 출처 없는 통계를 만들어내지 말 것.
```
변경 후:
```
- ❌ **제공되지 않은 숫자 날조 금지**: 과거 비교가 필요하면 반드시 historicalComparison 필드 또는 [정책금리] 블록의 수치만 사용할 것. 해당 데이터가 없으면 과거 비교를 생략할 것.
- ❌ **가상 통계/설문 결과 금지**: "최근 설문에 따르면" 등 출처 없는 통계를 만들어내지 말 것.
${POLICY_RATE_RULE}
```
(`buildSystemPrompt`는 템플릿 리터럴이므로 `${POLICY_RATE_RULE}`가 그대로 보간된다. 같은 템플릿에서 이미 `${renderVoiceExemplars()}`를 쓰고 있다.)

(c) 좋은 글 예시(`:82`): `각국 중앙은행이 금리 인하를 준비하던 바로 그 순간` → `각국 중앙은행이 물가가 잡혔는지 확인하려던 바로 그 순간`

(d) 구조적 원칙 4(`:89`): `historicalComparison 데이터로 현재 수치의 위치를 보여줄 것. 포함되지 않은 과거 수치는 절대 사용 금지.` → `historicalComparison 데이터로 현재 수치의 위치를 보여줄 것. historicalComparison·[정책금리] 블록에 포함되지 않은 과거 수치는 절대 사용 금지.`

(e) `buildContextBlock`: `if (context.fredIndicators.length > 0) {` 바로 앞에 넣는다.

```ts
  block += renderPolicyRateBlock(context.policyRates);

```

(f) 과거 비교 안내(`:248`): `` block += `⚠️ 과거 수치를 인용할 때는 반드시 이 데이터만 사용하십시오.\n`; `` → `` block += `⚠️ 과거 수치를 인용할 때는 반드시 이 데이터 또는 [정책금리] 블록만 사용하십시오.\n`; ``

(g) soft-warn 로그: `generateReport`에서 `sanitizeBannedExpressions(jsonStr);` 바로 다음에 넣는다.

```ts
  if (context?.policyRates) {
    const mismatches = findPolicyDirectionMismatches(extractReportText(content), context.policyRates);
    if (mismatches.length > 0) {
      console.log(`[soft-warn] 정책 방향 불일치 ${mismatches.length}건 (기록 전용)`);
      for (const m of mismatches) console.log(`  - ${m}`);
    }
  }
```

- [ ] **Step 5: `lib/sideways-detector.ts:7` 수정**

`"미국 금리 인하가 진짜 시작되면 무슨 일이 벌어지나 — 시나리오 분석",` → `"미국 금리 경로가 바뀌면 무슨 일이 벌어지나 — 시나리오 분석",`

- [ ] **Step 6: 다른 '인하' 고정 문구 확인**

Run: `grep -rn '인하' lib --include='*.ts' | grep -v '\.test\.\|lib/etf/\|policy-rate.ts'`
Expected: `lib/catalyst-extractor.ts:36`(키워드 목록 — 방향 전제가 아니므로 유지)만 나온다. 다른 줄이 나오면 같은 원칙(방향 전제를 중립 표현으로)으로 고치고, 고친 내용을 커밋 메시지에 적는다.

- [ ] **Step 7: 전체 확인**

Run: `npx tsc --noEmit -p . && npx tsx --test lib/*.test.ts lib/etf/*.test.ts`
Expected: tsc clean, 216/216 PASS. `market-prompt-freeze.test.ts`는 변경 없이 통과해야 한다(보이스·시점·요일 블록 불변).

- [ ] **Step 8: 커밋**

```bash
git add lib/policy-rate.ts lib/policy-rate.test.ts lib/claude-client.ts lib/sideways-detector.ts
git commit -m "마켓 프롬프트에 정책금리 블록·국면 규칙 반영, 과거 수치 출처 통합, 인하 전제 문구 중립화, soft-warn 기록

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EWRiFtTs8hWaAkoKrxbP3s"
```

---

## 머지 후 운영 확인 (구현 범위 밖, 기록용)

- 첫 거래일 마켓 run 로그에서 다음 두 가지를 확인한다.
  - `🏛️ 정책금리: 연준 3.75~4.00%(인상(인하→인상 전환)) / 한은 3.00%(인상(2회 연속))`
  - `contextErrors`에 `policy-rate-*`가 없는지
- 10거래일 뒤 인하 전제 표현을 다시 집계한다(기준선: 52일 중 31일, 69회). `[soft-warn] 정책 방향 불일치` 로그 발췌도 사람이 함께 본다.
