// scripts/delivery-state.ts·check-delivery.ts CLI를 실제 프로세스로 실행하는 테스트.
// GitHub API는 127.0.0.1의 가짜 서버로 대신한다 — 네트워크·자격증명 불필요.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

const ROOT = path.join(__dirname, "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SHA = "abc1234567890abc1234567890abc1234567890a";

function kstToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/** 오늘 자 market·etf 리포트 커밋 하나와 그 커밋의 statuses를 돌려주는 가짜 GitHub API. */
async function fakeGitHub(
  statuses: { context: string; state: string }[] | "http-500",
  fn: (apiUrl: string) => Promise<void>,
): Promise<void> {
  const today = kstToday();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (statuses === "http-500") return send(500, { message: "boom" });
    if (url.pathname === "/repos/o/r/commits") {
      return send(200, [
        { sha: SHA, commit: { message: `Daily Market Report - ${today} (KST)` } },
        { sha: SHA, commit: { message: `ETF Daily Report - ${today} (KST)` } },
      ]);
    }
    if (url.pathname === `/repos/o/r/commits/${SHA}/status`) return send(200, { statuses });
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

const resolveEnv = (api: string) => ({ GITHUB_API_URL: api, CHANGED: "false", FORCE_RESEND: "false", DRY_RUN: "false" });

// 감사 F06: 결과 불명(unknown)은 자동 재발송하지 않되, workflow를 녹색으로 두면 아무도 모른다.
// 출력·요약을 남긴 뒤 비정상 종료해 job을 실패시킨다(GitHub가 소유자에게 메일).
test("resolve: 기존 status가 pending이면 action=unknown 출력·요약을 남기고 exit 1", async () => {
  await fakeGitHub([{ context: "telegram/market", state: "pending" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], resolveEnv(api));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, new RegExp(`^sha=${SHA}$`, "m"));
    assert.match(r.summary, /발송 결과 불명/);
    assert.match(r.stdout, /::error title=Telegram 발송 결과 불명::/);
  });
});

test("resolve: GitHub 조회 실패도 unknown → exit 1 (보내지 않음)", async () => {
  await fakeGitHub("http-500", async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], resolveEnv(api));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.output, /^action=unknown$/m);
    assert.match(r.output, /^reason=상태 조회 실패/m);
  });
});

test("resolve: 이미 발송(success)이면 skip, exit 0", async () => {
  await fakeGitHub([{ context: "telegram/etf", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "etf"], resolveEnv(api));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=skip$/m);
    assert.equal(r.summary, "");
  });
});

test("resolve: 발송 기록이 없으면 send(재발송 경로), exit 0", async () => {
  await fakeGitHub([{ context: "Vercel", state: "success" }], async (api) => {
    const r = await runCli("delivery-state.ts", ["resolve", "market"], resolveEnv(api));
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.output, /^action=send$/m);
    assert.match(r.output, /^resend=true$/m);
  });
});

test("resolve: dry_run은 조회 없이 skip, exit 0", async () => {
  const r = await runCli("delivery-state.ts", ["resolve", "market"], { ...resolveEnv("http://127.0.0.1:1"), DRY_RUN: "true" });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.output, /^action=skip$/m);
});
