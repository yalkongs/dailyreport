# 발송 실패 복구 (백업 수단 재설계 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리포트는 커밋됐는데 Telegram 발송이 안 된 날을 다음 실행이 감지해 재발송하되, 같은 리포트가 구독자에게 두 번 가는 일은 없게 한다.

**Architecture:** 발송 상태를 리포트 커밋의 commit status(`telegram/market`, `telegram/etf`)로 기록한다. 판정은 순수 함수(`lib/delivery-state.ts`)에 두고, 얇은 CLI(`scripts/delivery-state.ts`)가 GitHub API를 읽고 쓴다. 워크플로의 발송 step은 기존 bash를 유지한 채 응답 검사·상태 기록·env 전달만 더한다. job별 concurrency 그룹으로 같은 종류의 job을 직렬화한다.

**Tech Stack:** TypeScript, tsx, node:test + node:assert/strict, Node 20 내장 `fetch`, GitHub REST API(commits·statuses), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-21-backup-and-delivery-recovery-design.md` (A·B는 코드 변경 없음 — 이 plan은 C만 다룬다)

## Global Constraints

- 브랜치: `feat/backup-delivery-recovery`. 머지·push는 사용자 지시가 있을 때만.
- **중복 발송 금지가 최우선.** 결과 불명(`pending`·`error`)은 자동 재발송하지 않는다. 판단이 애매하면 보내지 않는 쪽.
- **활성화 기준일**: `DELIVERY_TRACKING_SINCE = "2026-09-22"`. 이 날짜보다 이른 리포트는 status가 없어도 재발송하지 않는다(이 기능 이전에 발송된 리포트엔 status가 없다 — 배포 당일 중복 발송 방지).
- 발송 메시지의 조립·`--form-string`·HTML escape·cache-bust 로직은 **한 글자도 바꾸지 않는다**(검증된 코드). 바꾸는 것은 값의 전달 방식(env), 응답 검사, 상태 기록뿐.
- `resend_telegram_only=true`로 실제 dispatch하는 검증은 **금지**(구독자 채널로 실발송된다).
- `krx-probe` job은 건드리지 않는다.
- 테스트: `npx tsx --test <file>`, 타입: `npx tsc --noEmit`. `git add -A` 금지.
- 커밋 메시지는 한국어 서술형, 끝에 아래 두 줄(`git commit -F -` heredoc 사용):
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FXc7J4MXi9SRfhhjaVfR8s
  ```

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/delivery-state.ts` (신규) | 순수 함수: 리포트 커밋 찾기, status 추출, 발송 판정, Telegram 응답 분류, 이상탐지 라벨 |
| `lib/delivery-state.test.ts` (신규) | 위 함수 테스트 |
| `scripts/delivery-state.ts` (신규) | CLI `resolve|status|mark|classify` — GitHub API I/O와 `$GITHUB_OUTPUT` 기록 |
| `.github/workflows/daily-report.yml` | 권한·concurrency·"Resolve delivery" step·발송 step 개정(두 job) |
| `lib/workflow-triggers.test.ts` | 워크플로 정적 assert 추가 |

---

### Task 1: 발송 판정 순수 함수

**Files:**
- Create: `lib/delivery-state.ts`
- Test: `lib/delivery-state.test.ts`

**Interfaces:**
- Produces:
  - `type ReportKind = "market" | "etf"`
  - `type TelegramStatus = "pending" | "success" | "failure" | "error" | null`
  - `type DeliveryAction = "send" | "skip" | "unknown"`
  - `DELIVERY_TRACKING_SINCE: string`
  - `statusContext(kind): string` → `"telegram/market"` | `"telegram/etf"`
  - `reportCommitPrefix(kind, date): string`
  - `kstDayStartIso(date): string` → `"2026-09-22T00:00:00+09:00"`
  - `findReportCommit(commits: {sha: string; message: string}[], kind, date): string | null`
  - `pickTelegramStatus(statuses: {context: string; state: string}[], kind): TelegramStatus`
  - `decideDelivery(input: {date: string; reportSha: string | null; telegramStatus: TelegramStatus; justGenerated: boolean; forceResend: boolean; dryRun: boolean}): {action: DeliveryAction; reason: string}` — `justGenerated`는 이 실행이 방금 리포트를 생성·push했다는 뜻
  - `classifyTelegramResponse(body: string): {state: "success" | "failure" | "error"; detail: string}`
  - `formatAnomalyBreakdown(breakdown: Record<string, number> | undefined): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `lib/delivery-state.test.ts`

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_TRACKING_SINCE,
  statusContext,
  reportCommitPrefix,
  kstDayStartIso,
  findReportCommit,
  pickTelegramStatus,
  decideDelivery,
  classifyTelegramResponse,
  formatAnomalyBreakdown,
} from "./delivery-state";

