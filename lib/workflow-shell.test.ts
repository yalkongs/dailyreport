// 워크플로 step의 `run:` 스크립트를 실제 bash로 실행하는 회귀 테스트.
// 문자열 존재 검사(workflow-triggers.test.ts)로는 `bash -e`에서의 조기 종료 같은
// 실행 중 셸 오류를 잡을 수 없다(감사 F04·F11). 외부 명령(gh·git·sleep 등)은
// 임시 디렉터리의 가짜 실행 파일로 PATH 앞에서 가로챈다 — 네트워크·자격증명 불필요.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const WF_DIR = path.join(__dirname, "..", ".github", "workflows");
const dailyYml = fs.readFileSync(path.join(WF_DIR, "daily-report.yml"), "utf8");

// Actions 기본 셸(shell 미지정)은 `bash -e {0}`, `shell: bash` 명시 시 `-eo pipefail`.
// 두 방식 모두에서 같은 결과여야 한다.
const SHELL_MODES: string[][] = [["-e"], ["-e", "-o", "pipefail"]];

/** `  <name>:` 로 시작하는 job 블록 텍스트(다음 최상위 job 직전까지). */
function jobBlock(yml: string, name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job '${name}' 없음`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** 블록 안에서 `- name: <prefix>…` step의 `run: |` 본문을 들여쓰기를 걷어 꺼낸다. */
function stepRun(block: string, namePrefix: string): string {
  const lines = block.split("\n");
  const i = lines.findIndex((l) => l.trimStart().startsWith(`- name: ${namePrefix}`));
  assert.ok(i >= 0, `step '${namePrefix}' 없음`);
  const stepIndent = indentOf(lines[i]);
  let j = i + 1;
  for (; j < lines.length; j++) {
    if (lines[j].trim() && indentOf(lines[j]) <= stepIndent) assert.fail(`step '${namePrefix}'에 run: | 없음`);
    if (/^\s*run: \|\s*$/.test(lines[j])) break;
  }
  assert.ok(j < lines.length, `step '${namePrefix}'에 run: | 없음`);
  const runIndent = indentOf(lines[j]);
  const body: string[] = [];
  for (let k = j + 1; k < lines.length; k++) {
    if (lines[k].trim() && indentOf(lines[k]) <= runIndent) break;
    body.push(lines[k]);
  }
  const contentIndent = Math.min(...body.filter((l) => l.trim()).map(indentOf));
  return body.map((l) => l.slice(contentIndent)).join("\n").trimEnd() + "\n";
}

interface ShellResult {
  status: number | null;
  out: string;
  dir: string;
  calls: (name: string) => string[];
}

interface Sandbox {
  dir: string;
  bin: string;
  work: string;
  calls: (name: string) => string[];
}

/**
 * 임시 디렉터리에 가짜 명령(stubs)과 작업 디렉터리(work)를 만든다. stubs의 각 항목은 PATH 앞의 가짜
 * 명령이 되며, 호출될 때마다 인자를 $STUB_DIR/<name>.calls에 한 줄씩 남긴다(본문 실행 전).
 */
function makeSandbox(stubs: Record<string, string>, setup?: (dir: string) => void): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-shell-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/${name}.calls"\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  setup?.(work);
  return {
    dir,
    bin,
    work,
    calls: (name) => {
      const f = path.join(dir, `${name}.calls`);
      return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
    },
  };
}

/** sandbox 안에서 script를 `bash <flags> script`로 실행한다. */
function execIn(sb: Sandbox, script: string, env: Record<string, string>, flags: string[]): { status: number | null; out: string } {
  const scriptPath = path.join(sb.dir, "step.sh");
  fs.writeFileSync(scriptPath, script);
  const r = spawnSync("bash", [...flags, scriptPath], {
    cwd: sb.work,
    encoding: "utf8",
    env: {
      PATH: `${sb.bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: sb.dir,
      STUB_DIR: sb.dir,
      TZ: "Asia/Seoul",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "123",
      NODE_ENV: "test", // Next 타입이 ProcessEnv에 NODE_ENV를 필수로 둔다
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** step 하나를 새 sandbox에서 실행한다. */
function runStep(
  script: string,
  stubs: Record<string, string>,
  env: Record<string, string>,
  flags: string[],
  setup?: (dir: string) => void,
): ShellResult {
  const sb = makeSandbox(stubs, setup);
  const r = execIn(sb, script, env, flags);
  return { status: r.status, out: r.out, dir: sb.dir, calls: sb.calls };
}

// ── F04: Vercel 배포 폴링은 API 오류에서 끝나지 않고 재시도한다 ─────────────────────

const FAKE_SHA = "0123456789abcdef0123456789abcdef01234567";
const pollStubs = (gh: string) => ({
  gh,
  git: `if [ "$1 $2" = "rev-parse HEAD" ]; then echo ${FAKE_SHA}; else echo "unexpected git $*" >&2; exit 99; fi`,
  sleep: "exit 0",
});
// 호출 횟수를 세는 카운터 — 첫 호출만 API 오류(stderr + exit 1), 이후 success.
const GH_FAIL_ONCE = `n=$(wc -l < "$STUB_DIR/gh.calls" | tr -d ' ')
if [ "$n" = 1 ]; then echo "gh: HTTP 503: Service Unavailable" >&2; exit 1; fi
echo success`;

// 2026-10-19부터 배포 대기·발송은 deliver job이 종류별로(market → etf) 한다.
for (const job of ["market", "etf"] as const) {
  const script = stepRun(jobBlock(dailyYml, "deliver"), `wait vercel ${job}`);

  for (const flags of SHELL_MODES) {
    const mode = flags.join(" ");

    test(`${job} Vercel 폴링 [bash ${mode}]: 첫 gh API 오류 뒤 재시도해 success면 exit 0`, () => {
      const r = runStep(script, pollStubs(GH_FAIL_ONCE), { GH_TOKEN: "x" }, flags);
      assert.equal(r.status, 0, r.out);
      assert.equal(r.calls("gh").length, 2, r.out);
      assert.match(r.calls("gh")[0], new RegExp(`repos/owner/repo/commits/${FAKE_SHA}/status`));
      assert.match(r.out, /status 조회 비정상/);
    });

    test(`${job} Vercel 폴링 [bash ${mode}]: Vercel failure면 즉시 exit 1 (발송 중단)`, () => {
      const r = runStep(script, pollStubs("echo failure"), { GH_TOKEN: "x" }, flags);
      assert.equal(r.status, 1, r.out);
      assert.equal(r.calls("gh").length, 1);
      assert.match(r.out, /::error::Vercel 배포 실패\(failure\)/);
    });

    test(`${job} Vercel 폴링 [bash ${mode}]: gh가 계속 실패해도 60회 모두 재시도한 뒤 exit 1`, () => {
      const r = runStep(script, pollStubs(`echo "gh: HTTP 403" >&2; exit 1`), { GH_TOKEN: "x" }, flags);
      assert.equal(r.status, 1, r.out);
      assert.equal(r.calls("gh").length, 60, r.out);
      assert.match(r.out, /::error::Vercel 배포 미확인 10분/);
    });
  }
}

// ── F05: main push 경합은 제한 재시도로 흡수하고, 진짜 충돌은 실패로 드러낸다 ─────────────

const macroYml = fs.readFileSync(path.join(WF_DIR, "refresh-kr-macro.yml"), "utf8");
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function gitEnv(home: string): NodeJS.ProcessEnv {
  return { ...GIT_ENV, HOME: home, PATH: process.env.PATH ?? "", NODE_ENV: "test" };
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(REAL_GIT, args, { cwd, encoding: "utf8", env: gitEnv(cwd) });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * 원격(bare)·이 job의 checkout(work)·다른 job의 clone(other)을 만든다.
 * other에서 `otherFile`을 고쳐 커밋해 두고, race.sh가 실행되면 그 커밋을 먼저 push한다.
 */
function pushFixture(work: string, mine: Record<string, string>, otherFile: string): void {
  const root = path.dirname(work);
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const other = path.join(root, "other");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "init", "-q", "-b", "main", seed);
  for (const f of ["public/reports/.keep", "public/etf-reports/.keep"]) write(path.join(seed, f), "");
  for (const f of ["data/reports-index.json", "data/etf-reports-index.json", "data/kr-macro-calendar.json"]) {
    write(path.join(seed, f), "base\n");
  }
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", remote, work);
  git(root, "clone", "-q", remote, other);
  for (const [f, c] of Object.entries(mine)) write(path.join(work, f), c);
  write(path.join(other, otherFile), "other job\n");
  git(other, "commit", "-q", "-am", "other job commit");
  write(path.join(root, "race.sh"), `cd "${other}" && "${REAL_GIT}" push -q origin main\n`);
}

// 첫 push 직전에 다른 job이 먼저 push한다(race.sh) → 실제 git push는 non-fast-forward로 거부된다.
const GIT_RACE_STUB = `if [ "$1" = "push" ] && [ "$(grep -c '^push' "$STUB_DIR/git.calls")" = 1 ]; then
  bash "$STUB_DIR/race.sh"
fi
exec "${REAL_GIT}" "$@"`;

function remoteLog(dir: string): string[] {
  return git(dir, "--git-dir", path.join(dir, "remote.git"), "log", "--format=%s", "main").split("\n").filter(Boolean);
}

interface PushCase {
  label: string;
  script: string;
  mine: Record<string, string>;
  subject: string;
  otherFile: string;
  conflictFile: string;
}

const pushCases: PushCase[] = [
  {
    label: "market",
    script: stepRun(jobBlock(dailyYml, "market"), "Commit and push report"),
    mine: { "public/reports/2026-10-16.html": "<html>m</html>\n", "data/reports-index.json": "market\n" },
    subject: "Daily Market Report - 2026-10-16 (KST)",
    otherFile: "data/etf-reports-index.json",
    conflictFile: "data/reports-index.json",
  },
  {
    label: "etf",
    script: stepRun(jobBlock(dailyYml, "etf"), "Commit and push ETF report"),
    mine: { "public/etf-reports/2026-10-16.html": "<html>e</html>\n", "data/etf-reports-index.json": "etf\n" },
    subject: "ETF Daily Report - 2026-10-16 (KST)",
    otherFile: "data/reports-index.json",
    conflictFile: "data/etf-reports-index.json",
  },
  {
    label: "refresh-kr-macro",
    script: stepRun(macroYml.slice(macroYml.indexOf("\n  refresh:\n")), "Commit and push"),
    mine: { "data/kr-macro-calendar.json": "macro\n" },
    subject: "Refresh KR macro calendar — ",
    otherFile: "data/reports-index.json",
    conflictFile: "data/kr-macro-calendar.json",
  },
];

for (const c of pushCases) {
  // 워크플로 표현식은 Actions가 실행 전에 치환한다 — 테스트에서도 같은 값으로 바꿔 넣는다.
  const script = c.script.replace(/\$\{\{ steps\.[a-z]+\.outputs\.date \}\}/g, "2026-10-16");
  const env = { ...GIT_ENV, GITHUB_REF_NAME: "main" };

  test(`${c.label} push: 워크플로 표현식이 모두 치환됐다`, () => {
    assert.doesNotMatch(script, /\$\{\{/);
  });

  for (const flags of SHELL_MODES) {
    const mode = flags.join(" ");

    test(`${c.label} push [bash ${mode}]: 다른 job이 먼저 push해 거부돼도 rebase 후 재시도로 반영된다`, () => {
      const r = runStep(script, { git: GIT_RACE_STUB, sleep: "exit 0" }, env, flags, (w) => pushFixture(w, c.mine, c.otherFile));
      assert.equal(r.status, 0, r.out);
      assert.equal(r.calls("git").filter((l) => l.startsWith("push")).length, 2, r.out);
      const log = remoteLog(r.dir);
      assert.equal(log.length, 3, log.join(" | "));
      assert.ok(log[0].startsWith(c.subject), `맨 위가 이 job 커밋이 아님: ${log.join(" | ")}`);
      assert.equal(log[1], "other job commit");
    });

    test(`${c.label} push [bash ${mode}]: 같은 파일 충돌은 rebase를 abort하며 5회 시도 후 exit 1`, () => {
      const r = runStep(script, { git: GIT_RACE_STUB, sleep: "exit 0" }, env, flags, (w) => {
        pushFixture(w, c.mine, c.conflictFile);
        // 이 job이 rebase하기 전에 다른 job이 같은 파일을 이미 push — 매 시도 rebase 충돌.
        const race = path.join(path.dirname(w), "race.sh");
        const pre = spawnSync("sh", [race], { encoding: "utf8", env: gitEnv(w) });
        assert.equal(pre.status, 0, pre.stderr);
        fs.writeFileSync(race, "true\n");
      });
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /::error::main 반영 5회 실패/);
      assert.equal(r.calls("git").filter((l) => l.startsWith("pull --rebase")).length, 5, r.out);
      assert.equal(r.calls("git").filter((l) => l === "rebase --abort").length, 5, r.out);
      assert.deepEqual(remoteLog(r.dir), ["other job commit", "seed"]);
    });
  }
}

// ── F03: 발송 전 공개 자산(프리뷰 PNG·본문) 확인 — 실패하면 pending 기록도 발송도 하지 않는다 ──────

// 가짜 curl: 텔레그램 호출은 ok:true, 자산 조회는 `-w '%{http_code} %{content_type}'` 형식으로 응답.
// IMG_RESP/PAGE_RESP로 응답을 바꾸고, IMG_RESP_FIRST는 첫 프리뷰 조회에만 적용(CDN 전파 지연).
const CURL_STUB = `url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
case "$url" in
  *api.telegram.org*) echo '{"ok":true,"result":{"message_id":1}}'; exit 0 ;;
  *-preview.png*)
    resp="\${IMG_RESP:-200 image/png}"
    if [ -n "\${IMG_RESP_FIRST:-}" ] && [ "$(grep -c 'preview.png' "$STUB_DIR/curl.calls")" = 1 ]; then resp="$IMG_RESP_FIRST"; fi ;;
  *) resp="\${PAGE_RESP:-200 text/html; charset=utf-8}" ;;
esac
printf '%s' "$resp"`;
// 가짜 npx(delivery-state CLI): classify는 success, status는 none, mark는 기록만.
const NPX_STUB = `case "$*" in
  *" classify"*) cat > /dev/null; echo success; echo ok:true ;;
  *" status "*) echo none ;;
esac`;

const sendCases = [
  { job: "market", step: "send market", path: "reports" },
  { job: "etf", step: "send etf", path: "etf-reports" },
] as const;

for (const c of sendCases) {
  const script = stepRun(jobBlock(dailyYml, "deliver"), c.step);
  const base = `https://dailyreport-eta.vercel.app/${c.path}/2026-10-16`;
  // 본문 링크에는 유입 구분용 utm(spec §6)이 붙는다. 자산 확인도 텔레그램에 넣는 바로 그 URL을 본다.
  const page = `${base}?utm_source=telegram`;
  const env = {
    GH_TOKEN: "x",
    TELEGRAM_BOT_TOKEN: "tok",
    TELEGRAM_CHAT_ID: "chat",
    REPORT_DATE: "2026-10-16",
    REPORT_SHA: FAKE_SHA,
    HEADLINE: "S&P 500 <상승>",
    IS_RESEND: "false",
    FORCE_RESEND: "false",
    ANOMALY_COUNT: "0",
    ANOMALY_BREAKDOWN: "",
  };
  const stubs = { curl: CURL_STUB, npx: NPX_STUB, sleep: "exit 0" };
  const telegramCalls = (r: ShellResult) => r.calls("curl").filter((l) => l.includes("api.telegram.org"));
  const markCalls = (r: ShellResult) => r.calls("npx").filter((l) => l.includes(" mark "));
  const pngChecks = (r: ShellResult) =>
    r.calls("curl").filter((l) => l.includes("-preview.png") && !l.includes("api.telegram.org"));

  for (const flags of SHELL_MODES) {
    const mode = flags.join(" ");

    test(`${c.job} 발송 [bash ${mode}]: 자산이 정상이면 확인 → pending → 발송 → success 기록`, () => {
      const r = runStep(script, stubs, env, flags);
      assert.equal(r.status, 0, r.out);
      const curls = r.calls("curl");
      assert.ok(curls.some((l) => l.endsWith(` ${base}-preview.png`)), curls.join("\n"));
      assert.ok(curls.some((l) => l.endsWith(` ${page}`)), curls.join("\n"));
      assert.equal(telegramCalls(r).length, 1);
      // caption은 여러 줄이라 호출 기록에서 줄이 나뉜다 — 링크 줄을 따로 찾는다.
      assert.ok(curls.some((l) => l.includes(`<a href="${page}">리포트 보기</a>`)), curls.join("\n"));
      assert.ok(curls.findIndex((l) => l.includes("api.telegram.org")) > curls.findIndex((l) => l.includes("-preview.png")));
      assert.equal(markCalls(r).length, 2, r.calls("npx").join("\n"));
      assert.match(markCalls(r)[0], new RegExp(`mark ${c.job} ${FAKE_SHA} pending`));
      assert.match(markCalls(r)[1], new RegExp(`mark ${c.job} ${FAKE_SHA} success`));
    });

    test(`${c.job} 발송 [bash ${mode}]: 첫 PNG 조회가 404여도 재확인해 통과하면 발송 (CDN 전파)`, () => {
      const r = runStep(script, stubs, { ...env, IMG_RESP_FIRST: "404 text/plain" }, flags);
      assert.equal(r.status, 0, r.out);
      assert.equal(pngChecks(r).length, 2);
      assert.equal(telegramCalls(r).length, 1);
    });

    for (const [why, extra] of [
      ["PNG 404", { IMG_RESP: "404 text/plain" }],
      ["PNG 자리에 HTML(동적 라우트 fallback)", { IMG_RESP: "200 text/html; charset=utf-8" }],
      ["curl 연결 실패", { IMG_RESP: "000 " }],
      ["본문 404", { PAGE_RESP: "404 text/html" }],
    ] as const) {
      test(`${c.job} 발송 [bash ${mode}]: ${why}면 pending 기록·발송 없이 exit 1`, () => {
        const r = runStep(script, stubs, { ...env, ...extra }, flags);
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /::error::공개 자산 확인 실패/);
        assert.equal(pngChecks(r).length, 6, r.out);
        assert.equal(telegramCalls(r).length, 0);
        assert.equal(markCalls(r).length, 0);
      });
    }

    test(`${c.job} 발송 [bash ${mode}]: 재발송은 cache-bust URL(?v=run id)을 확인하고 같은 URL로 보낸다`, () => {
      const r = runStep(script, stubs, { ...env, IS_RESEND: "true", FORCE_RESEND: "true" }, flags);
      assert.equal(r.status, 0, r.out);
      const png = `${base}-preview.png?v=123`;
      assert.ok(r.calls("curl").some((l) => l.endsWith(` ${png}`)), r.calls("curl").join("\n"));
      assert.ok(telegramCalls(r)[0].includes(`photo=${png}`), telegramCalls(r)[0]);
    });
  }
}

// ── deliver job 흐름(spec §5): step 조건(if)까지 평가해 단계를 순서대로 돌린다 ──────────────────
// 위 테스트는 step 하나씩만 돌린다. 여기서는 Actions 런타임 대신 이 테스트가 step `if:`를 평가해
// deliver job 전체를 순서대로 실행한다 — "한쪽이 실패해도 다른 쪽은 보낸다(전송 > 침묵)"와
// "배포 확인 없이 보내지 않는다"가 step 조건의 조합으로만 성립하기 때문이다.
// 지원하는 식은 이 workflow가 쓰는 범위: needs·steps·inputs·secrets 참조, ==·!=·&&·||·!,
// always()·cancelled()·success()·failure(). 상태 함수가 없는 if에는 Actions처럼 success() &&를 붙인다.
// (js-yaml은 eslint를 통해 설치되는 개발 의존성. 타입 선언이 없어 require로 불러온다.)
const yaml = require("js-yaml") as { load: (src: string) => unknown };

interface WfStep {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
}
const dailyJobs = (yaml.load(dailyYml) as { jobs: Record<string, { steps: WfStep[] }> }).jobs;

type JobResult = "success" | "failure" | "skipped" | "cancelled";
type Outcome = "success" | "failure" | "skipped";
type NeedsCtx = Record<string, { result: JobResult; outputs: Record<string, string> }>;
interface StepState {
  outcome: Outcome;
  outputs: Record<string, string>;
}
interface Scope {
  needs: NeedsCtx;
  steps: Record<string, StepState>;
  inputs: Record<string, unknown>;
  ok: boolean;
}

/** 없는 키는 ''(Actions는 null — 이 workflow의 비교·보간에서는 같은 결과). */
function blank(o: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(o, { get: (t, k) => (typeof k === "string" && !(k in t) ? "" : t[k as string]) });
}

const SECRETS = { GITHUB_TOKEN: "x", TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_CHAT_ID: "chat" };

function evalExpr(expr: string, scope: Scope): unknown {
  const js = expr
    .replace(/\balways\(\)/g, "true")
    .replace(/\bcancelled\(\)/g, "false")
    .replace(/\bsuccess\(\)/g, "__ok")
    .replace(/\bfailure\(\)/g, "(!__ok)");
  const needs = blank(
    Object.fromEntries(Object.entries(scope.needs).map(([k, v]) => [k, { result: v.result, outputs: blank(v.outputs) }])),
  );
  const steps = new Proxy(scope.steps, {
    get: (t, k) => {
      const s = t[k as string];
      return { outcome: s?.outcome ?? "", conclusion: s?.outcome ?? "", outputs: blank(s?.outputs ?? {}) };
    },
  });
  const github = blank({ event_name: "workflow_dispatch", run_id: "123" });
  return new Function("needs", "steps", "inputs", "secrets", "github", "__ok", `return (${js});`)(
    needs,
    steps,
    blank(scope.inputs),
    blank(SECRETS),
    github,
    scope.ok,
  );
}

function stepShouldRun(cond: string | undefined, scope: Scope): boolean {
  if (cond === undefined) return scope.ok;
  const m = String(cond).trim().match(/^\$\{\{([\s\S]*)\}\}$/);
  const e = (m ? m[1] : String(cond)).trim();
  return Boolean(evalExpr(/\b(success|failure|always|cancelled)\(\)/.test(e) ? e : `success() && (${e})`, scope));
}

function interpolate(v: unknown, scope: Scope): string {
  return String(v).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, e: string) => {
    const r = evalExpr(e.trim(), scope);
    return r === null || r === undefined ? "" : String(r);
  });
}

