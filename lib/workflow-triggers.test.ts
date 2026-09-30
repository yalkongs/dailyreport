import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "daily-report.yml"), "utf8");

/** `  <name>:` 로 시작하는 job 블록 텍스트(다음 최상위 job 직전까지). */
function jobBlock(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job '${name}' 없음`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}



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

for (const job of ["market", "etf"] as const) {
  test(`${job}: 발송 직전 재확인은 재발송 경로에서만 하고, 조회 실패는 조용히 넘기지 않는다`, () => {
    const b = jobBlock(job);
    assert.match(b, /if \[ "\$IS_RESEND" = "true" \] && \[ "\$FORCE_RESEND" != "true" \]; then/);
    assert.match(b, /success\|pending\)/);
    assert.match(b, /::error::발송 상태 재확인 실패/);
    assert.match(b, /::error::Telegram \$\{STATE\} 이후 상태 기록 실패/);
  });
}


test("ETF 파이프라인 step에도 FORCE_REGENERATE가 전달된다", () => {
  assert.match(jobBlock("etf"), /FORCE_REGENERATE: \$\{\{ inputs\.force_regenerate == true && 'true' \|\| 'false' \}\}/);
});

test("schedule과 job 분기 조건은 그대로다 — 트리거 분리는 inputs.only로만", () => {
  assert.match(yml, /- cron: '30 22 \* \* 0-4'/);
  assert.equal((yml.match(/- cron:/g) ?? []).length, 1);
  assert.match(jobBlock("market"), /if: \$\{\{ inputs\.only != 'etf' \}\}/);
  assert.match(jobBlock("etf"), /if: \$\{\{ always\(\) && \(github\.event_name == 'schedule' \|\| inputs\.only == 'etf'\) \}\}/);
});

// 2026-09-30: 외부 호출(예: 폐기된 cron-job.org의 only=both)이 KRX 게시(~08:00) 전에 ETF를
// 먼저 발송해 08:15 정상 실행을 중복 가드로 막은 사고 방지. ETF는 schedule 또는 only=etf에서만.
test("ETF job은 dispatch only=both·only=market에서 돌지 않는다", () => {
  const cond = jobBlock("etf").match(/if: \$\{\{ (.*) \}\}/)![1];
  const evalCond = (event: string, only: string) =>
    new Function("github", "inputs", `return ${cond.replace(/always\(\)/g, "true")}`)({ event_name: event }, { only });
  assert.equal(evalCond("workflow_dispatch", "both"), false);
  assert.equal(evalCond("workflow_dispatch", "market"), false);
  assert.equal(evalCond("workflow_dispatch", "etf"), true);
  assert.equal(evalCond("schedule", ""), true);
});
