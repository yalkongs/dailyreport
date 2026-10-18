// scripts/delivery-state.ts·check-delivery.ts CLI를 실제 프로세스로 실행하는 테스트.
// GitHub API는 127.0.0.1의 가짜 서버, deliver job 체크아웃은 임시 git 저장소로 대신한다 — 네트워크·자격증명 불필요.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { calendarFor } from "../scripts/check-delivery";
import { findReportShaInHistory } from "../scripts/delivery-state";

const ROOT = path.join(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SHA = "abc1234567890abc1234567890abc1234567890a";
// ETF 리포트 커밋은 다른 SHA — 종류별 커밋을 찾는지(HEAD나 다른 종류의 커밋이 아닌지) 구분한다.
const ETF_SHA = "def4567890abcdef4567890abcdef4567890abcd";

function kstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/**
 * 그 날짜(기본 오늘 KST) market·etf 리포트 커밋 목록(check-delivery가 씀)과 커밋 statuses를 돌려주는 가짜 GitHub API.
 * date: null이면 리포트 커밋이 없는 main을 흉내 낸다. statuses는 어느 커밋 SHA로 물어도 같은 값을 준다.
 * "http-500"은 모든 요청, "status-500"은 commit status 조회만 실패시킨다.
 */
async function fakeGitHub(
  statuses: { context: string; state: string }[] | "http-500" | "status-500",
  fn: (apiUrl: string) => Promise<void>,
  date: string | null = kstToday(),
): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (statuses === "http-500") return send(500, { message: "boom" });
    if (url.pathname === "/repos/o/r/commits") {
      if (date === null) return send(200, [{ sha: "c0de", commit: { message: "Merge branch 'x'" } }]);
      return send(200, [
        { sha: ETF_SHA, commit: { message: `ETF Daily Report - ${date} (KST)` } },
        { sha: SHA, commit: { message: `Daily Market Report - ${date} (KST)` } },
      ]);
    }
    if (/^\/repos\/o\/r\/commits\/[0-9a-f]{40}\/status$/.test(url.pathname)) {
      return statuses === "status-500" ? send(500, { message: "boom" }) : send(200, { statuses });
    }
    send(404, { message: "Not Found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
  summary: string;
}

/** GITHUB_* 환경은 상속하지 않는다 — CI에서 돌 때 CI step의 출력 파일을 건드리지 않게. */
function runCli(script: string, args: string[], env: Record<string, string>): Promise<CliResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-"));
  const outFile = path.join(dir, "output");
  const summaryFile = path.join(dir, "summary");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, path.join(ROOT, "scripts", script), ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        GITHUB_REPOSITORY: "o/r",
        GH_TOKEN: "x",
        GITHUB_OUTPUT: outFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        NODE_ENV: "test", // Next 타입이 ProcessEnv에 NODE_ENV를 필수로 둔다
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
      resolve({ code, stdout, stderr, output: read(outFile), summary: read(summaryFile) });
    });
  });
}