const DATE = "2026-09-22";
const base = { date: DATE, reportSha: "abc123", justGenerated: false, forceResend: false, dryRun: false };

test("status context와 커밋 메시지 접두어", () => {
  assert.equal(statusContext("market"), "telegram/market");
  assert.equal(statusContext("etf"), "telegram/etf");
  assert.equal(reportCommitPrefix("market", DATE), "Daily Market Report - 2026-09-22 (KST)");
  assert.equal(reportCommitPrefix("etf", DATE), "ETF Daily Report - 2026-09-22 (KST)");
  assert.equal(kstDayStartIso(DATE), "2026-09-22T00:00:00+09:00");
});

test("findReportCommit: 종류·날짜가 맞는 커밋만 고른다", () => {
  const commits = [
    { sha: "e1", message: "ETF Daily Report - 2026-09-22 (KST)" },
    { sha: "m1", message: "Daily Market Report - 2026-09-22 (KST)\n\nbody" },
    { sha: "x1", message: "Merge branch 'feat/x'" },
    { sha: "m0", message: "Daily Market Report - 2026-09-21 (KST)" },
  ];
  assert.equal(findReportCommit(commits, "market", DATE), "m1");
  assert.equal(findReportCommit(commits, "etf", DATE), "e1");
  assert.equal(findReportCommit(commits, "market", "2026-09-23"), null);
});

test("pickTelegramStatus: 해당 context의 상태만, 없으면 null, 모르는 값은 error 취급", () => {
  const statuses = [
    { context: "Vercel", state: "success" },
    { context: "telegram/etf", state: "failure" },
  ];
  assert.equal(pickTelegramStatus(statuses, "etf"), "failure");
  assert.equal(pickTelegramStatus(statuses, "market"), null);
  assert.equal(pickTelegramStatus([{ context: "telegram/market", state: "weird" }], "market"), "error");
});

test("decideDelivery: status 없음·failure → send", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: null }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: "failure" }).action, "send");
});

test("decideDelivery: success → skip (이미 발송된 리포트는 절대 다시 보내지 않는다)", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "success" }).action, "skip");
});

test("decideDelivery: pending·error → unknown (결과 불명은 자동 재발송하지 않는다)", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "pending" }).action, "unknown");
  assert.equal(decideDelivery({ ...base, telegramStatus: "error" }).action, "unknown");
});

test("decideDelivery: 오늘 리포트 커밋이 없으면 skip (휴장·생성 실패)", () => {
  assert.equal(decideDelivery({ ...base, reportSha: null, telegramStatus: null }).action, "skip");
});

test("decideDelivery: dry_run은 무조건 skip", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: null, dryRun: true }).action, "skip");
  assert.equal(decideDelivery({ ...base, telegramStatus: null, dryRun: true, forceResend: true }).action, "skip");
});

test("decideDelivery: 사람의 명시적 재발송(forceResend)은 status와 무관하게 send — 단 리포트 커밋은 있어야 한다", () => {
  assert.equal(decideDelivery({ ...base, telegramStatus: "success", forceResend: true }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: "pending", forceResend: true }).action, "send");
  assert.equal(decideDelivery({ ...base, reportSha: null, telegramStatus: null, forceResend: true }).action, "skip");
});

test("decideDelivery: 활성화 기준일 이전 리포트는 status가 없어도 재발송하지 않는다 (배포 당일 중복 방지)", () => {
  assert.equal(DELIVERY_TRACKING_SINCE, "2026-09-22");
  const r = decideDelivery({ ...base, date: "2026-09-21", telegramStatus: null });
  assert.equal(r.action, "skip");
  assert.match(r.reason, /기준일/);
});

test("decideDelivery: 이 실행이 방금 생성한 리포트는 기준일과 무관하게 보낸다 (정상 경로)", () => {
  assert.equal(decideDelivery({ ...base, date: "2026-09-21", telegramStatus: null, justGenerated: true }).action, "send");
  assert.equal(decideDelivery({ ...base, telegramStatus: null, justGenerated: true, dryRun: true }).action, "skip");
});

test("classifyTelegramResponse: ok:true → success", () => {
  assert.equal(classifyTelegramResponse('{"ok":true,"result":{"message_id":1700}}').state, "success");
});

test("classifyTelegramResponse: ok:false → failure + description", () => {
  const r = classifyTelegramResponse('{"ok":false,"error_code":400,"description":"Bad Request: can\'t parse entities"}');
  assert.equal(r.state, "failure");
  assert.match(r.detail, /400/);
  assert.match(r.detail, /parse entities/);
});

test("classifyTelegramResponse: 빈 응답·JSON 아님·ok 필드 없음 → error (결과 불명)", () => {
  assert.equal(classifyTelegramResponse("").state, "error");
  assert.equal(classifyTelegramResponse("<html>502 Bad Gateway</html>").state, "error");
  assert.equal(classifyTelegramResponse('{"result":1}').state, "error");
});

