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

test("krx-probe: 06:40 정시 dispatch(only=both)에서만 돌고 다른 job과 의존이 없다", () => {
  const job = jobBlock("krx-probe");
  assert.match(
    job,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.only == 'both' && inputs\.dry_run != true && inputs\.dry_run != 'true' && inputs\.resend_telegram_only != true && inputs\.resend_telegram_only != 'true' \}\}/,
  );
  assert.doesNotMatch(job, /needs:/);
  assert.match(job, /timeout-minutes: 170/);
  assert.match(job, /KRX_AUTH_KEY: \$\{\{ secrets\.KRX_AUTH_KEY \}\}/);
  assert.match(job, /npx tsx scripts\/probe-krx-publish\.ts/);
});

test("krx-probe: 읽기 전용 — commit·push·Telegram step이 없다", () => {
  const job = jobBlock("krx-probe");
  assert.doesNotMatch(job, /git (commit|push)/);
  assert.doesNotMatch(job, /api\.telegram\.org/);
});

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

test("krx-probe에는 concurrency가 없다", () => {
  assert.doesNotMatch(jobBlock("krx-probe"), /concurrency:/);
});