// ── resolve: 리포트 커밋은 deliver job 체크아웃(fetch-depth 0)의 git 이력에서 찾는다 ─────────────────────
// HEAD = 배포 대기가 기다리는 바로 그 커밋. HEAD의 조상 중 그날 리포트 커밋(최신)을 고른다 — API 호출 없이
// 결정적이고, 발송하는 리포트가 기다린 배포에 들어 있음을 보장한다. 테스트는 임시 저장소를 DELIVERY_GIT_DIR로
// 넘긴다(GitHub API를 GITHUB_API_URL로 가짜 서버에 돌리는 것과 같은 방식). commit status는 여전히 API.

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function gitIn(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    // NODE_ENV: Next 타입이 ProcessEnv에 필수로 둔다
    env: { ...GIT_ENV, HOME: cwd, PATH: process.env.PATH ?? "", NODE_ENV: "test", ...extraEnv },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

const TODAY = kstToday();
const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const marketMsg = (d: string) => `Daily Market Report - ${d} (KST)`;
const etfMsg = (d: string) => `ETF Daily Report - ${d} (KST)`;

/**
 * deliver job 체크아웃을 흉내 낸 임시 저장소. commits를 차례로 main에 빈 커밋으로 쌓고(at: 커밋 시각 ISO),
 * side: true인 커밋은 HEAD의 조상이 아닌 곁가지에만 둔다. 끝에 HEAD는 main. shas는 commits와 같은 순서.
 */
function reportRepo(commits: { message: string; at?: string; side?: boolean }[]): { dir: string; shas: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deliver-repo-"));
  gitIn(dir, ["init", "-q", "-b", "main"]);
  gitIn(dir, ["commit", "-q", "--allow-empty", "-m", "seed"], { GIT_COMMITTER_DATE: `${YESTERDAY}T05:00:00+09:00`, GIT_AUTHOR_DATE: `${YESTERDAY}T05:00:00+09:00` });
  const shas: string[] = [];
  for (const c of commits) {
    const dates: Record<string, string> = c.at ? { GIT_COMMITTER_DATE: c.at, GIT_AUTHOR_DATE: c.at } : {};
    if (c.side) gitIn(dir, ["checkout", "-q", "-B", "side"]);
    gitIn(dir, ["commit", "-q", "--allow-empty", "-m", c.message], dates);
    shas.push(gitIn(dir, ["rev-parse", "HEAD"]));
    if (c.side) gitIn(dir, ["checkout", "-q", "main"]);
  }
  return { dir, shas };
}

/** 오늘 market·etf 리포트가 하나씩 있는 평범한 아침. */
const todayRepo = () => reportRepo([{ message: marketMsg(TODAY) }, { message: etfMsg(TODAY) }]);

const resolveEnv = (api: string, gitDir: string) => ({
  GITHUB_API_URL: api,
  DELIVERY_GIT_DIR: gitDir,
  CHANGED: "false",
  FORCE_RESEND: "false",
  DRY_RUN: "false",
  GITHUB_RUN_ATTEMPT: "1",
});

// 감사 F06: 결과 불명(unknown)은 자동 재발송하지 않되, workflow를 녹색으로 두면 아무도 모른다.
// 출력·요약을 남긴 뒤 비정상 종료해 job을 실패시킨다(GitHub가 소유자에게 메일).
test("resolve: 기존 status가 pending이면 action=unknown 출력·요약을 남기고 exit 1", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "telegram/market", state: "pending" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], resolveEnv(api, repo.dir));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, new RegExp(`^sha=${repo.shas[0]}$`, "m"));
    assert.match(r.summary, /발송 결과 불명/);
    assert.match(r.stdout, /::error title=Telegram 발송 결과 불명::/);
  });
});

test("resolve: GitHub 조회 실패도 unknown → exit 1 (보내지 않음)", async () => {
  const repo = todayRepo();
  await fakeGitHub("http-500", async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], resolveEnv(api, repo.dir));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, /^reason=상태 조회 실패/m);
  });
});

test("resolve: 이미 발송(success)이면 skip, exit 0", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "telegram/etf", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], resolveEnv(api, repo.dir));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=skip$/m);
    assert.equal(r.summary, "");
  });
});

test("resolve: 발송 기록이 없으면 send(재발송 경로), exit 0", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], resolveEnv(api, repo.dir));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=send$/m);
    assert.match(r.output, /^resend=true$/m);
  });
});

// DELIVERY_GIT_DIR가 없는 경로여도 통과 = dry_run은 git·API 조회를 하지 않는다.
test("resolve: dry_run은 조회 없이 skip, exit 0", async () => {
  const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(UNREACHABLE, "/nonexistent/repo"), DRY_RUN: "true" });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.output, /^action=skip$/m);
});

test("resolve: dry_run은 방금 생성(CHANGED=true)이어도 조회 없이 skip", async () => {
  const r = await runCli("delivery-state.ts", ["resolve", "etf"], {
    ...resolveEnv(UNREACHABLE, "/nonexistent/repo"),
    CHANGED: "true",
    DRY_RUN: "true",
  });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.output, /^action=skip$/m);
});