interface JobRun {
  ok: boolean;
  out: string;
  dir: string;
  calls: (name: string) => string[];
  outcome: (namePrefix: string) => Outcome;
}

/** daily-report.yml의 job을 step 조건까지 평가해 실행한다. uses: 단계(checkout·setup-node)는 건너뛴다. */
function runJob(
  job: string,
  ctx: { needs: NeedsCtx; inputs?: Record<string, unknown> },
  stubs: Record<string, string>,
  env: Record<string, string>,
  flags: string[],
): JobRun {
  const sb = makeSandbox(stubs);
  const state: Record<string, StepState> = {};
  const log: { name: string; outcome: Outcome }[] = [];
  let ok = true;
  let out = "";
  dailyJobs[job].steps.forEach((step, i) => {
    const scope: Scope = { needs: ctx.needs, steps: state, inputs: ctx.inputs ?? {}, ok };
    const name = step.name ?? step.uses ?? `step ${i}`;
    let st: StepState = { outcome: "success", outputs: {} };
    if (!stepShouldRun(step.if, scope)) {
      st = { outcome: "skipped", outputs: {} };
    } else if (step.run !== undefined) {
      const outFile = path.join(sb.dir, `output-${i}`);
      fs.writeFileSync(outFile, "");
      const stepEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, interpolate(v, scope)]));
      const r = execIn(sb, interpolate(step.run, scope), { ...env, ...stepEnv, GITHUB_OUTPUT: outFile }, flags);
      out += `\n[${name}] exit ${r.status}\n${r.out}`;
      const outputs = Object.fromEntries(
        fs.readFileSync(outFile, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
      );
      st = { outcome: r.status === 0 ? "success" : "failure", outputs };
      if (r.status !== 0) ok = false;
    }
    if (step.id) state[step.id] = st;
    log.push({ name, outcome: st.outcome });
  });
  out += `\n${log.map((s) => `${s.outcome.padEnd(8)} ${s.name}`).join("\n")}`;
  return {
    ok,
    out,
    dir: sb.dir,
    calls: sb.calls,
    outcome: (p) => {
      const s = log.find((x) => x.name.startsWith(p));
      assert.ok(s, `step '${p}' 없음`);
      return s.outcome;
    },
  };
}

