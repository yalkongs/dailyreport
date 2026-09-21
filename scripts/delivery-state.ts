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
