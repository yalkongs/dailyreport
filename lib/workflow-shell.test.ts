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

/**
 * script를 `bash <flags> script`로 실행한다. stubs의 각 항목은 PATH 앞의 가짜 명령이 되며,
 * 호출될 때마다 인자를 $STUB_DIR/<name>.calls에 한 줄씩 남긴다(본문 실행 전).
 */
function runStep(
  script: string,
  stubs: Record<string, string>,
  env: Record<string, string>,
  flags: string[],
  setup?: (dir: string) => void,
): ShellResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-shell-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(stubs)) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/bash\nprintf '%s\\n' "$*" >> "$STUB_DIR/${name}.calls"\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }
  const scriptPath = path.join(dir, "step.sh");
  fs.writeFileSync(scriptPath, script);
  const work = path.join(dir, "work");
  fs.mkdirSync(work);
  setup?.(work);
  const r = spawnSync("bash", [...flags, scriptPath], {
    cwd: work,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: dir,
      STUB_DIR: dir,
      TZ: "Asia/Seoul",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "123",
      NODE_ENV: "test", // Next 타입이 ProcessEnv에 NODE_ENV를 필수로 둔다
      ...env,
    },
  });
  return {
    status: r.status,
    out: `${r.stdout}\n${r.stderr}`,
    dir,
    calls: (name) => {
      const f = path.join(dir, `${name}.calls`);
      return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : [];
    },
  };
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

for (const job of ["market", "etf"] as const) {
  const script = stepRun(jobBlock(dailyYml, job), "Wait for Vercel deployment");

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
