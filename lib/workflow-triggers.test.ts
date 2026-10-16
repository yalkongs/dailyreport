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

  // 감사 F06: resolve는 결과 불명(unknown)이면 exit 1 — 그 실패가 job 실패(소유자 메일)로 드러나야 한다.
  test(`${job}: Resolve delivery 실패(결과 불명)를 continue-on-error로 가리지 않는다`, () => {
    const b = jobBlock(job);
    const start = b.indexOf("- name: Resolve delivery");
    const step = b.slice(start, b.indexOf("\n      - name: ", start + 1));
    assert.match(step, /id: delivery/);
    assert.doesNotMatch(step, /continue-on-error/);
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


// 감사 F05: market·etf·주간 매크로 갱신은 concurrency 그룹이 달라 같은 main에 동시에 push한다.
// rebase 실패를 `|| true`로 삼키고 push를 한 번만 하던 구조를 제한 재시도로 바꿨다.
const macroYml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "refresh-kr-macro.yml"), "utf8");

/** 블록에서 `- name: <prefix>…` step 텍스트(다음 step 직전까지). */
function stepBlock(block: string, namePrefix: string): string {
  const start = block.indexOf(`- name: ${namePrefix}`);
  assert.ok(start >= 0, `step '${namePrefix}' 없음`);
  const next = block.indexOf("\n      - name: ", start + 1);
  return next < 0 ? block.slice(start) : block.slice(start, next);
}

const pushSteps: [string, string][] = [
  ["market", stepBlock(jobBlock("market"), "Commit and push report")],
  ["etf", stepBlock(jobBlock("etf"), "Commit and push ETF report")],
  ["refresh-kr-macro", stepBlock(macroYml, "Commit and push")],
];
for (const [label, step] of pushSteps) {
  test(`${label}: main push는 rebase 실패를 삼키지 않고 제한 재시도한다`, () => {
    assert.doesNotMatch(step, /git pull --rebase[^\n]*\|\| true/);
    assert.match(step, /for attempt in 1 2 3 4 5; do/);
    assert.match(step, /if git pull --rebase origin \S+ && git push; then/);
    assert.match(step, /git rebase --abort 2>\/dev\/null \|\| true/);
    assert.match(step, /sleep \$\(\(attempt \* 5\)\)/);
    assert.match(step, /::error::main 반영 5회 실패/);
    assert.match(step, /\n\s+exit 1\n/);
    // rebase는 commit 뒤 — 앞에 오면 더러운 트리로 매번 거부된다(기존 인시던트 주석).
    assert.ok(step.indexOf("git commit") < step.indexOf("git pull --rebase"), "rebase가 commit보다 앞에 있음");
  });
}

// 감사 F03: Vercel success만으로는 이 날짜의 PNG가 실제로 올라갔는지 모른다. 발송 step이
// 텔레그램에 넘길 바로 그 URL을 발송(pending 기록) 전에 확인한다.
for (const [job, sendStep] of [["market", "Send Telegram notification"], ["etf", "Send ETF Telegram notification"]] as const) {
  test(`${job}: 발송 전에 텔레그램이 가져갈 프리뷰 PNG·본문 URL을 실제로 확인한다`, () => {
    const s = stepBlock(jobBlock(job), sendStep);
    const ogDef = s.lastIndexOf('OG_IMAGE_URL="https://dailyreport-eta.vercel.app/');
    const check = s.indexOf(`-w '%{http_code} %{content_type}' "$OG_IMAGE_URL"`);
    const pageCheck = s.indexOf(`-w '%{http_code} %{content_type}' "$REPORT_URL"`);
    const pending = s.indexOf(`delivery-state.ts mark ${job} "$REPORT_SHA" pending`);
    const telegram = s.indexOf("api.telegram.org");
    assert.ok(ogDef >= 0 && check >= 0 && pageCheck >= 0 && pending >= 0 && telegram >= 0);
    assert.ok(ogDef < check, "자산 확인이 OG_IMAGE_URL 정의보다 앞");
    assert.ok(check < pending && pageCheck < pending, "자산 확인이 pending 기록보다 뒤");
    assert.ok(pending < telegram);
    assert.match(s, /"200 image\/png"\*\)/);
    assert.match(s, /::error::공개 자산 확인 실패/);
    // 텔레그램에 넘기는 사진 URL도 같은 변수 — 확인한 URL과 보내는 URL이 갈라지지 않게.
    assert.match(s, /--form-string "photo=\$\{OG_IMAGE_URL\}"/);
  });
}

test("market·etf push는 main으로 rebase한다 (checkout ref: main과 일치)", () => {
  assert.match(pushSteps[0][1], /git pull --rebase origin main && git push/);
  assert.match(pushSteps[1][1], /git pull --rebase origin main && git push/);
  assert.match(pushSteps[0][1], /rebase는 반드시 commit \*\*뒤\*\*에 온다/);
  assert.match(pushSteps[1][1], /commit \*\*뒤\*\*에 와야 한다/);
});

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