test("formatAnomalyBreakdown: 기존 워크플로 one-liner와 같은 출력", () => {
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 8 }), "괴리율 8");
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 2, volumeSpike: 1, consecutiveSell: 1 }), "괴리율 2/거래량 1/매도 1");
  assert.equal(formatAnomalyBreakdown({ premiumDiscount: 0, trackingError: 3 }), "추적오차 3");
  assert.equal(formatAnomalyBreakdown({ somethingNew: 2 }), "somethingNew 2");
  assert.equal(formatAnomalyBreakdown(undefined), "");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/delivery-state.test.ts`
Expected: FAIL — `Cannot find module './delivery-state'`

- [ ] **Step 3: 구현** — `lib/delivery-state.ts`

```ts
// lib/delivery-state.ts
// 리포트가 구독자에게 발송됐는지를 리포트 커밋의 commit status로 추적하기 위한 순수 함수.
// spec: docs/superpowers/specs/2026-09-21-backup-and-delivery-recovery-design.md
//
// 원칙: 중복 발송 금지가 최우선. 결과 불명(pending·error)은 자동 재발송하지 않는다.

export type ReportKind = "market" | "etf";
export type TelegramStatus = "pending" | "success" | "failure" | "error" | null;
export type DeliveryAction = "send" | "skip" | "unknown";

/** 이 날짜보다 이른 리포트는 status가 없어도 재발송하지 않는다 — 이 기능 이전 발송분엔 status가 없다. */
export const DELIVERY_TRACKING_SINCE = "2026-09-22";

export function statusContext(kind: ReportKind): string {
  return `telegram/${kind}`;
}

/** 워크플로의 commit 메시지와 일치해야 한다 (daily-report.yml "Commit and push" step). */
export function reportCommitPrefix(kind: ReportKind, date: string): string {
  return kind === "market" ? `Daily Market Report - ${date} (KST)` : `ETF Daily Report - ${date} (KST)`;
}

export function kstDayStartIso(date: string): string {
  return `${date}T00:00:00+09:00`;
}

export function findReportCommit(
  commits: { sha: string; message: string }[],
  kind: ReportKind,
  date: string,
): string | null {
  const prefix = reportCommitPrefix(kind, date);
  return commits.find((c) => c.message.startsWith(prefix))?.sha ?? null;
}

const KNOWN_STATES = new Set(["pending", "success", "failure", "error"]);

export function pickTelegramStatus(
  statuses: { context: string; state: string }[],
  kind: ReportKind,
): TelegramStatus {
  const hit = statuses.find((s) => s.context === statusContext(kind));
  if (!hit) return null;
  return KNOWN_STATES.has(hit.state) ? (hit.state as TelegramStatus) : "error";
}

export function decideDelivery(input: {
  date: string;
  reportSha: string | null;
  telegramStatus: TelegramStatus;
  /** 이 실행이 방금 리포트를 생성·push했다 — 아직 발송됐을 수 없는 정상 경로 */
  justGenerated: boolean;
  forceResend: boolean;
  dryRun: boolean;
}): { action: DeliveryAction; reason: string } {
  const { date, reportSha, telegramStatus, justGenerated, forceResend, dryRun } = input;
  if (dryRun) return { action: "skip", reason: "dry_run" };
  if (!reportSha) return { action: "skip", reason: "오늘 리포트 커밋 없음(휴장 또는 생성 실패)" };
  if (forceResend) return { action: "send", reason: "resend_telegram_only — 사람의 명시적 재발송" };
  if (justGenerated) return { action: "send", reason: "방금 생성한 리포트 — 발송" };
  if (telegramStatus === "success") return { action: "skip", reason: "이미 발송됨(status=success)" };
  if (telegramStatus === "pending" || telegramStatus === "error") {
    return { action: "unknown", reason: `발송 결과 불명(status=${telegramStatus}) — 자동 재발송하지 않음` };
  }
  if (date < DELIVERY_TRACKING_SINCE) {
    return { action: "skip", reason: `발송 추적 기준일(${DELIVERY_TRACKING_SINCE}) 이전 리포트 — status 없음은 미발송을 뜻하지 않음` };
  }
  return {
    action: "send",
    reason: telegramStatus === "failure" ? "Telegram이 거부함(status=failure) — 재발송" : "발송 기록 없음 — 발송",
  };
}

export function classifyTelegramResponse(body: string): { state: "success" | "failure" | "error"; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { state: "error", detail: `응답이 JSON이 아님: ${body.slice(0, 120)}` };
  }
  const r = parsed as { ok?: unknown; error_code?: unknown; description?: unknown };
  if (r && r.ok === true) return { state: "success", detail: "ok:true" };
  if (r && r.ok === false) {
    return { state: "failure", detail: `ok:false ${String(r.error_code ?? "")} ${String(r.description ?? "")}`.trim() };
  }
  return { state: "error", detail: `ok 필드 없음: ${body.slice(0, 120)}` };
}

