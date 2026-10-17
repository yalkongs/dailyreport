// ops/macmini 트리거 검사 — 06:40·07:20 both dispatch(morning), 07:45 도착 감시 1개(monitor, 감사 F06d).
// launchd 설치는 하지 않는다 — 스크립트는 가짜 gh로 실제 실행하고, plist는 정적 검사한다(CI 러너에는 plutil이 없다).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const OPS = path.join(__dirname, "..", "ops", "macmini");
const read = (f: string) => fs.readFileSync(path.join(OPS, f), "utf8");

// 가짜 gh(호출 인자를 gh.calls에 기록)와 임시 HOME으로 ops 스크립트를 실행한다 — 실제 dispatch는 일어나지 않는다.
function runOps(script: "monitor.sh" | "dispatch.sh", logName: string, args: string[], ghBody: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-macmini-"));
  const gh = path.join(dir, "gh");
  fs.writeFileSync(gh, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${dir}/gh.calls"\n${ghBody}\n`);
  fs.chmodSync(gh, 0o755);
  const r = spawnSync("bash", [path.join(OPS, script), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: dir, GH: gh, RETRY_SLEEP: "0", NODE_ENV: "test" },
  });
  const file = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
  return {
    status: r.status,
    calls: file(path.join(dir, "gh.calls")).split("\n").filter(Boolean),
    log: file(path.join(dir, "Library", "Logs", "dailyreport", logName)),
  };
}
const runMonitor = (args: string[], ghBody: string) => runOps("monitor.sh", "monitor.log", args, ghBody);
const runDispatch = (args: string[], ghBody: string) => runOps("dispatch.sh", "trigger.log", args, ghBody);

for (const kind of ["market", "etf", "all"] as const) {
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

// StartCalendarInterval 항목(Hour, Minute, Weekday 순)을 [시, 분, 요일] 배열로 뽑는다.
const calendarEntries = (p: string) =>
  [...p.matchAll(/<dict>\s*<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>\s*<\/dict>/g)]
    .map((m) => m.slice(1).map(Number));
const weekdays = [1, 2, 3, 4, 5];

test("dispatch.sh both: daily-report 워크플로를 main에서 only=both로 dispatch하고 로그를 남긴다", () => {
  const r = runDispatch(["both"], "exit 0");
  assert.equal(r.status, 0);
  assert.deepEqual(r.calls, ["workflow run 260067407 --repo yalkongs/dailyreport --ref main -f only=both"]);
  assert.match(r.log, /\[both\] dispatch ok \(attempt 1\)/);
});

test("dispatch.sh: market·etf는 그대로 허용, 알 수 없는 인자는 dispatch 없이 exit 2", () => {
  for (const kind of ["market", "etf"]) {
    const r = runDispatch([kind], "exit 0");
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, [`workflow run 260067407 --repo yalkongs/dailyreport --ref main -f only=${kind}`]);
  }
  for (const args of [[], ["all"]]) {
    const r = runDispatch(args, "exit 0");
    assert.equal(r.status, 2);
    assert.equal(r.calls.length, 0);
  }
});

test("morning plist: 월~금 06:40·07:20 → dispatch.sh both", () => {
  const p = read("com.yalkongs.dailyreport.morning.plist");
  assert.match(p, /<key>Label<\/key>\s*<string>com\.yalkongs\.dailyreport\.morning<\/string>/);
  assert.match(p, /dispatch\.sh<\/string>\s*<string>both<\/string>/);
  assert.match(
    p,
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/bin\/bash<\/string>\s*<string>\/Users\/yalkongs\/Project\/dailyreport\/ops\/macmini\/dispatch\.sh<\/string>\s*<string>both<\/string>\s*<\/array>/,
  );
  const times = [...p.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual([...new Set(times)].sort(), ["6:40", "7:20"]);
  assert.deepEqual(calendarEntries(p), [[6, 40], [7, 20]].flatMap(([h, m]) => weekdays.map((d) => [h, m, d])));
  assert.match(p, /<string>\/Users\/yalkongs\/Library\/Logs\/dailyreport\/morning\.err\.log<\/string>/);
  assert.match(p, /<string>\/Users\/yalkongs\/Library\/Logs\/dailyreport\/morning\.out\.log<\/string>/);
});

test("monitor plist: 월~금 07:45 → monitor.sh all", () => {
  const p = read("com.yalkongs.dailyreport.monitor.plist");
  assert.match(p, /<key>Label<\/key>\s*<string>com\.yalkongs\.dailyreport\.monitor<\/string>/);
  assert.match(p, /monitor\.sh<\/string>\s*<string>all<\/string>/);
  assert.match(
    p,
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/bin\/bash<\/string>\s*<string>\/Users\/yalkongs\/Project\/dailyreport\/ops\/macmini\/monitor\.sh<\/string>\s*<string>all<\/string>\s*<\/array>/,
  );
  assert.match(p, /<integer>7<\/integer>\s*<key>Minute<\/key>\s*<integer>45<\/integer>/);
  assert.deepEqual(calendarEntries(p), weekdays.map((d) => [7, 45, d]));
  assert.match(p, /<string>\/Users\/yalkongs\/Library\/Logs\/dailyreport\/monitor\.err\.log<\/string>/);
  assert.match(p, /<string>\/Users\/yalkongs\/Library\/Logs\/dailyreport\/monitor\.out\.log<\/string>/);
});

const OLD = ["market", "etf", "monitor.market", "monitor.etf"].map((l) => `com.yalkongs.dailyreport.${l}`);
const NEW = ["morning", "monitor"].map((l) => `com.yalkongs.dailyreport.${l}`);
const labelsOf = (s: string, name: string) => s.match(new RegExp(`^${name}=\\(([^)]*)\\)`, "m"))![1].split(/\s+/).filter(Boolean);

test("install.sh: 옛 라벨 4개를 내리고 새 라벨 2개만 설치", () => {
  const s = read("install.sh");
  for (const old of ["market", "etf", "monitor.market", "monitor.etf"]) assert.match(s, new RegExp(`com\\.yalkongs\\.dailyreport\\.${old.replace(".", "\\.")}\\b`));
  assert.match(s, /INSTALL_LABELS=\(com\.yalkongs\.dailyreport\.morning com\.yalkongs\.dailyreport\.monitor\)/);
  // 제거 대상 = 옛 4개 + 새 2개, 설치 대상 = 새 2개뿐
  assert.deepEqual(labelsOf(s, "OLD_LABELS").sort(), [...OLD, ...NEW].sort());
  assert.deepEqual(labelsOf(s, "INSTALL_LABELS"), NEW);
  for (const l of NEW) assert.ok(fs.existsSync(path.join(OPS, `${l}.plist`)), `${l}.plist 없음`);
  for (const l of OLD) assert.ok(!fs.existsSync(path.join(OPS, `${l}.plist`)), `옛 ${l}.plist가 남아 있다`);
});

test("install.sh: OLD_LABELS 전부 bootout·삭제하고 INSTALL_LABELS만 lint·복사·bootstrap", () => {
  const s = read("install.sh");
  assert.match(s, /for label in "\$\{OLD_LABELS\[@\]\}"; do\s*launchctl bootout[^\n]*\n\s*rm -f/);
  assert.match(s, /for label in "\$\{INSTALL_LABELS\[@\]\}"; do\s*plutil -lint[^\n]*\n\s*cp [^\n]*\n\s*launchctl bootstrap/);
});

test("dispatch.sh both·monitor.sh all 허용", () => {
  assert.match(read("dispatch.sh"), /market\|etf\|both\)/);
  assert.match(read("monitor.sh"), /market\|etf\|all\)/);
});