// 가짜 delivery-state CLI. resolve는 받은 env를 resolve.log에 남기고, 판정은 실제 규칙을 단순화해 흉내 낸다:
// DRY_RUN → skip, CHANGED=true(방금 생성) → send, 그 밖에는 RESOLVE_<KIND>(기본 skip — 오늘 리포트 없음).
// unknown이면 실제 CLI처럼 출력을 쓴 뒤 exit 1. (실제 판정은 delivery-cli 테스트가 가짜 GitHub API로 검증한다.)
const DELIVER_NPX_STUB = `case "$*" in
  *"delivery-state.ts resolve "*)
    for k in "$@"; do :; done
    printf '%s CHANGED=%s FORCE_RESEND=%s DRY_RUN=%s\\n' "$k" "$CHANGED" "$FORCE_RESEND" "$DRY_RUN" >> "$STUB_DIR/resolve.log"
    case "$k" in market) fixture="\${RESOLVE_MARKET:-skip}" ;; *) fixture="\${RESOLVE_ETF:-skip}" ;; esac
    if [ "$DRY_RUN" = "true" ]; then action=skip; elif [ "$CHANGED" = "true" ]; then action=send; else action="$fixture"; fi
    resend=true; if [ "$CHANGED" = "true" ]; then resend=false; fi
    printf 'action=%s\\nsha=sha-%s\\ndate=2026-10-16\\nheadline=%s 헤드라인\\nresend=%s\\n' "$action" "$k" "$k" "$resend" >> "$GITHUB_OUTPUT"
    if [ "$action" = "unknown" ]; then exit 1; fi ;;
  *" classify"*) cat > /dev/null; echo success; echo ok:true ;;
  *" status "*) echo none ;;
esac`;
// 가짜 curl: 텔레그램은 ok:true, 자산은 정상. FAIL_URL이 들어간 URL만 404(그 종류의 자산 누락).
const DELIVER_CURL_STUB = `url=""
for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
case "$url" in *api.telegram.org*) echo '{"ok":true,"result":{"message_id":1}}'; exit 0 ;; esac
if [ -n "\${FAIL_URL:-}" ] && [[ "$url" == *"$FAIL_URL"* ]]; then printf '404 text/plain'; exit 0; fi
case "$url" in
  *-preview.png*) printf '200 image/png' ;;
  *) printf '200 text/html; charset=utf-8' ;;
esac`;
const deliverStubs = {
  npm: "exit 0",
  npx: DELIVER_NPX_STUB,
  gh: `echo "\${VERCEL_STATE:-success}"`,
  git: `if [ "$1 $2" = "rev-parse HEAD" ]; then echo ${FAKE_SHA}; else echo "unexpected git $*" >&2; exit 99; fi`,
  curl: DELIVER_CURL_STUB,
  sleep: "exit 0",
};
/** 텔레그램에 실제로 보낸 종류, 보낸 순서대로. */
const sentKinds = (r: JobRun) =>
  r.calls("curl").filter((l) => l.includes("api.telegram.org")).map((l) => (l.includes("/etf-reports/") ? "etf" : "market"));