const ANOMALY_LABELS: Record<string, string> = {
  premiumDiscount: "괴리율",
  trackingError: "추적오차",
  volumeSpike: "거래량",
  consecutiveSell: "매도",
};

/** "괴리율 2/거래량 1/매도 1" 형태. 0건은 제외, 없으면 빈 문자열. */
export function formatAnomalyBreakdown(breakdown: Record<string, number> | undefined): string {
  return Object.entries(breakdown ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${ANOMALY_LABELS[type] ?? type} ${count}`)
    .join("/");
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test lib/delivery-state.test.ts && npx tsc --noEmit`
Expected: PASS (15 tests), tsc 출력 없음

- [ ] **Step 5: 커밋** (`git add lib/delivery-state.ts lib/delivery-state.test.ts`, 제목: `발송 상태 판정 순수 함수 추가 (commit status 기반, 중복 발송 방지 우선)`)

### Task 2: CLI — GitHub API 읽기·쓰기

**Files:**
- Create: `scripts/delivery-state.ts`

**Interfaces:**
- Consumes: Task 1의 모든 export
- Produces (CLI, 워크플로가 호출):
  - `npx tsx scripts/delivery-state.ts resolve <market|etf>` — env `GH_TOKEN`, `GITHUB_REPOSITORY`, `CHANGED`, `FORCE_RESEND`, `DRY_RUN`. `$GITHUB_OUTPUT`에 `action`, `reason`, `sha`, `date`, `headline`, `resend`, (etf만) `anomaly_count`, `anomaly_breakdown` 기록. 항상 exit 0.
  - `… status <market|etf> <sha>` — stdout에 현재 telegram status(`none|pending|success|failure|error`). API 실패 시 `error` 출력(=보내지 않는 쪽).
  - `… mark <market|etf> <sha> <pending|success|failure|error> [description]` — status 기록, 3회 재시도, 전부 실패하면 exit 1.
  - `… classify` — stdin의 Telegram 응답을 분류해 stdout 첫 줄에 state, 둘째 줄에 detail.

- [ ] **Step 1: 구현** — `scripts/delivery-state.ts`

```ts
// scripts/delivery-state.ts
// 발송 상태(commit status) 읽기·쓰기 CLI. 판정 로직은 lib/delivery-state.ts (순수 함수, 테스트됨).
// 워크플로 .github/workflows/daily-report.yml 의 "Resolve delivery"·발송 step이 호출한다.
import * as fs from "node:fs";
import { execSync } from "node:child_process";
import {
  type ReportKind,
  type TelegramStatus,
  statusContext,
  kstDayStartIso,
  findReportCommit,
  pickTelegramStatus,
  decideDelivery,
  classifyTelegramResponse,
  formatAnomalyBreakdown,
} from "../lib/delivery-state";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const REPO = process.env.GITHUB_REPOSITORY ?? "";
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

function kind(arg: string | undefined): ReportKind {
  if (arg !== "market" && arg !== "etf") throw new Error(`kind는 market|etf 여야 합니다: ${arg}`);
  return arg;
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function kstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function isTrue(v: string | undefined): boolean {
  return v === "true";
}

function setOutput(values: Record<string, string>): void {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v.replace(/[\r\n]+/g, " ")}`);
  if (file) fs.appendFileSync(file, lines.join("\n") + "\n");
  for (const l of lines) console.log(`  output ${l}`);
}

async function readTelegramStatus(k: ReportKind, sha: string): Promise<TelegramStatus> {
  const combined = await gh<{ statuses: { context: string; state: string }[] }>(`/commits/${sha}/status`);
  return pickTelegramStatus(combined.statuses ?? [], k);
}

function readIndexEntry(k: ReportKind, date: string): { headline: string; anomalyCount: number; breakdown: string } {
  const file = k === "market" ? "data/reports-index.json" : "data/etf-reports-index.json";
  const fallback = k === "market" ? "오늘의 시장 리포트" : "오늘의 ETF 리포트";
  try {
    const idx = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      reports: { date: string; headline?: string; anomalyCount?: number; anomalyBreakdown?: Record<string, number> }[];
    };
    const r = idx.reports.find((x) => x.date === date);
    return {
      headline: r?.headline || fallback,
      anomalyCount: r?.anomalyCount || 0,
      breakdown: formatAnomalyBreakdown(r?.anomalyBreakdown),
    };
  } catch {
    return { headline: fallback, anomalyCount: 0, breakdown: "" };
  }
}

