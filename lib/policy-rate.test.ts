import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePolicyRate, daysBetween, type RatePoint } from "./policy-rate";

const TODAY = "2026-10-05";
const WINDOW = "2023-10-05";

/** start~end 매일 값. changes: [효력일, 새 값] */
function daily(start: string, end: string, initial: number, changes: [string, number][] = []): RatePoint[] {
  const out: RatePoint[] = [];
  let v = initial;
  const map = new Map(changes);
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (map.has(d)) v = map.get(d)!;
    out.push({ date: d, value: v });
  }
  return out;
}

const opts = (label = "한국은행 기준금리") => ({ label, today: TODAY, windowStart: WINDOW });

test("daysBetween", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-05"), 4);
});

test("실제 연준 이력: 인하 사이클 뒤 첫 인상 → 전환", () => {
  const pts = daily(WINDOW, "2026-10-04", 5.5, [
    ["2024-09-19", 5.0], ["2024-11-08", 4.75], ["2024-12-19", 4.5],
    ["2025-09-18", 4.25], ["2025-10-30", 4.0], ["2025-12-11", 3.75], ["2026-09-17", 4.0],
  ]);
  const s = summarizePolicyRate(pts, { ...opts("미 연준 목표범위"), currentText: "3.75~4.00%" })!;
  assert.equal(s.current, 4);
  assert.equal(s.currentText, "3.75~4.00%");
  assert.deepEqual(s.lastChange, { date: "2026-09-17", delta: 0.25 });
  assert.deepEqual(s.prevChange, { date: "2025-12-11", delta: -0.25 });
  assert.equal(s.stance, "인상(인하→인상 전환)");
  assert.equal(s.stanceDirection, "hike");
  assert.equal(s.asOf, "2026-10-04");
});

test("한은 2회 연속 인상", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.currentText, "3.00%");
  assert.equal(s.stance, "인상(2회 연속)");
  assert.equal(s.stanceDirection, "hike");
});

test("단일 인하", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2026-08-01", 2.75]]), opts())!;
  assert.equal(s.stance, "인하");
  assert.equal(s.stanceDirection, "cut");
  assert.equal(s.prevChange, null);
});

test("마지막 변경 후 365일 초과 → 동결 지속", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2025-01-10", 3.25]]), opts())!;
  assert.equal(s.stance, "동결 지속(마지막 변경: 인상 2025-01-10)");
  assert.equal(s.stanceDirection, "hold");
});

test("3년 무변경", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.5), opts())!;
  assert.equal(s.lastChange, null);
  assert.equal(s.stance, "동결 지속(최근 3년 변경 없음)");
  assert.equal(s.stanceDirection, "hold");
});

test("365일 넘게 떨어진 같은 방향 두 변경은 연속이 아니다", () => {
  const s = summarizePolicyRate(daily(WINDOW, "2026-10-04", 3.0, [["2024-01-10", 3.25], ["2026-09-01", 3.5]]), opts())!;
  assert.equal(s.stance, "인상(장기 동결 후 첫 변경)");
});

test("NaN 관측은 건너뛴다", () => {
  const pts = daily(WINDOW, "2026-10-04", 2.5, [["2026-07-16", 2.75], ["2026-08-27", 3.0]]);
  pts.splice(100, 0, { date: pts[100].date, value: NaN });
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.stance, "인상(2회 연속)");
});

test("부동소수 오차는 변경이 아니다", () => {
  const pts = daily(WINDOW, "2026-10-04", 0.3);
  pts[500] = { ...pts[500], value: 0.1 + 0.2 };
  const s = summarizePolicyRate(pts, opts())!;
  assert.equal(s.lastChange, null);
});

test("빈 입력 → null", () => {
  assert.equal(summarizePolicyRate([], opts()), null);
});

test("마지막 관측이 7일 넘게 오래됨 → null", () => {
  assert.equal(summarizePolicyRate(daily(WINDOW, "2026-09-20", 3.0), opts()), null);
});

test("이력이 조회 시작보다 30일 넘게 늦게 시작 → null", () => {
  assert.equal(summarizePolicyRate(daily("2026-01-01", "2026-10-04", 3.0), opts()), null);
});

test("7일 초과 공백 직후 값이 바뀌면 → null", () => {
  const pts = daily(WINDOW, "2026-10-04", 3.75, [["2026-09-17", 4.0]])
    .filter((p) => p.date < "2026-09-08" || p.date > "2026-09-17");
  assert.equal(summarizePolicyRate(pts, opts()), null);
});