const resolveLog = (r: JobRun) => {
  const f = path.join(r.dir, "resolve.log");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
};
const generated = { result: "success" as const, outputs: { changed: "true" } };
const unchanged = { result: "success" as const, outputs: { changed: "false" } };
const failedJob = { result: "failure" as const, outputs: {} };
const skippedJob = { result: "skipped" as const, outputs: {} };

for (const flags of SHELL_MODES) {
  const mode = flags.join(" ");

  test(`deliver [bash ${mode}]: 두 리포트 모두 생성되면 market → etf 순으로 보낸다`, () => {
    const r = runJob("deliver", { needs: { market: generated, etf: generated } }, deliverStubs, {}, flags);
    assert.equal(r.ok, true, r.out);
    assert.deepEqual(sentKinds(r), ["market", "etf"], r.out);
    assert.deepEqual(resolveLog(r), ["market CHANGED=true FORCE_RESEND=false DRY_RUN=false", "etf CHANGED=true FORCE_RESEND=false DRY_RUN=false"]);
  });

  test(`deliver [bash ${mode}]: market 생성 job 실패(outputs 없음) + etf 성공 → etf만 보낸다`, () => {
    const r = runJob("deliver", { needs: { market: failedJob, etf: generated } }, deliverStubs, {}, flags);
    assert.equal(r.ok, true, r.out);
    // 실패한 쪽도 조회는 한다(그날 앞선 실행이 만든 미발송 리포트가 있으면 보낸다) — CHANGED는 빈 값.
    assert.deepEqual(resolveLog(r), ["market CHANGED= FORCE_RESEND=false DRY_RUN=false", "etf CHANGED=true FORCE_RESEND=false DRY_RUN=false"]);
    assert.equal(r.outcome("send market"), "skipped", r.out);
    assert.deepEqual(sentKinds(r), ["etf"], r.out);
  });

  test(`deliver [bash ${mode}]: market 발송이 실패(자산 누락)해도 etf는 보내고, job은 실패로 드러난다`, () => {
    const r = runJob("deliver", { needs: { market: generated, etf: generated } }, deliverStubs, { FAIL_URL: "/reports/2026-10-16-preview.png" }, flags);
    assert.equal(r.outcome("send market"), "failure", r.out);
    assert.equal(r.outcome("send etf"), "success", r.out);
    assert.deepEqual(sentKinds(r), ["etf"], r.out);
    assert.equal(r.ok, false);
  });

  test(`deliver [bash ${mode}]: market 결과 불명(resolve exit 1)이면 market은 보내지 않고 etf는 보낸다, job은 실패`, () => {
    const r = runJob("deliver", { needs: { market: unchanged, etf: generated } }, deliverStubs, { RESOLVE_MARKET: "unknown" }, flags);
    assert.equal(r.outcome("resolve market"), "failure", r.out);
    assert.equal(r.outcome("wait vercel market"), "skipped", r.out);
    assert.equal(r.outcome("send market"), "skipped", r.out);
    assert.deepEqual(sentKinds(r), ["etf"], r.out);
    assert.equal(r.ok, false);
  });

  test(`deliver [bash ${mode}]: Vercel 배포 실패면 어느 쪽도 보내지 않는다(배포 확인 없이 발송 금지)`, () => {
    const r = runJob("deliver", { needs: { market: generated, etf: generated } }, deliverStubs, { VERCEL_STATE: "failure" }, flags);
    assert.equal(r.outcome("wait vercel market"), "failure", r.out);
    assert.equal(r.outcome("send market"), "skipped", r.out);
    assert.equal(r.outcome("resolve etf"), "success", r.out); // market 실패가 etf 판정을 막지 않는다
    assert.equal(r.outcome("wait vercel etf"), "failure", r.out);
    assert.equal(r.outcome("send etf"), "skipped", r.out);
    assert.deepEqual(sentKinds(r), []);
    assert.equal(r.ok, false);
  });

  test(`deliver [bash ${mode}]: only=etf 재발송(market job skipped)은 market을 조회·재발송하지 않는다`, () => {
    const r = runJob(
      "deliver",
      { needs: { market: skippedJob, etf: { result: "success", outputs: {} } }, inputs: { only: "etf", resend_telegram_only: true } },
      deliverStubs,
      { RESOLVE_ETF: "send" },
      flags,
    );
    assert.equal(r.ok, true, r.out);
    assert.deepEqual(resolveLog(r), ["etf CHANGED= FORCE_RESEND=true DRY_RUN=false"]);
    assert.deepEqual(sentKinds(r), ["etf"], r.out);
  });

  test(`deliver [bash ${mode}]: dry_run은 판정만 하고 아무것도 보내지 않는다`, () => {
    const r = runJob("deliver", { needs: { market: generated, etf: generated }, inputs: { dry_run: true } }, deliverStubs, {}, flags);
    assert.equal(r.ok, true, r.out);
    assert.deepEqual(resolveLog(r), ["market CHANGED=true FORCE_RESEND=false DRY_RUN=true", "etf CHANGED=true FORCE_RESEND=false DRY_RUN=true"]);
    assert.deepEqual(sentKinds(r), []);
    assert.deepEqual(r.calls("gh"), []);
  });
}

