// ops/macmini 도착 감시 트리거(감사 F06d) 검사. launchd 설치는 하지 않는다 — 스크립트는 가짜 gh로
// 실제 실행하고, plist는 정적 검사한다(CI 러너에는 plutil이 없다).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const OPS = path.join(__dirname, "..", "ops", "macmini");
const read = (f: string) => fs.readFileSync(path.join(OPS, f), "utf8");

function runMonitor(args: string[], ghBody: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-"));
  const gh = path.join(dir, "gh");
  fs.writeFileSync(gh, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/gh.calls"\n${ghBody}\n`);
  fs.chmodSync(gh, 0o755);
  const r = spawnSync("bash", [path.join(OPS, "monitor.sh"), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: dir, GH: gh, RETRY_SLEEP: "0", NODE_ENV: "test" },
  });
  const file = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  return {
    status: r.status,
    calls: file(path.join(dir, "gh.calls")).split("\n").filter(Boolean),
    log: file(path.join(dir, "Library", "Logs", "dailyreport", "monitor.log")),
  };
}

for (const kind of ["market", "etf"] as const) {
  test(`monitor.sh ${kind}: delivery-monitor.yml을 main에서 kind=${kind}로 dispatch하고 로그를 남긴다`, () => {
    const r = runMonitor([kind], "exit 0");
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, [`workflow run delivery-monitor.yml --repo yalkongs/dailyreport --ref main -f kind=${kind}`]);
    assert.match(r.log, new RegExp(`\\[monitor:${kind}\\] dispatch ok \\(attempt 1\\)`));
  });
}

test("monitor.sh: dispatch 실패는 3회 시도 후 exit 1, 매 시도 로그", () => {
  const r = runMonitor(["etf"], `echo "HTTP 502" >&2; exit 1`);
  assert.equal(r.status, 1);
  assert.equal(r.calls.length, 3);
  assert.equal((r.log.match(/dispatch 실패 \(attempt \d\): HTTP 502/g) ?? []).length, 3);
});

test("monitor.sh: kind 인자 오류는 dispatch 없이 exit 2", () => {
  for (const args of [[], ["both"]]) {
    const r = runMonitor(args, "exit 0");
    assert.equal(r.status, 2);
    assert.equal(r.calls.length, 0);
  }
});

for (const [kind, hour, minute] of [["market", 7, 45], ["etf", 9, 0]] as const) {
  const label = `com.yalkongs.dailyreport.monitor.${kind}`;

  test(`${label}.plist: monitor.sh ${kind}를 월~금 ${hour}:${String(minute).padStart(2, "0")}에 실행`, () => {
    const p = read(`${label}.plist`);
    assert.match(p, new RegExp(`<key>Label</key>\\s*<string>${label.replace(/\./g, "\\.")}</string>`));
    assert.match(
      p,
      new RegExp(
        `<key>ProgramArguments</key>\\s*<array>\\s*<string>/bin/bash</string>\\s*` +
          `<string>/Users/yalkongs/Project/dailyreport/ops/macmini/monitor\\.sh</string>\\s*<string>${kind}</string>\\s*</array>`,
      ),
    );
    const entries = [...p.matchAll(/<dict>\s*<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>\s*<\/dict>/g)]
      .map((m) => m.slice(1).map(Number));
    assert.deepEqual(entries, [1, 2, 3, 4, 5].map((d) => [hour, minute, d]));
    assert.match(p, new RegExp(`<string>/Users/yalkongs/Library/Logs/dailyreport/monitor-${kind}\\.err\\.log</string>`));
  });
}

test("install.sh: 도착 감시 plist 두 개도 설치·제거 대상이다", () => {
  const s = read("install.sh");
  const labels = s.match(/LABELS=\(([^)]*)\)/)![1].split(/\s+/).filter(Boolean);
  for (const l of [
    "com.yalkongs.dailyreport.market",
    "com.yalkongs.dailyreport.etf",
    "com.yalkongs.dailyreport.monitor.market",
    "com.yalkongs.dailyreport.monitor.etf",
  ]) {
    assert.ok(labels.includes(l), `${l} 누락: ${labels.join(" ")}`);
    assert.ok(fs.existsSync(path.join(OPS, `${l}.plist`)), `${l}.plist 없음`);
  }
});