// 가짜 GitHub의 /commits 목록은 다른 SHA(SHA·ETF_SHA)를 준다 — 결과가 로컬 커밋 SHA면 API 목록을 쓰지 않은 것.
for (const [kind, idx] of [["market", 0], ["etf", 1]] as const) {
  test(`resolve ${kind}: 리포트 커밋을 git 이력(HEAD의 조상)에서 찾는다 — CHANGED=true면 send(방금 생성, cache-bust 없음)`, async () => {
    const repo = todayRepo();
    await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
      const r = await runCli("delivery-state.ts", ["resolve", kind], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.output, /^action=send$/m);
      assert.match(r.output, new RegExp(`^sha=${repo.shas[idx]}$`, "m"));
      assert.match(r.output, /^resend=false$/m);
      // Ruling 30: ETF 화면에 이상 탐지 섹션이 없으므로 캡션 줄도, 그 줄만 먹던 resolve 출력도 없다.
      assert.doesNotMatch(r.output, /^anomaly_/m);
    });
  });
}

test("resolve: 같은 날 같은 종류 커밋이 여럿이면(강제 재생성) HEAD에 가장 가까운 최신 커밋", async () => {
  const repo = reportRepo([
    { message: marketMsg(TODAY), at: `${TODAY}T06:50:00+09:00` },
    { message: etfMsg(TODAY), at: `${TODAY}T06:52:00+09:00` },
    { message: marketMsg(TODAY), at: `${TODAY}T07:25:00+09:00` },
    { message: "Refresh KR macro calendar — weekly auto", at: `${TODAY}T07:26:00+09:00` },
  ]);
  await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
    const m = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(m.code, 0, m.stdout + m.stderr);
    assert.match(m.output, new RegExp(`^sha=${repo.shas[2]}$`, "m"));
    const e = await runCli("delivery-state.ts", ["resolve", "etf"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(e.code, 0, e.stdout + e.stderr);
    assert.match(e.output, new RegExp(`^sha=${repo.shas[1]}$`, "m"));
  });
});

// 생성 job이 changed=true라고 했는데 HEAD 이력에 커밋이 없다 = push가 반영되지 않았거나 체크아웃이 어긋났다.
// '오늘 리포트 없음'으로 조용히 넘기지 않고 결과 불명(exit 1)으로 드러낸다.
test("resolve: CHANGED=true인데 오늘 리포트 커밋이 없으면(어제 것만) unknown → exit 1", async () => {
  const repo = reportRepo([{ message: marketMsg(YESTERDAY), at: `${YESTERDAY}T06:50:00+09:00` }]);
  await fakeGitHub([], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, /^reason=.*찾지 못함/m);
    assert.match(r.summary, /발송 결과 불명/);
  });
});

// 기다린 배포(HEAD)에 들어 있지 않은 커밋은 보내지 않는다 — 곁가지의 같은 메시지 커밋은 무시.
test("resolve: HEAD의 조상이 아닌 리포트 커밋은 찾지 않는다 (CHANGED=true → unknown, CHANGED=false → skip)", async () => {
  const repo = reportRepo([{ message: marketMsg(TODAY), side: true }]);
  await fakeGitHub([], async (api) => {
    const changed = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(changed.code, 1, changed.stdout + changed.stderr);
    assert.match(changed.output, /^action=unknown$/m);
    assert.match(changed.output, /^sha=$/m);
    const unchanged = await runCli("delivery-state.ts", ["resolve", "market"], resolveEnv(api, repo.dir));
    assert.equal(unchanged.code, 0, unchanged.stdout + unchanged.stderr);
    assert.match(unchanged.output, /^action=skip$/m);
    assert.match(unchanged.output, /^reason=오늘 리포트 커밋 없음/m);
  });
});

test("resolve: git 이력을 읽지 못하면 unknown → exit 1 (보내지 않음)", async () => {
  await fakeGitHub([], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], resolveEnv(api, "/nonexistent/repo"));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, /^reason=상태 조회 실패/m);
  });
});