// ── 글꼴 설치: Pretendard(카드 PNG 글꼴)는 있으면 등록, 없어도 step은 실패하지 않는다 ─────────────
// 리포트 생성을 글꼴 때문에 막지 않는다(전송 > 침묵) — 없으면 Noto CJK로 렌더되고 경고만 남긴다.
const fontStubs = {
  sudo: "exit 0", // apt-get update/install 성공으로 간주
  "fc-cache": "exit 0",
  "fc-list": `if [ "$1" = ":lang=ko" ]; then echo "Noto Sans CJK KR"; exit 0; fi
for f in "$HOME"/.local/share/fonts/*.otf; do [ -e "$f" ] && echo "$f: Pretendard:style=Bold"; done
exit 0`,
  sleep: "exit 0",
};

for (const job of ["market", "etf"] as const) {
  const script = stepRun(jobBlock(dailyYml, job), "Install Korean fonts");

  for (const flags of SHELL_MODES) {
    const mode = flags.join(" ");

    test(`${job} 글꼴 [bash ${mode}]: Pretendard 파일이 없어도 step은 성공하고 경고만 남긴다`, () => {
      const r = runStep(script, fontStubs, {}, flags);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /::warning::Pretendard/);
    });

    test(`${job} 글꼴 [bash ${mode}]: Pretendard 파일이 있으면 사용자 글꼴 폴더에 복사하고 등록한다`, () => {
      const r = runStep(script, fontStubs, {}, flags, (w) => write(path.join(w, "assets", "fonts", "Pretendard-Bold.otf"), "otf"));
      assert.equal(r.status, 0, r.out);
      assert.ok(fs.existsSync(path.join(r.dir, ".local", "share", "fonts", "Pretendard-Bold.otf")), r.out);
      assert.doesNotMatch(r.out, /::warning::Pretendard/);
      assert.match(r.out, /Pretendard/);
    });
  }
}

