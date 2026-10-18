// scripts/delivery-state.ts
// 발송 상태(commit status) 읽기·쓰기 CLI. 판정 로직은 lib/delivery-state.ts (순수 함수, 테스트됨).
// 워크플로 .github/workflows/daily-report.yml 의 deliver job("resolve <kind>"·"send <kind>" step)이 호출한다.
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  type ReportKind,
  type TelegramStatus,
  statusContext,
  kstDayStartIso,
  findReportCommit,
  reportCommitPrefix,
  pickTelegramStatus,
  decideDelivery,
  classifyTelegramResponse,
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

export function kstToday(): string {
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

// 아래 두 조회는 scripts/check-delivery.ts(독립 도착 감시)도 그대로 쓴다 — 같은 커밋·같은 context.
export async function readTelegramStatus(k: ReportKind, sha: string): Promise<TelegramStatus> {
  const combined = await gh<{ statuses: { context: string; state: string }[] }>(`/commits/${sha}/status`);
  return pickTelegramStatus(combined.statuses ?? [], k);
}

/** main에서 그 날짜(KST)의 리포트 커밋을 찾는다(GitHub API). 없으면 null, 조회 실패는 throw. check-delivery가 쓴다. */
export async function findReportSha(k: ReportKind, date: string): Promise<string | null> {
  const commits = await gh<{ sha: string; commit: { message: string } }[]>(
    `/commits?sha=main&since=${encodeURIComponent(kstDayStartIso(date))}&per_page=100`,
  );
  return findReportCommit(commits.map((c) => ({ sha: c.sha, message: c.commit.message })), k, date);
}

/** git 실행기. 저장소 위치는 DELIVERY_GIT_DIR(테스트가 임시 저장소를 넘긴다 — GITHUB_API_URL과 같은 방식), 기본은 현재 디렉터리. */
export type GitRunner = (args: string[]) => string;
const runGit: GitRunner = (args) =>
  execFileSync("git", args, {
    cwd: process.env.DELIVERY_GIT_DIR || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });

/**
 * 체크아웃의 git 이력에서 그 날짜(KST)의 리포트 커밋을 찾는다 — HEAD의 조상 중 가장 최신(HEAD에 가까운) 것.
 * deliver job은 fetch-depth 0으로 체크아웃하고, 배포 대기도 이 HEAD를 기다린다 — 그래서 찾은 커밋은 기다린 배포에
 * 반드시 들어 있다. API 호출이 없어 결정적이다. 없으면 null, git 실패는 throw(호출부가 결과 불명으로 처리).
 * --since(그날 00:00 KST, 커밋 시각 기준)는 이력 탐색 범위만 줄인다 — 날짜는 커밋 메시지 접두어로 정확히 맞춘다.
 */
export function findReportShaInHistory(k: ReportKind, date: string, git: GitRunner = runGit): string | null {
  const out = git(["log", "HEAD", `--since=${kstDayStartIso(date)}`, "--format=%H%x09%s"]);
  const commits = out
    .split("\n")
    .filter((l) => l.includes("\t"))
    .map((l) => ({ sha: l.slice(0, l.indexOf("\t")), message: l.slice(l.indexOf("\t") + 1) }));
  return findReportCommit(commits, k, date);
}

function readIndexEntry(k: ReportKind, date: string): { headline: string } {
  const file = k === "market" ? "data/reports-index.json" : "data/etf-reports-index.json";
  const fallback = k === "market" ? "오늘의 시장 리포트" : "오늘의 ETF 리포트";
  try {
    const idx = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      reports: { date: string; headline?: string }[];
    };
    const r = idx.reports.find((x) => x.date === date);
    return { headline: r?.headline || fallback };
  } catch {
    return { headline: fallback };
  }
}