// deliver job만 다시 실행(re-run)하면 생성 job의 outputs(changed=true)가 그대로 재사용된다. 첫 시도에서 이미
// 보낸 리포트를 '방금 생성'으로 보고 다시 보내면 중복 발송 — status가 있으면 일반 판정을 따른다.
test("resolve: CHANGED=true여도 이미 발송(success)된 리포트는 skip — deliver 재실행 중복 방지", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "telegram/market", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=skip$/m);
  });
});

test("resolve: CHANGED=true여도 발송 결과 불명(pending)이면 unknown → exit 1", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "telegram/etf", state: "pending" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
  });
});

// 재실행(GITHUB_RUN_ATTEMPT > 1)에서는 '방금 생성' 지름길을 쓰지 않는다: status를 못 읽은 채 CHANGED=true만 믿고
// 보내면, 첫 시도에서 이미 보낸 리포트를 다시 보낼 수 있다. 커밋 찾기는 성공하고 status 조회만 실패하게 고립한다.
test("resolve: 재실행(attempt 2)에서 status 조회만 실패하면 CHANGED=true여도 보내지 않는다 → unknown, exit 1", async () => {
  const repo = todayRepo();
  await fakeGitHub("status-500", async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true", GITHUB_RUN_ATTEMPT: "2" });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, new RegExp(`^sha=${repo.shas[0]}$`, "m")); // 커밋은 찾았다 — 실패는 status 조회뿐
    assert.match(r.output, /^reason=상태 조회 실패.*GitHub API 500/m);
  });
});

test("resolve: 첫 시도(attempt 1)에서는 방금 생성한 리포트를 status 조회 실패와 무관하게 보낸다(기존 동작)", async () => {
  const repo = todayRepo();
  await fakeGitHub("status-500", async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv(api, repo.dir), CHANGED: "true" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=send$/m);
    assert.match(r.output, /^resend=false$/m);
  });
});

test("resolve: 재실행(attempt 2)에서 status가 없으면 일반 경로로 send — 발송 직전 재확인·cache-bust(resend=true)", async () => {
  const repo = todayRepo();
  await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], { ...resolveEnv(api, repo.dir), CHANGED: "true", GITHUB_RUN_ATTEMPT: "2" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=send$/m);
    assert.match(r.output, /^resend=true$/m);
  });
});

test("findReportShaInHistory: HEAD에서 그날 00:00 KST 이후 이력만 읽고, 그 종류의 최신 커밋을 고른다", () => {
  const calls: string[][] = [];
  const sha = findReportShaInHistory("etf", "2026-10-19", (args) => {
    calls.push(args);
    return [`c3\t${marketMsg("2026-10-19")}`, `c2\t${etfMsg("2026-10-19")}`, `c1\t${etfMsg("2026-10-19")}`, ""].join("\n");
  });
  assert.equal(sha, "c2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "log");
  assert.ok(calls[0].includes("HEAD"), calls[0].join(" "));
  assert.ok(calls[0].includes("--since=2026-10-19T00:00:00+09:00"), calls[0].join(" "));
  assert.equal(findReportShaInHistory("market", "2026-10-19", () => `c1\t${etfMsg("2026-10-19")}\n`), null);
});

// ── check-delivery: 독립 도착 감시(감사 F06b). 날짜를 인자로 고정해 오늘 요일·휴일과 무관하게 검증 ──

const BUSINESS_DAY = "2026-10-14"; // 수요일, 한국 영업일
const UNREACHABLE = "http://127.0.0.1:1"; // 조회하면 바로 실패 — 휴장일엔 조회 자체를 안 해야 한다

test("check-delivery: 영업일 + telegram status success → exit 0", async () => {
  await fakeGitHub([{ context: "telegram/market", state: "success" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["market", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.summary, /발송 완료/);
  }, BUSINESS_DAY);
});

test("check-delivery: 휴장일(한글날·주말)은 조회 없이 exit 0", async () => {
  for (const date of ["2026-10-09", "2026-10-17"]) {
    const r = await runCli("check-delivery.ts", ["etf", date], { GITHUB_API_URL: UNREACHABLE });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /휴장/);
  }
});

test("check-delivery: 리포트 커밋은 있는데 status가 없으면 미발송 → exit 1 + 요약", async () => {
  await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["etf", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /::error title=리포트 도착 감시 \(etf\)::.*미발송/);
    assert.match(r.summary, /미발송/);
  }, BUSINESS_DAY);
});