// ── market test_date 형식 검사: node -e 소스·$GITHUB_OUTPUT에 보간되기 전에 거부한다 ─────────────────
// test_date는 dispatch 화면의 자유 문자열이다. 따옴표·줄바꿈이 섞이면 헤드라인 추출 node -e 소스가 바뀌거나
// GITHUB_OUTPUT에 임의의 출력 줄이 생긴다. 형식이 틀리면 생성 전에 step을 실패시킨다.
{
  const script = stepRun(jobBlock(dailyYml, "market"), "Generate market report");
  const genStubs = { npx: "exit 0", node: 'echo "헤드라인"' };
  const outputFile = () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gen-out-")), "output");
    fs.writeFileSync(f, "");
    return f;
  };

  for (const flags of SHELL_MODES) {
    const mode = flags.join(" ");

    for (const [why, bad] of [
      ["따옴표로 node -e 소스 탈출", "2026-10-16');require('child_process').execSync('id');('"],
      ["줄바꿈으로 GITHUB_OUTPUT 줄 추가", "2026-10-16\nheadline=x"],
      ["구분자 없음", "20261016"],
      ["뒤 공백", "2026-10-16 "],
    ] as const) {
      test(`market 생성 [bash ${mode}]: test_date 형식 오류(${why})면 생성 전에 exit 1`, () => {
        const out = outputFile();
        const r = runStep(script, genStubs, { TEST_DATE: bad, GITHUB_OUTPUT: out }, flags);
        assert.equal(r.status, 1, r.out);
        assert.match(r.out, /::error::test_date/);
        assert.deepEqual(r.calls("npx"), []);
        assert.deepEqual(r.calls("node"), []);
        assert.equal(fs.readFileSync(out, "utf8"), "");
      });
    }

    test(`market 생성 [bash ${mode}]: 올바른 test_date는 그 날짜로, 비어 있으면 오늘(KST)로 진행`, () => {
      const out = outputFile();
      const r = runStep(script, genStubs, { TEST_DATE: "2026-10-16", GITHUB_OUTPUT: out }, flags);
      assert.equal(r.status, 0, r.out);
      assert.deepEqual(r.calls("npx"), ["tsx scripts/run.ts"]);
      assert.match(fs.readFileSync(out, "utf8"), /^date=2026-10-16$/m);

      const out2 = outputFile();
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      const r2 = runStep(script, genStubs, { TEST_DATE: "", GITHUB_OUTPUT: out2 }, flags);
      assert.equal(r2.status, 0, r2.out);
      assert.match(fs.readFileSync(out2, "utf8"), new RegExp(`^date=${today}$`, "m"));
    });
  }
}
