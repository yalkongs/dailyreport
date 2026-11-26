// 2026-11-23 마켓: 항셍 -3.79%(이틀 누적)를 하루 등락으로 씀 — 야후 이전 종가가 두 세션 전 값이었다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePreviousClose } from "./market-data";

const bars = [
  { date: "2026-11-18", close: 23294.75 },
  { date: "2026-11-19", close: 22841.62 },
  { date: "2026-11-20", close: 22410.8 },
];

test("이전 종가가 두 세션 전 종가면 직전 일봉으로 다시 계산(11-20 항셍)", () => {
  const q = { price: 22410.8, change: -883.95, changePercent: -3.79, previousClose: 23294.75, asOf: "2026-11-20" };
  const r = reconcilePreviousClose(q, bars);
  assert.equal(r.corrected, true);
  assert.equal(r.previousClose, 22841.62);
  assert.ok(Math.abs((r.changePercent as number) - -1.886) < 0.01);
});

test("이전 종가가 직전 일봉과 같으면 그대로", () => {
  const q = { price: 22410.8, change: -430.82, changePercent: -1.89, previousClose: 22841.62, asOf: "2026-11-20" };
  assert.equal(reconcilePreviousClose(q, bars).corrected, false);
});

test("선물 정산가처럼 어느 일봉과도 다르면 건드리지 않는다", () => {
  const q = { price: 3593, change: 28.4, changePercent: 0.8, previousClose: 3564.6, asOf: "2026-11-26" };
  const gold = [{ date: "2026-11-24", close: 3561.9 }, { date: "2026-11-25", close: 3535.8 }, { date: "2026-11-26", close: 3593 }];
  assert.equal(reconcilePreviousClose(q, gold).corrected, false);
});

test("시세 날짜 당일 일봉은 이전 종가 후보가 아니다 · 일봉 부족·무효 값은 그대로", () => {
  const q = { price: 22410.8, change: null, changePercent: -3.79, previousClose: 23294.75, asOf: "2026-11-20" };
  assert.equal(reconcilePreviousClose(q, bars.slice(1)).corrected, false);
  assert.equal(reconcilePreviousClose({ ...q, asOf: null }, bars).corrected, false);
  assert.equal(reconcilePreviousClose(q, [...bars.slice(0, 1), { date: "2026-11-19", close: null }, bars[2]]).corrected, false);
});

test("withDeadline: 멈춘 보조 호출은 시한에 reject — 호출자가 원래 시세로 계속한다", async () => {
  const { withDeadline } = await import("./fetch-utils");
  const t0 = Date.now();
  await assert.rejects(withDeadline(new Promise(() => {}), 50, "멈춤"), /50ms 초과/);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await withDeadline(Promise.resolve(7), 50, "정상"), 7);
});
