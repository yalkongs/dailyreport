import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const WF_DIR = path.join(__dirname, "..", ".github", "workflows");

/** daily-report.yml 원문. */
function readWorkflow(): string {
  return fs.readFileSync(path.join(WF_DIR, "daily-report.yml"), "utf8");
}

const yml = readWorkflow();

/** `  <name>:` 로 시작하는 job 블록 텍스트(다음 최상위 job 직전까지). */
function jobBlock(wf: string, name: string): string {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job '${name}' 없음`);
  const rest = wf.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** job 수준(4칸 들여쓰기) `if: ${{ … }}` 식. step의 if(8칸)는 보지 않는다. */
function jobIf(wf: string, name: string): string {
  const m = jobBlock(wf, name).match(/\n    if: \$\{\{ (.*) \}\}\n/);
  assert.ok(m, `job '${name}'에 job 수준 if 없음`);
  return m[1];
}

test("권한: commit status를 쓸 수 있다 (발송 상태 기록)", () => {
  assert.match(yml, /\n  statuses: write/);
});

for (const [job, group] of [["market", "daily-report-market"], ["etf", "daily-report-etf"], ["deliver", "daily-report-deliver"]] as const) {
  test(`${job}: 같은 job은 실행(run) 간 직렬로 돈다 (concurrency, 진행 중 실행을 취소하지 않음)`, () => {
    const b = jobBlock(yml, job);
    assert.match(b, new RegExp(`concurrency:\\n      group: ${group}\\n      cancel-in-progress: false`));
  });
}

// ── 2026-10-19 개편: 병렬 생성 + 단일 발송 job(spec §5) ─────────────────────────────────

test("병렬 생성: market·etf job은 서로 needs 없음, only=both·schedule에서 둘 다 실행", () => {
  const wf = readWorkflow();
  assert.ok(!jobBlock(wf, "etf").includes("needs: market"));
  assert.match(jobIf(wf, "etf"), /schedule[\s\S]*only == 'both'|only == 'both'[\s\S]*schedule/);
  assert.match(jobIf(wf, "market"), /only != 'etf'/);
});

test("생성 job은 텔레그램을 보내지 않고, deliver job이 market → etf 순으로 보낸다", () => {
  const wf = readWorkflow();
  assert.ok(!jobBlock(wf, "market").includes("api.telegram.org"));
  assert.ok(!jobBlock(wf, "etf").includes("api.telegram.org"));
  const d = jobBlock(wf, "deliver");
  assert.match(d, /needs:\s*\[\s*market,\s*etf\s*\]/);
  assert.match(d, /always\(\) && !cancelled\(\)/);
  assert.match(d, /group: daily-report-deliver/);
  assert.ok(d.indexOf("resolve market") < d.indexOf("resolve etf"));
});

test("모든 workflow는 ubuntu-24.04 고정", () => {
  for (const f of ["daily-report.yml", "delivery-monitor.yml", "refresh-kr-macro.yml", "ci.yml"]) {
    const s = fs.readFileSync(path.join(WF_DIR, f), "utf8");
    assert.ok(!s.includes("ubuntu-latest"), f);
    assert.match(s, /runs-on: ubuntu-24\.04/, f);
  }
});

test("dry_run일 때만 test_date를 TEST_DATE·ETF_REPORT_DATE로 전달", () => {
  const wf = readWorkflow();
  assert.match(wf, /test_date:/);
  assert.match(wf, /TEST_DATE: \$\{\{ \(inputs\.dry_run == true \|\| inputs\.dry_run == 'true'\) && inputs\.test_date \|\| '' \}\}/);
  assert.match(wf, /ETF_REPORT_DATE: \$\{\{ \(inputs\.dry_run == true \|\| inputs\.dry_run == 'true'\) && inputs\.test_date \|\| '' \}\}/);
  // 리포트 날짜(커밋 메시지·아티팩트 경로)도 지정 날짜를 따른다 — 비어 있으면 오늘(KST).
  assert.match(stepBlock(jobBlock(wf, "market"), "Generate market report"), /REPORT_DATE=\$\{TEST_DATE:-\$\(TZ=Asia\/Seoul date \+%Y-%m-%d\)\}/);
  assert.match(stepBlock(jobBlock(wf, "etf"), "Run ETF pipeline"), /REPORT_DATE=\$\{ETF_REPORT_DATE:-\$\(TZ=Asia\/Seoul date \+%Y-%m-%d\)\}/);
});

// test_date는 사람이 dispatch 화면에 입력하는 자유 문자열 — 형식을 확인하기 전에는 $GITHUB_OUTPUT에
// 보간하지 않는다(ETF는 run-etf.ts가 ETF_REPORT_DATE 형식을 먼저 검사한다). 실제 거부 동작은 workflow-shell 테스트.
test("market test_date는 YYYY-MM-DD만 받는다 — 생성·GITHUB_OUTPUT보다 먼저 검사", () => {
  const s = stepBlock(jobBlock(readWorkflow(), "market"), "Generate market report");
  const guard = s.indexOf('[[ "$TEST_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]');
  assert.ok(guard >= 0, "test_date 형식 검사 없음");
  for (const later of ["npx tsx scripts/run.ts", ">> $GITHUB_OUTPUT"]) {
    assert.ok(s.indexOf(later) >= 0 && guard < s.indexOf(later), later);
  }
});

// M1: 생성 step은 date만 내보낸다. 텔레그램 헤드라인은 deliver의 resolve(delivery-state.ts)가
// 인덱스에서 읽는다 — 생성 step의 headline·anomaly 출력과 날짜를 JS 소스에 보간하던 node -e는 아무도 읽지 않던 죽은 코드.
test("생성 step은 date만 GITHUB_OUTPUT에 쓰고 node -e로 날짜를 JS에 보간하지 않는다", () => {
  const wf = readWorkflow();
  for (const [job, step] of [["market", "Generate market report"], ["etf", "Run ETF pipeline"]] as const) {
    const s = stepBlock(jobBlock(wf, job), step);
    assert.doesNotMatch(s, /node -e/, job);
    const outputs = [...s.matchAll(/echo "([a-z_]+)=[^"]*" >> \$GITHUB_OUTPUT/g)].map((m) => m[1]);
    assert.deepEqual(outputs, ["date"], job);
  }
  // deliver는 생성 step 출력이 아니라 resolve 출력(steps.delivery_<kind>)을 쓴다.
  assert.doesNotMatch(wf, /steps\.(?:report|etf)\.outputs\.(?:headline|anomaly_count|anomaly_breakdown)/);
});

// Ruling 30: ETF 화면에 이상 탐지 섹션이 없다 — 텔레그램 캡션의 "이상 탐지: N건" 줄과 그 줄만 먹던 env가 남지 않는다.
// KRX_API_KEY 는 어디서도 읽지 않는다(ETF는 KRX_AUTH_KEY).
test("텔레그램 캡션에 이상 탐지 줄이 없고, 그 줄만 먹던 env와 안 쓰는 KRX_API_KEY 는 workflow에 없다", () => {
  const wf = readWorkflow();
  assert.doesNotMatch(wf, /이상 탐지|ANOMALY_|ALERT_LINE|anomaly_count|anomaly_breakdown/);
  assert.doesNotMatch(wf, /KRX_API_KEY/);
  assert.match(jobBlock(wf, "etf"), /KRX_AUTH_KEY: \$\{\{ secrets\.KRX_AUTH_KEY \}\}/);
});

test("dry_run일 때만 생성 HTML·PNG를 아티팩트로 업로드", () => {
  const wf = readWorkflow();
  for (const job of ["market", "etf"]) {
    const b = jobBlock(wf, job);
    assert.match(b, /actions\/upload-artifact@v4/, job);
    assert.match(b, /if: \$\{\{ inputs\.dry_run == true \|\| inputs\.dry_run == 'true' \}\}/, job);
  }
  const m = stepBlock(jobBlock(wf, "market"), "Upload dry-run");
  assert.match(m, /public\/reports\/\$\{\{ steps\.report\.outputs\.date \}\}\.html/);
  assert.match(m, /public\/reports\/\$\{\{ steps\.report\.outputs\.date \}\}-preview\.png/);
  assert.match(m, /retention-days: 3/);
  const e = stepBlock(jobBlock(wf, "etf"), "Upload dry-run");
  assert.match(e, /public\/etf-reports\/\$\{\{ steps\.etf\.outputs\.date \}\}\.html/);
  assert.match(e, /public\/etf-reports\/\$\{\{ steps\.etf\.outputs\.date \}\}-preview\.png/);
  assert.match(e, /retention-days: 3/);
});

test("텔레그램 링크에 utm_source=telegram, 글꼴 단계는 Pretendard도 설치", () => {
  const wf = readWorkflow();
  assert.match(wf, /utm_source=telegram/);
  assert.match(wf, /assets\/fonts\/Pretendard/);
  for (const job of ["market", "etf"]) {
    const s = stepBlock(jobBlock(wf, job), "Install Korean fonts");
    // 파일이 없어도 step이 실패하지 않게 if로 감싼다(bash -e) — 동작은 workflow-shell 테스트가 실행해 본다.
    assert.match(s, /if ls assets\/fonts\/Pretendard-\*\.otf >\/dev\/null 2>&1/, job);
    assert.match(s, /cp assets\/fonts\/Pretendard-\*\.otf ~\/\.local\/share\/fonts\//, job);
    // Ruling 24: 실패는 ::error:: 주석(발송은 계속), 진단용 fc-match 800·600 출력은 항상 남긴다.
    assert.match(s, /echo "::error::Pretendard/, job);
    assert.doesNotMatch(s, /::warning::Pretendard/, job);
    assert.match(s, /fc-match 'Pretendard:weight=800' \|\| true/, job);
    assert.match(s, /fc-match 'Pretendard:weight=600' \|\| true/, job);
    // 2026-10-24: 보조 글꼴 apt가 멈춰도 job이 죽지 않게 step은 continue-on-error, Pretendard 등록이 apt보다 먼저.
    assert.match(s, /\n        continue-on-error: true\n/, job);
    assert.ok(s.indexOf("cp assets/fonts/Pretendard-") < s.indexOf("apt-get update"), job);
    assert.doesNotMatch(s, /fonts-noto-cjk 설치 3회 실패[^\n]*\n\s+exit 1/, job);
  }
  for (const kind of ["market", "etf"]) {
    const s = stepBlock(jobBlock(wf, "deliver"), `send ${kind}`);
    assert.match(s, new RegExp(`REPORT_URL="https://dailyreport-eta\\.vercel\\.app/${kind === "market" ? "reports" : "etf-reports"}/\\$\\{REPORT_DATE\\}\\?utm_source=telegram"`));
  }
});

test("생성 job은 outputs.changed를 내보내고, deliver는 그 값을 resolve의 CHANGED로 받는다", () => {
  const wf = readWorkflow();
  for (const job of ["market", "etf"] as const) {
    assert.match(jobBlock(wf, job), /\n    outputs:\n      changed: \$\{\{ steps\.changes\.outputs\.changed \}\}\n/, job);
    assert.match(stepBlock(jobBlock(wf, "deliver"), `resolve ${job}`), new RegExp(`CHANGED: \\$\\{\\{ needs\\.${job}\\.outputs\\.changed \\}\\}`));
  }
});

// js-yaml로 실제 파싱 — 문자열 검사가 놓치는 들여쓰기·구조 오류를 잡는다.
// (js-yaml은 eslint를 통해 설치되는 개발 의존성. 타입 선언이 없어 require로 불러온다.)
const yaml = require("js-yaml") as { load: (src: string) => unknown };

interface WfStep { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, unknown>; with?: Record<string, unknown> }
interface WfJob { needs?: string[] | string; if?: string; "runs-on"?: string; outputs?: Record<string, string>; steps: WfStep[] }
interface Wf {
  on: { workflow_dispatch?: { inputs?: Record<string, { type?: string; default?: unknown; options?: string[] }> }; schedule?: { cron: string }[] };
  jobs: Record<string, WfJob>;
}

test("네 workflow 모두 YAML로 파싱되고, 모든 job은 ubuntu-24.04", () => {
  for (const f of ["daily-report.yml", "delivery-monitor.yml", "refresh-kr-macro.yml", "ci.yml"]) {
    const wf = yaml.load(fs.readFileSync(path.join(WF_DIR, f), "utf8")) as Wf;
    const jobs = Object.entries(wf.jobs);
    assert.ok(jobs.length > 0, f);
    for (const [name, job] of jobs) assert.equal(job["runs-on"], "ubuntu-24.04", `${f}:${name}`);
  }
});

test("daily-report 구조(YAML): market·etf 병렬, deliver가 둘을 기다림, test_date 입력, deliver 단계 순서", () => {
  const wf = yaml.load(readWorkflow()) as Wf;
  assert.deepEqual(Object.keys(wf.jobs), ["market", "etf", "deliver"]);
  assert.equal(wf.jobs.market.needs, undefined);
  assert.equal(wf.jobs.etf.needs, undefined);
  assert.deepEqual(wf.jobs.deliver.needs, ["market", "etf"]);
  assert.equal(wf.jobs.deliver.if, "${{ always() && !cancelled() }}");
  for (const job of ["market", "etf"]) assert.deepEqual(wf.jobs[job].outputs, { changed: "${{ steps.changes.outputs.changed }}" });
  const inputs = wf.on.workflow_dispatch!.inputs!;
  assert.equal(inputs.test_date.type, "string");
  assert.equal(inputs.test_date.default, "");
  assert.deepEqual(inputs.only.options, ["both", "market", "etf"]);
  const names = wf.jobs.deliver.steps.map((s) => s.name ?? s.uses ?? "");
  const order = ["resolve market", "wait vercel market", "send market", "resolve etf", "wait vercel etf", "send etf"].map((p) =>
    names.findIndex((n) => n.startsWith(p)),
  );
  assert.ok(order.every((i) => i >= 0), names.join(" | "));
  assert.deepEqual([...order].sort((a, b) => a - b), order, names.join(" | "));
  // 생성 job에는 발송 쪽 단계가 남아 있지 않다.
  for (const job of ["market", "etf"]) {
    for (const s of wf.jobs[job].steps) {
      assert.doesNotMatch(`${s.name ?? ""}\n${s.run ?? ""}`, /delivery-state\.ts|api\.telegram\.org|Wait for Vercel/, `${job}: ${s.name}`);
    }
  }
});

/** deliver job의 step(이름 접두어)을 YAML에서 찾는다. */
function deliverStep(prefix: string): WfStep {
  const wf = yaml.load(readWorkflow()) as Wf;
  const s = wf.jobs.deliver.steps.find((x) => (x.name ?? "").startsWith(prefix));
  assert.ok(s, `deliver step '${prefix}' 없음`);
  return s;
}

// 전송 > 침묵(F02): step if에 상태 함수가 없으면 Actions가 success()를 암묵적으로 붙인다. 그러면 market 쪽
// 단계가 하나라도 실패(결과 불명 exit 1·배포 대기 실패·자산 확인 실패)했을 때 etf 단계가 모두 건너뛰어진다.
// 그래서 !cancelled()로 다른 종류의 실패와 무관하게 돌리고, 대신 배포 대기 성공(outcome)을 직접 확인한다
// (!cancelled()가 암묵적 성공 조건을 없애므로 이 확인이 없으면 Vercel 실패 뒤에도 발송한다).
// 각 묶음은 그 생성 job이 이번 실행 대상이었을 때만 돈다 — only=market 재발송이 ETF까지 재발송하지 않게.
// (실제 판정은 workflow-shell 테스트가 step 조건을 평가해 돌려 본다.)
test("deliver step 조건: 종류별 묶음은 서로 막지 않고, 배포 확인 없이는 보내지 않으며, 실행 대상이 아닌 종류는 건드리지 않는다", () => {
  for (const kind of ["market", "etf"]) {
    assert.equal(deliverStep(`resolve ${kind}`).id, `delivery_${kind}`);
    assert.equal(deliverStep(`wait vercel ${kind}`).id, `vercel_${kind}`);
    assert.equal(deliverStep(`resolve ${kind}`).if, `\${{ !cancelled() && needs.${kind}.result != 'skipped' }}`);
    assert.equal(deliverStep(`wait vercel ${kind}`).if, `\${{ !cancelled() && steps.delivery_${kind}.outputs.action == 'send' }}`);
    assert.equal(
      deliverStep(`send ${kind}`).if,
      `\${{ !cancelled() && steps.delivery_${kind}.outputs.action == 'send' && steps.vercel_${kind}.outcome == 'success' }}`,
    );
  }
});

// 감사 F06: resolve는 결과 불명(unknown)이면 exit 1 — 그 실패가 job 실패(소유자 메일)로 드러나야 한다.
for (const kind of ["market", "etf"] as const) {
  test(`deliver ${kind}: resolve step이 있고, 결과 불명(exit 1)을 continue-on-error로 가리지 않는다`, () => {
    const d = jobBlock(yml, "deliver");
    assert.match(d, new RegExp(`npx tsx scripts/delivery-state\\.ts resolve ${kind}`));
    const step = stepBlock(d, `resolve ${kind}`);
    assert.match(step, new RegExp(`id: delivery_${kind}`));
    assert.doesNotMatch(step, /continue-on-error/);
    assert.doesNotMatch(d, /continue-on-error/);
  });

  test(`deliver ${kind}: 발송 step은 step output을 셸에 직접 보간하지 않는다 (env로만 전달)`, () => {
    const s = stepBlock(jobBlock(yml, "deliver"), `send ${kind}`);
    assert.doesNotMatch(s.slice(s.indexOf("run: |")), /\$\{\{/);
    assert.match(s, new RegExp(`REPORT_SHA: \\$\\{\\{ steps\\.delivery_${kind}\\.outputs\\.sha \\}\\}`));
    assert.doesNotMatch(jobBlock(yml, "deliver"), /\n\s+set -x/);
  });

  test(`deliver ${kind}: 발송 전 pending 기록 → 응답 분류 → 결과 기록`, () => {
    const s = stepBlock(jobBlock(yml, "deliver"), `send ${kind}`);
    assert.match(s, new RegExp(`delivery-state\\.ts mark ${kind} "\\$REPORT_SHA" pending`));
    assert.match(s, /delivery-state\.ts classify/);
    assert.match(s, new RegExp(`delivery-state\\.ts mark ${kind} "\\$REPORT_SHA" "\\$STATE"`));
    assert.match(s, /--max-time 30/);
  });

  // Ruling 39: 재확인은 resend 여부와 무관하게(사람의 명시적 재발송만 우회) — 조회 실패만 resend에 따라 갈린다.
  test(`deliver ${kind}: 발송 직전 재확인은 resend와 무관하게 하고, 조회 실패는 재발송이면 막고 방금 생성이면 경고 후 보낸다`, () => {
    const s = stepBlock(jobBlock(yml, "deliver"), `send ${kind}`);
    assert.match(s, /\n {10}if \[ "\$FORCE_RESEND" != "true" \]; then/);
    assert.doesNotMatch(s, /if \[ "\$IS_RESEND" = "true" \] && \[ "\$FORCE_RESEND" != "true" \]; then/);
    assert.match(s, new RegExp(`delivery-state\\.ts status ${kind} "\\$REPORT_SHA" \\| tail -1\\) \\|\\| true`));
    assert.match(s, /success\|pending\)/);
    assert.match(s, /::error::발송 상태 재확인 실패/);
    assert.match(s, /::warning::발송 상태 재확인 실패/);
    assert.match(s, /::error::Telegram \$\{STATE\} 이후 상태 기록 실패/);
    // 재확인은 pending 기록(발송 직전) 앞
    assert.ok(s.indexOf(`delivery-state.ts status ${kind}`) < s.indexOf(`delivery-state.ts mark ${kind} "$REPORT_SHA" pending`));
  });
}

// 감사 F05: market·etf·주간 매크로 갱신은 같은 main에 동시에 push한다(2026-10-19부터 market·etf는 같은
// 실행 안에서도 병렬). rebase 실패를 `|| true`로 삼키고 push를 한 번만 하던 구조를 제한 재시도로 바꿨다.
const macroYml = fs.readFileSync(path.join(WF_DIR, "refresh-kr-macro.yml"), "utf8");

/** 블록에서 `- name: <prefix>…` step 텍스트(다음 step 직전까지). */
function stepBlock(block: string, namePrefix: string): string {
  const start = block.indexOf(`- name: ${namePrefix}`);
  assert.ok(start >= 0, `step '${namePrefix}' 없음`);
  const next = block.indexOf("\n      - name: ", start + 1);
  return next < 0 ? block.slice(start) : block.slice(start, next);
}

const pushSteps: [string, string][] = [
  ["market", stepBlock(jobBlock(yml, "market"), "Commit and push report")],
  ["etf", stepBlock(jobBlock(yml, "etf"), "Commit and push ETF report")],
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
for (const kind of ["market", "etf"] as const) {
  test(`deliver ${kind}: 발송 전에 텔레그램이 가져갈 프리뷰 PNG·본문 URL을 실제로 확인한다`, () => {
    const s = stepBlock(jobBlock(yml, "deliver"), `send ${kind}`);
    const ogDef = s.lastIndexOf('OG_IMAGE_URL="https://dailyreport-eta.vercel.app/');
    const check = s.indexOf(`-w '%{http_code} %{content_type}' "$OG_IMAGE_URL"`);
    const pageCheck = s.indexOf(`-w '%{http_code} %{content_type}' "$REPORT_URL"`);
    const pending = s.indexOf(`delivery-state.ts mark ${kind} "$REPORT_SHA" pending`);
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

// 운영 실행은 항상 최신 main을 체크아웃한다(재실행 non-fast-forward 인시던트). dry_run만 실행한 ref(github.sha)를
// 체크아웃한다 — 브랜치 dry-run(전환 전 검증)이 main의 옛 코드가 아니라 그 브랜치 코드를 돌리게. dry_run은 커밋·발송이 없다.
test("checkout: 운영 실행은 ref main, dry_run만 실행한 ref", () => {
  const wf = yaml.load(readWorkflow()) as Wf;
  for (const job of ["market", "etf", "deliver"]) {
    const co = wf.jobs[job].steps.find((s) => s.uses === "actions/checkout@v4");
    assert.equal(co?.with?.ref, "${{ (inputs.dry_run == true || inputs.dry_run == 'true') && github.sha || 'main' }}", job);
  }
  const co = wf.jobs.deliver.steps.find((s) => s.uses === "actions/checkout@v4");
  assert.equal(co?.with?.["fetch-depth"], 0);
});

test("ETF 파이프라인 step에도 FORCE_REGENERATE가 전달된다", () => {
  assert.match(jobBlock(yml, "etf"), /FORCE_REGENERATE: \$\{\{ inputs\.force_regenerate == true && 'true' \|\| 'false' \}\}/);
});

test("schedule은 하나(3순위 백업), job 분기는 inputs.only로", () => {
  assert.match(yml, /- cron: '30 22 \* \* 0-4'/);
  assert.equal((yml.match(/- cron:/g) ?? []).length, 1);
  assert.match(jobBlock(yml, "market"), /\n    if: \$\{\{ inputs\.only != 'etf' \}\}\n/);
  assert.match(jobBlock(yml, "etf"), /\n    if: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.only == 'both' \|\| inputs\.only == 'etf' \}\}\n/);
});

// 2026-10-19: Market·ETF가 06:40·07:20 트리거(only=both)를 공유한다. ETF는 더 이상 KRX 게시(~08:00)를
// 기다리지 않는다(전일 종가 기준) — only=both에서 ETF를 막던 2026-09-30 규칙은 폐기.
test("job 실행 대상: both·schedule은 둘 다, market·etf는 그 종류만", () => {
  const evalCond = (job: string, event: string, only: string) =>
    new Function("github", "inputs", `return ${jobIf(yml, job)}`)({ event_name: event }, event === "schedule" ? {} : { only });
  for (const [event, only, market, etf] of [
    ["workflow_dispatch", "both", true, true],
    ["workflow_dispatch", "market", true, false],
    ["workflow_dispatch", "etf", false, true],
    ["schedule", "", true, true],
  ] as const) {
    assert.equal(evalCond("market", event, only), market, `market ${event} ${only}`);
    assert.equal(evalCond("etf", event, only), etf, `etf ${event} ${only}`);
  }
});

// ── delivery-monitor.yml: 독립 도착 감시(감사 F06c) ─────────────────────────────────────
const monitorPath = path.join(WF_DIR, "delivery-monitor.yml");
const monitorYml = fs.existsSync(monitorPath) ? fs.readFileSync(monitorPath, "utf8") : "";

/** UTC cron 'M H * * a-b'를 KST 시각·요일(0=일)로 바꾼다. */
function cronToKst(cron: string): { hhmm: string; weekdays: number[] } {
  const m = cron.match(/^(\d+) (\d+) \* \* (\d)-(\d)$/);
  assert.ok(m, `지원하지 않는 cron: ${cron}`);
  const [min, hour, from, to] = m.slice(1).map(Number);
  const kstHour = hour + 9;
  const shift = kstHour >= 24 ? 1 : 0;
  const days: number[] = [];
  for (let d = from; d <= to; d++) days.push((d + shift) % 7);
  return { hhmm: `${String(kstHour % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`, weekdays: days };
}

function monitorKind(event: string, schedule: string, kind: string): string {
  const expr = monitorYml.match(/KIND: \$\{\{ (.*) \}\}/)![1];
  return new Function("github", "inputs", `return ${expr}`)({ event_name: event, event: { schedule } }, { kind });
}

test("delivery-monitor: schedule 백업 하나(KST 07:45 월~금)가 두 리포트(all)를 감시", () => {
  assert.ok(monitorYml, "delivery-monitor.yml 없음");
  const crons = [...monitorYml.matchAll(/- cron: '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(crons, ["45 22 * * 0-4"]);
  assert.deepEqual(cronToKst(crons[0]), { hhmm: "07:45", weekdays: [1, 2, 3, 4, 5] });
  assert.equal(monitorKind("schedule", crons[0], ""), "all");
});

test("delivery-monitor: dispatch 입력 kind(all 기본, market·etf 선택)를 그대로 쓴다", () => {
  assert.match(monitorYml, /workflow_dispatch:\n    inputs:\n      kind:/);
  assert.match(monitorYml, /options: \[all, market, etf\]/);
  assert.match(monitorYml, /default: all/);
  for (const k of ["all", "market", "etf"]) assert.equal(monitorKind("workflow_dispatch", "", k), k);
});

test("delivery-monitor: 읽기 전용 최소 권한, check-delivery를 env로 받은 KIND로 실행", () => {
  assert.match(monitorYml, /\npermissions:\n  contents: read[^\n]*\n  statuses: read[^\n]*\n/);
  assert.doesNotMatch(monitorYml, /: write/);
  assert.match(monitorYml, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(monitorYml, /run: npx tsx scripts\/check-delivery\.ts "\$KIND"/);
  assert.doesNotMatch(monitorYml, /TELEGRAM|ANTHROPIC/);
  assert.match(monitorYml, /node-version: '22'/);
});

test("delivery-monitor: 발송 확인 뒤 발행물 정확성 검사 — 발송 확인이 실패해도 돌고(always), 실패하면 job이 실패", () => {
  const wf = yaml.load(monitorYml) as Wf;
  const steps = wf.jobs.check.steps;
  const delivery = steps.findIndex((s) => (s.run ?? "").includes("scripts/check-delivery.ts"));
  const published = steps.findIndex((s) => (s.run ?? "").includes("scripts/check-published.ts"));
  assert.ok(delivery >= 0, "check-delivery step 없음");
  assert.ok(published > delivery, "check-published step은 check-delivery 다음");
  const step = steps[published] as WfStep & { "continue-on-error"?: unknown };
  assert.equal(step.if, "always()");
  assert.equal(step["continue-on-error"], undefined); // 실패가 job 실패(=GitHub 실패 메일)로 이어져야 한다
  assert.match(step.run ?? "", /^npx tsx scripts\/check-published\.ts --kind "\$KIND"$/);
  // 감시 대상은 발송 확인과 같은 식(schedule=all, dispatch=입력값). 비밀은 쓰지 않는다(공개 페이지·시세만 읽음).
  const kind = (s: WfStep) => (s.env as Record<string, string> | undefined)?.KIND;
  assert.equal(kind(step), kind(steps[delivery]));
  assert.doesNotMatch(JSON.stringify(step), /secrets\./);
});

// ── ci.yml: 변경을 막는 자동 검증(감사 F11) ────────────────────────────────────────────
const ciPath = path.join(WF_DIR, "ci.yml");
const ciYml = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, "utf8") : "";
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };

test("package.json: npm test·typecheck가 한 명령으로 전체 테스트(카드 lib/preview 포함)·타입 검사를 돈다", () => {
  assert.equal(pkg.scripts.test, "tsx --test lib/*.test.ts lib/etf/*.test.ts lib/preview/*.test.ts");
  // 테스트 파일이 있는 lib 하위 폴더는 모두 npm test(=CI)에 들어가야 한다 — 빠진 폴더는 CI가 영영 돌리지 않는다.
  const libDir = path.join(__dirname);
  const dirsWithTests = fs.readdirSync(libDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.readdirSync(path.join(libDir, d.name)).some((f) => f.endsWith(".test.ts")))
    .map((d) => d.name);
  for (const dir of dirsWithTests) assert.ok(pkg.scripts.test.includes(`lib/${dir}/*.test.ts`), `lib/${dir} 테스트가 npm test에 없음`);
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit -p .");
});

test("ci.yml: 모든 브랜치 push·PR에서 npm ci → test → typecheck, 봇 리포트 커밋 경로는 제외", () => {
  assert.ok(ciYml, "ci.yml 없음");
  assert.match(ciYml, /\n  push:\n    branches: \['\*\*'\]\n    paths-ignore:\n/);
  assert.match(ciYml, /\n  pull_request:\n    paths-ignore:\n/);
  // 매일 봇이 main에 커밋하는 리포트·데이터와 문서는 코드 검증이 필요 없다.
  const ignores = [...ciYml.matchAll(/paths-ignore:\n((?:\s+- .+\n)+)/g)].map((m) =>
    m[1].split("\n").map((l) => l.trim().replace(/^- /, "").replace(/'/g, "")).filter(Boolean),
  );
  assert.equal(ignores.length, 2);
  for (const list of ignores) assert.deepEqual(list, ["public/**", "data/**", "docs/**"]);
  const steps = ["run: npm ci", "if npm test 2>&1 | tee test-output.log", "run: npm run typecheck"].map((s) => ciYml.indexOf(s));
  // 실행기 IPC 오류('Unable to deserialize cloned data')일 때만 한 번 재시도, 그 밖의 실패는 그대로 실패(10/23).
  assert.match(ciYml, /if grep -q 'Unable to deserialize cloned data' test-output\.log; then\n[^\n]*::warning[^\n]*\n\s+npm test\n\s+else\n\s+exit 1\n\s+fi/);
  assert.ok(steps.every((i) => i >= 0), "npm ci/test/typecheck step 누락");
  assert.deepEqual([...steps].sort((a, b) => a - b), steps, "step 순서");
  assert.doesNotMatch(ciYml, /npm run lint/); // lint는 현재 실패 — 정리 후 추가
});

test("ci.yml: 운영 workflow와 같은 Node 버전, 읽기 권한만, 비밀 없음", () => {
  const prodNode = [...yml.matchAll(/node-version: '(\d+)'/g)].map((m) => m[1]);
  assert.ok(prodNode.length > 0);
  assert.equal(new Set(prodNode).size, 1);
  assert.match(ciYml, new RegExp(`node-version: '${prodNode[0]}'`));
  assert.match(ciYml, /\npermissions:\n  contents: read\n/);
  assert.doesNotMatch(ciYml, /secrets\./);
});
