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
