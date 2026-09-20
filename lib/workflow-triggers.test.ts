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