test("check-delivery: pending(결과 불명) → exit 1", async () => {
  await fakeGitHub([{ context: "telegram/market", state: "pending" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["market", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.summary, /status=pending/);
  }, BUSINESS_DAY);
});

test("check-delivery: 오늘 리포트 커밋이 없으면 리포트 없음 → exit 1", async () => {
  await fakeGitHub([], async (api) => {
    const r = await runCli("check-delivery.ts", ["market", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.summary, /리포트 없음/);
  }, null);
});

test("check-delivery: GitHub 조회 실패 → exit 1 (조회 실패)", async () => {
  const r = await runCli("check-delivery.ts", ["market", BUSINESS_DAY], { GITHUB_API_URL: UNREACHABLE });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.summary, /조회 실패/);
});

test("check-delivery: 날짜 인자가 없으면 오늘(KST)을 본다", async () => {
  await fakeGitHub([{ context: "telegram/etf", state: "success" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["etf"], { GITHUB_API_URL: api });
    // 영업일이면 success로, 휴장이면 휴장으로 통과. 휴장 캘린더가 없는 해(연초 미갱신)만 실패가 맞다.
    assert.equal(r.code, calendarFor(kstToday()).calendarCovered ? 0 : 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`date=${kstToday()}`));
  });
});

// 07:45 감시 하나가 두 리포트를 본다(spec §5) — all은 둘 다 판정하고, 하나라도 실패면 exit 1, 요약에 둘 다 남긴다.
test("check-delivery all: 두 리포트 모두 발송 완료 → exit 0, 요약에 둘 다", async () => {
  await fakeGitHub([{ context: "telegram/market", state: "success" }, { context: "telegram/etf", state: "success" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["all", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.summary, /마켓 리포트\(2026-10-14\): 발송 완료/);
    assert.match(r.summary, /ETF 리포트\(2026-10-14\): 발송 완료/);
  }, BUSINESS_DAY);
});

test("check-delivery all: 하나라도 미발송이면 exit 1 — 실패한 종류만 ::error, 요약에는 둘 다", async () => {
  await fakeGitHub([{ context: "telegram/market", state: "success" }], async (api) => {
    const r = await runCli("check-delivery.ts", ["all", BUSINESS_DAY], { GITHUB_API_URL: api });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /::error title=리포트 도착 감시 \(etf\)::.*미발송/);
    assert.doesNotMatch(r.stdout, /::error title=리포트 도착 감시 \(market\)/);
    assert.match(r.summary, /✅ 마켓 리포트\(2026-10-14\): 발송 완료/);
    assert.match(r.summary, /⚠️ ETF 리포트\(2026-10-14\): 미발송/);
  }, BUSINESS_DAY);
});

test("check-delivery all: 휴장일은 조회 없이 둘 다 통과 → exit 0", async () => {
  const r = await runCli("check-delivery.ts", ["all", "2026-10-09"], { GITHUB_API_URL: UNREACHABLE });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal((r.summary.match(/휴장\(한글날\)/g) ?? []).length, 2, r.summary);
});

test("check-delivery: kind·날짜 인자 오류는 exit 1", async () => {
  assert.equal((await runCli("check-delivery.ts", ["bond"], { GITHUB_API_URL: UNREACHABLE })).code, 1);
  assert.equal((await runCli("check-delivery.ts", ["market", "2026/10/14"], { GITHUB_API_URL: UNREACHABLE })).code, 1);
});