async function resolve(k: ReportKind): Promise<void> {
  const date = kstToday();
  const changed = isTrue(process.env.CHANGED);
  const forceResend = isTrue(process.env.FORCE_RESEND);
  const dryRun = isTrue(process.env.DRY_RUN);

  let reportSha: string | null = null;
  let telegramStatus: TelegramStatus = null;
  let lookupError: string | null = null;
  try {
    if (changed && !dryRun) {
      // 이 실행이 방금 push한 리포트 커밋. rebase 뒤의 최종 SHA.
      reportSha = execSync("git rev-parse HEAD").toString().trim();
    } else if (!dryRun) {
      const commits = await gh<{ sha: string; commit: { message: string } }[]>(
        `/commits?sha=main&since=${encodeURIComponent(kstDayStartIso(date))}&per_page=100`,
      );
      reportSha = findReportCommit(commits.map((c) => ({ sha: c.sha, message: c.commit.message })), k, date);
    }
    if (reportSha) telegramStatus = await readTelegramStatus(k, reportSha);
  } catch (e) {
    lookupError = (e as Error).message;
  }

  const justGenerated = changed && !dryRun && reportSha !== null;
  // 조회에 실패하면 보내지 않는 쪽으로 (중복 발송 방지 우선). 단 방금 생성한 정상 경로는 status가 있을 수 없으므로 진행.
  let decision = decideDelivery({ date, reportSha, telegramStatus, justGenerated, forceResend, dryRun });
  if (lookupError && !justGenerated) {
    decision = { action: "unknown", reason: `상태 조회 실패 — 보내지 않음: ${lookupError}` };
  }

  console.log(`Resolve delivery: kind=${k} date=${date} sha=${reportSha ?? "-"} status=${telegramStatus ?? "none"} action=${decision.action} — ${decision.reason}`);
  if (decision.action === "unknown") {
    const msg = `${k} 리포트(${date}) 발송 결과 불명 — 자동 재발송하지 않았습니다. ${decision.reason}. 구독자 채널을 확인한 뒤 필요하면 workflow_dispatch(resend_telegram_only=true, only=${k})로 수동 재발송하십시오.`;
    console.log(`::warning title=Telegram 발송 결과 불명::${msg}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ⚠️ ${msg}\n`);
  }

  const entry = readIndexEntry(k, date);
  setOutput({
    action: decision.action,
    reason: decision.reason,
    sha: reportSha ?? "",
    date,
    headline: entry.headline,
    // 방금 생성한 정상 경로가 아니면 재발송 — Telegram 이미지 캐시를 피하려고 cache-bust 한다.
    resend: changed ? "false" : "true",
    ...(k === "etf" ? { anomaly_count: String(entry.anomalyCount), anomaly_breakdown: entry.breakdown } : {}),
  });
}

async function status(k: ReportKind, sha: string): Promise<void> {
  try {
    console.log((await readTelegramStatus(k, sha)) ?? "none");
  } catch (e) {
    console.error(`status 조회 실패: ${(e as Error).message}`);
    console.log("error"); // 조회 실패는 '불명' — 호출부는 보내지 않는다
  }
}