async function resolve(k: ReportKind): Promise<void> {
  const date = kstToday();
  const changed = isTrue(process.env.CHANGED);
  const forceResend = isTrue(process.env.FORCE_RESEND);
  const dryRun = isTrue(process.env.DRY_RUN);
  // 재실행(re-run) 여부. GITHUB_RUN_ATTEMPT는 러너가 모든 step에 넣는 기본 환경변수(첫 시도 1)라 workflow에서 따로
  // 넘기지 않는다(GITHUB_* 기본값은 env로 덮어쓸 수도 없다). 읽을 수 없는 값은 재실행으로 본다(보수적).
  const attempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT ?? "1", 10);
  const rerun = !(attempt <= 1);

  let reportSha: string | null = null;
  let telegramStatus: TelegramStatus = null;
  let lookupError: string | null = null;
  try {
    if (!dryRun) {
      // 발송은 deliver job이 한다(2026-10-19). 리포트 커밋은 이 job 체크아웃(fetch-depth 0)의 git 이력에서 찾는다 —
      // 배포 대기가 기다리는 HEAD의 조상 중 그날 그 종류의 최신 커밋. 방금 생성(CHANGED=true)이어도 같다.
      reportSha = findReportShaInHistory(k, date);
    }
    if (reportSha) telegramStatus = await readTelegramStatus(k, reportSha);
  } catch (e) {
    lookupError = (e as Error).message;
  }
  if (changed && !dryRun && reportSha === null && lookupError === null) {
    // 생성 job은 changed=true(커밋함)라고 했는데 HEAD 이력에 그 커밋이 없다 — push 미반영이거나 체크아웃이 어긋났다.
    // '오늘 리포트 없음'으로 조용히 넘기지 않고 결과 불명(아래 unknown → exit 1)으로 드러낸다.
    lookupError = `생성 job이 커밋했다고 보고한 리포트(${reportCommitPrefix(k, date)})를 HEAD 이력에서 찾지 못함 — push 미반영 또는 체크아웃 불일치`;
  }

  // 방금 생성한 정상 경로 — 아직 발송됐을 수 없으므로 status 없이 보낸다. 단 status가 이미 있으면(deliver job만
  // 다시 실행해 생성 job의 changed=true가 재사용된 경우 등) 일반 판정을 따라 중복 발송을 막는다.
  // 재실행(attempt > 1)에서는 이 지름길을 아예 쓰지 않는다 — 첫 시도가 이미 보냈을 수 있으므로, status를 못 읽으면
  // (lookupError) 아래에서 결과 불명으로 막고, status가 없으면 일반 경로(재확인·cache-bust)로 보낸다.
  const justGenerated = changed && !dryRun && !rerun && reportSha !== null && telegramStatus === null;
  // 조회에 실패하면 보내지 않는 쪽으로 (중복 발송 방지 우선). 단 방금 생성한 정상 경로는 status가 있을 수 없으므로 진행.
  let decision = decideDelivery({ date, reportSha, telegramStatus, justGenerated, forceResend, dryRun });
  if (lookupError && !justGenerated) {
    decision = { action: "unknown", reason: `상태 조회 실패 — 보내지 않음: ${lookupError}` };
  }

  console.log(`Resolve delivery: kind=${k} date=${date} attempt=${process.env.GITHUB_RUN_ATTEMPT ?? "-"} sha=${reportSha ?? "-"} status=${telegramStatus ?? "none"} action=${decision.action} — ${decision.reason}`);
  if (decision.action === "unknown") {
    const msg = `${k} 리포트(${date}) 발송 결과 불명 — 자동 재발송하지 않았습니다. ${decision.reason}. 구독자 채널을 확인한 뒤 필요하면 workflow_dispatch(resend_telegram_only=true, only=${k})로 수동 재발송하십시오.`;
    console.log(`::error title=Telegram 발송 결과 불명::${msg}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ⚠️ ${msg}\n`);
  }

  const entry = readIndexEntry(k, date);
  setOutput({
    action: decision.action,
    reason: decision.reason,
    sha: reportSha ?? "",
    date,
    headline: entry.headline,
    // 방금 생성한 정상 경로가 아니면 재발송 — Telegram 이미지 캐시를 피하려고 cache-bust 하고, 발송 직전 status를 재확인한다.
    resend: justGenerated ? "false" : "true",
  });

  // 결과 불명은 자동 재발송하지 않지만(중복 방지), 녹색으로 끝나면 아무도 모른다(감사 F06).
  // 출력·요약을 다 쓴 뒤 비정상 종료해 job을 실패시킨다 — GitHub가 소유자에게 실패 메일을 보낸다.
  // 이후 배포 대기·발송 step은 실패로 건너뛰고, action=='send' 조건도 그대로 이중 방어한다.
  if (decision.action === "unknown") process.exitCode = 1;
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

// 직접 실행할 때만 CLI로 동작한다 — check-delivery.ts·테스트가 import해도 main()이 돌지 않게.
if (require.main === module) {
  main().catch((e) => {
    console.error(`[delivery-state] ${(e as Error).message}`);
    process.exit(1);
  });
}