async function mark(k: ReportKind, sha: string, state: string, description: string): Promise<void> {
  if (!["pending", "success", "failure", "error"].includes(state)) throw new Error(`state 값 오류: ${state}`);
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await gh(`/statuses/${sha}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          context: statusContext(k),
          description: description.slice(0, 140),
          ...(runUrl ? { target_url: runUrl } : {}),
        }),
      });
      console.log(`mark: ${statusContext(k)}=${state} @${sha.slice(0, 7)}`);
      return;
    } catch (e) {
      lastError = (e as Error).message;
      console.error(`mark 실패 (${attempt}/3): ${lastError}`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error(`commit status 기록 실패: ${lastError}`);
}

async function classify(): Promise<void> {
  const body = fs.readFileSync(0, "utf-8");
  const r = classifyTelegramResponse(body);
  console.log(r.state);
  console.log(r.detail);
}

async function main(): Promise<void> {
  const [cmd, a, b, c, ...rest] = process.argv.slice(2);
  if (cmd === "resolve") return resolve(kind(a));
  if (cmd === "status") return status(kind(a), b);
  if (cmd === "mark") return mark(kind(a), b, c, rest.join(" "));
  if (cmd === "classify") return classify();
  throw new Error("usage: delivery-state.ts resolve|status|mark|classify …");
}

main().catch((e) => {
  console.error(`[delivery-state] ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 3: 읽기 전용 실환경 점검** (아무것도 쓰지 않는다 — `resolve`·`status`·`classify`만)

```bash
export GH_TOKEN=$(gh auth token) GITHUB_REPOSITORY=yalkongs/dailyreport
CHANGED=false FORCE_RESEND=false DRY_RUN=false npx tsx scripts/delivery-state.ts resolve market
CHANGED=false FORCE_RESEND=false DRY_RUN=false npx tsx scripts/delivery-state.ts resolve etf
CHANGED=false FORCE_RESEND=false DRY_RUN=true  npx tsx scripts/delivery-state.ts resolve market
printf '{"ok":false,"error_code":400,"description":"Bad Request"}' | npx tsx scripts/delivery-state.ts classify
```

Expected (2026-09-21에 실행할 때): 첫 두 줄은 `sha=<오늘 리포트 커밋> status=none action=skip — 발송 추적 기준일(2026-09-22) 이전 리포트 …`
(오늘 리포트는 이 기능 이전에 발송됐으므로 **send가 나오면 안 된다**). 셋째는 `action=skip — dry_run`. 넷째는 `failure` / `ok:false 400 Bad Request`.
`mark`는 실행하지 않는다(실제 커밋에 status를 쓴다).

- [ ] **Step 4: 커밋** (`git add scripts/delivery-state.ts`, 제목: `발송 상태 CLI 추가 (resolve·status·mark·classify)`)

### Task 3: 워크플로 — 권한·직렬화·Resolve step·발송 step 개정

**Files:**
- Modify: `.github/workflows/daily-report.yml` (permissions 45-47, `market` job 50-213, `etf` job 215-386)
- Test: `lib/workflow-triggers.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가** — `lib/workflow-triggers.test.ts` 끝에

```ts
test("권한: commit status를 쓸 수 있다 (발송 상태 기록)", () => {
  assert.match(yml, /\n  statuses: write/);
});

for (const [job, group] of [["market", "daily-report-market"], ["etf", "daily-report-etf"]] as const) {
  test(`${job}: 같은 종류의 job은 직렬로 돈다 (concurrency, 진행 중 실행을 취소하지 않음)`, () => {
    const b = jobBlock(job);
    assert.match(b, new RegExp(`concurrency:\\n      group: ${group}\\n      cancel-in-progress: false`));
  });

  test(`${job}: Resolve delivery step이 있고, 배포 대기·발송은 action=='send'일 때만 돈다`, () => {
    const b = jobBlock(job);
    assert.match(b, new RegExp(`npx tsx scripts/delivery-state\\.ts resolve ${job}`));
    const gated = b.match(/if: steps\.delivery\.outputs\.action == 'send'/g) ?? [];
    assert.equal(gated.length, 2);
  });

  test(`${job}: 발송 step은 step output을 셸에 직접 보간하지 않는다 (env로만 전달)`, () => {
    const b = jobBlock(job);
    const run = b.slice(b.lastIndexOf("api.telegram.org") - 3000);
    assert.doesNotMatch(run, /="\$\{\{ steps\./);
    assert.doesNotMatch(b, /\n\s+set -x/);
  });

  test(`${job}: 발송 전 pending 기록 → 응답 분류 → 결과 기록`, () => {
    const b = jobBlock(job);
    assert.match(b, new RegExp(`delivery-state\\.ts mark ${job} "\\$REPORT_SHA" pending`));
    assert.match(b, /delivery-state\.ts classify/);
    assert.match(b, new RegExp(`delivery-state\\.ts mark ${job} "\\$REPORT_SHA" "\\$STATE"`));
    assert.match(b, /--max-time 30/);
  });
}

test("krx-probe에는 concurrency가 없다", () => {
  assert.doesNotMatch(jobBlock("krx-probe"), /concurrency:/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts`
Expected: FAIL (신규 10건)

- [ ] **Step 3: 권한과 concurrency**

`permissions:` 블록의 `statuses: read   # 배포 검증 step이 …` 줄을 다음으로 교체:

```yaml
  statuses: write  # Vercel 배포 상태 읽기 + Telegram 발송 상태(telegram/market·etf) 기록
```

`market` job의 `timeout-minutes: 20` 줄 **아래**에 추가(들여쓰기 4칸):

```yaml
    # 같은 종류의 job은 실행(run) 간에도 직렬로 — 정시·2차·3순위·수동 실행이 겹쳐도 뒤 실행이
    # 앞 실행의 커밋과 발송 상태를 반드시 보게 한다. 진행 중 실행은 취소하지 않는다.
    concurrency:
      group: daily-report-market
      cancel-in-progress: false
```

`etf` job의 `timeout-minutes: 15` 줄 아래에 같은 블록을 `group: daily-report-etf`로 추가.

- [ ] **Step 4: market job — 재발송용 헤드라인 step 제거, Resolve step 추가, 조건 교체**

(a) `- name: Read today's market headline (resend mode)` step 전체(id `read_today`)를 삭제한다 — Resolve step이 대신한다.

(b) `- name: Commit and push report` step **뒤**, `- name: Wait for Vercel deployment …` step **앞**에 추가:

```yaml
      - name: Resolve delivery (보낼지 판정 — 발송 상태는 리포트 커밋의 commit status)
        id: delivery
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CHANGED: ${{ steps.changes.outputs.changed }}
          FORCE_RESEND: ${{ (inputs.resend_telegram_only == true || inputs.resend_telegram_only == 'true') && 'true' || 'false' }}
          DRY_RUN: ${{ (inputs.dry_run == true || inputs.dry_run == 'true') && 'true' || 'false' }}
        run: npx tsx scripts/delivery-state.ts resolve market
```

(c) Vercel 대기 step의 `if:` 한 줄을 교체:
`if: steps.changes.outputs.changed == 'true' && inputs.dry_run != true && inputs.dry_run != 'true'` →
`if: steps.delivery.outputs.action == 'send'`

(d) 발송 step의 `if:` 한 줄을 교체:
`if: ${{ (inputs.resend_telegram_only == true || …) || (steps.changes.outputs.changed == 'true' && …) }}` →
`if: steps.delivery.outputs.action == 'send'`

- [ ] **Step 5: market 발송 step의 값 전달·응답 검사**

발송 step의 `env:`를 다음으로 교체:

```yaml
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          REPORT_DATE: ${{ steps.delivery.outputs.date }}
          REPORT_SHA: ${{ steps.delivery.outputs.sha }}
          HEADLINE: ${{ steps.delivery.outputs.headline }}
          IS_RESEND: ${{ steps.delivery.outputs.resend }}
          FORCE_RESEND: ${{ (inputs.resend_telegram_only == true || inputs.resend_telegram_only == 'true') && 'true' || 'false' }}
```

`run: |` 본문에서:
- `set -x` 줄 삭제.
- `REPORT_DATE="${{ … }}"`, `HEADLINE="${{ … }}"`, `IS_RESEND='${{ inputs.resend_telegram_only }}'` 세 줄 삭제(env가 대신한다). `REPORT_URL=…` 이하의 메시지 조립·`OG_IMAGE_URL` 분기(`if [ "$IS_RESEND" = "true" ]`)는 **그대로 둔다.**
- 삭제한 줄들 자리에(=`REPORT_URL=` 줄 위) 추가:

```bash
          # 발송 직전 재확인 — 수동 re-run·겹친 실행 방어. 사람의 명시적 재발송만 우회한다.
          CURRENT=$(npx tsx scripts/delivery-state.ts status market "$REPORT_SHA" | tail -1)
          if [ "$FORCE_RESEND" != "true" ] && [ "$CURRENT" != "none" ] && [ "$CURRENT" != "failure" ]; then
            echo "발송 생략: 현재 status=${CURRENT} (success=이미 발송, pending·error=결과 불명)"
            exit 0
          fi
```

- 마지막의 `curl -s -X POST …` 명령(5줄)을 다음으로 교체:

```bash
          # 발송 직전에 pending을 먼저 기록한다 — 발송 뒤 결과 기록에 실패해도 다음 실행이
          # '결과 불명'으로 보고 재발송하지 않게. pending 기록에 실패하면 보내지 않는다.
          npx tsx scripts/delivery-state.ts mark market "$REPORT_SHA" pending "Telegram 발송 시도 중"

          RESPONSE=$(curl -s --max-time 30 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto" \
            --form-string "chat_id=${TELEGRAM_CHAT_ID}" \
            --form-string "photo=${OG_IMAGE_URL}" \
            --form-string "caption=${MESSAGE}" \
            --form-string "parse_mode=HTML" || true)

          CLASSIFIED=$(printf '%s' "$RESPONSE" | npx tsx scripts/delivery-state.ts classify)
          STATE=$(printf '%s\n' "$CLASSIFIED" | sed -n 1p)
          DETAIL=$(printf '%s\n' "$CLASSIFIED" | sed -n 2p)
          echo "Telegram: ${STATE} — ${DETAIL}"
          npx tsx scripts/delivery-state.ts mark market "$REPORT_SHA" "$STATE" "$DETAIL"
          if [ "$STATE" != "success" ]; then
            echo "::error::Telegram 발송 ${STATE} — ${DETAIL}"
            exit 1
          fi
```

- [ ] **Step 6: etf job — 같은 개정**

Step 4·5와 같은 변경을 etf job에 적용한다. 차이:
- 삭제할 step: `- name: Read today's ETF headline (resend mode)` (id `read_etf_today`).
- Resolve step: `run: npx tsx scripts/delivery-state.ts resolve etf`, step 이름 동일, id `delivery`.
- 발송 step `env:`에 두 줄 추가:
  ```yaml
          ANOMALY_COUNT: ${{ steps.delivery.outputs.anomaly_count }}
          ANOMALY_BREAKDOWN: ${{ steps.delivery.outputs.anomaly_breakdown }}
  ```
- `run:` 본문에서 삭제할 줄: `set -x`, `REPORT_DATE="${{…}}"`, `HEADLINE="${{…}}"`, `ANOMALY_COUNT="${{…}}"`, `ANOMALY_BREAKDOWN="${{…}}"`, `IS_RESEND='${{…}}'`. `ALERT_LINE` 조립·`MESSAGE`·`OG_IMAGE_URL` 분기는 그대로.
- 추가하는 bash 블록의 `market`을 모두 `etf`로.

"Run ETF pipeline"·"Generate market report" step은 건드리지 않는다(거기서 만드는 `date` output은 commit step이 쓴다).

- [ ] **Step 7: 통과 확인**

Run: `npx tsx --test lib/workflow-triggers.test.ts && npx tsx --test lib/*.test.ts lib/etf/*.test.ts && npx tsc --noEmit`
Expected: 전부 PASS, tsc 출력 없음

YAML 구조 확인:

```bash
node -e "
const y=require('js-yaml'),fs=require('fs');
const d=y.load(fs.readFileSync('.github/workflows/daily-report.yml','utf8'));
for (const j of ['market','etf']) {
  const steps=d.jobs[j].steps.map(s=>s.name);
  console.log(j, JSON.stringify(d.jobs[j].concurrency), steps.join(' → '));
}
console.log('permissions', JSON.stringify(d.permissions));
"
```

Expected: 각 job의 step 순서가 `… → Check for changes → Commit and push … → Resolve delivery … → Wait for Vercel … → Send … Telegram notification`이고 `Read today's … (resend mode)`가 없다.

- [ ] **Step 8: 발송 step의 bash 문법 점검** — 두 발송 step의 `run:` 본문을 추출해 `bash -n`으로 검사한다.

```bash
node -e "
const y=require('js-yaml'),fs=require('fs');
const d=y.load(fs.readFileSync('.github/workflows/daily-report.yml','utf8'));
for (const j of ['market','etf']) {
  const s=d.jobs[j].steps.find(s=>/Telegram notification/.test(s.name));
  fs.writeFileSync('/tmp/send-'+j+'.sh', s.run);
}"
bash -n /tmp/send-market.sh && bash -n /tmp/send-etf.sh && echo OK; rm -f /tmp/send-market.sh /tmp/send-etf.sh
```

Expected: `OK` (`${{ }}` 표현식이 `run:` 본문에 남아 있지 않으므로 그대로 파싱된다 — 남아 있으면 그것 자체가 Step 5·6의 누락이다)

- [ ] **Step 9: 커밋** (`git add .github/workflows/daily-report.yml lib/workflow-triggers.test.ts`, 제목: `발송 상태를 commit status로 기록하고 미발송을 다음 실행이 복구 (중복 발송 방지 우선)`)

### Task 4: 배포와 실환경 검증 (수동, 사용자 승인 필요)

- [ ] **Step 1:** 사용자 승인 후 main에 `--no-ff` 머지, 전체 테스트·tsc, push. **그날의 리포트 발송과 3순위 schedule 실행이 끝난 뒤**에 한다 — 시각 추정이 아니라 `gh run list --workflow=daily-report.yml --event schedule --limit 1`로 그날 schedule 실행이 completed인지 확인한다.
  **`DELIVERY_TRACKING_SINCE`는 반드시 (push하는 날 + 1일, KST)이어야 한다.** push가 2026-09-21을 넘기면 상수와 `lib/delivery-state.test.ts`의 단언을 함께 고친다. 어긋나면 push 당일 옛 워크플로가 status 없이 보낸 리포트를 같은 날의 다른 실행이 재발송한다(구현 리뷰에서 발견).
- [ ] **Step 2:** `gh workflow run daily-report.yml --ref main -f dry_run=true` → 두 job success, 로그에 `Resolve delivery: … action=skip — dry_run`, 배포 대기·발송 step `skipped`, 커밋·status 변화 없음.
- [ ] **Step 3 (첫 거래일 아침, 정시 실행 뒤):** 로그에 `action=send — 발송 기록 없음 — 발송` → `mark: telegram/<kind>=pending` → `Telegram: success — ok:true` → `mark: telegram/<kind>=success`. `gh api repos/yalkongs/dailyreport/commits/<리포트 SHA>/status --jq '.statuses[]|"\(.context)=\(.state)"'`에 `telegram/market=success`, `telegram/etf=success`.
- [ ] **Step 4 (같은 날, 발송이 끝난 뒤 — 가장 중요한 검증. 반드시 Step 3에서 `telegram/*=success`를 확인한 날에만):** `gh workflow run daily-report.yml --ref main` (입력 없음) → 두 job의 로그에 `status=success action=skip — 이미 발송됨`, 발송 step `skipped`. **구독자 채널에 두 번째 메시지가 오지 않았음을 사용자가 확인한다.**
- [ ] **Step 5:** `resend_telegram_only=true` dispatch는 검증에 쓰지 않는다. `send` 분기(미발송 복구)는 첫 실제 장애 때 검증된다 — 그때까지 매일 로그의 `Resolve delivery:` 줄로 판정이 맞는지 본다.
- [ ] **되돌리기:** 머지 커밋을 revert. commit status는 남아도 무해하다(읽는 코드가 사라진다).
