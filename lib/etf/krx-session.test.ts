import { test } from "node:test";
import assert from "node:assert/strict";
import { toKrxBasDd, expectedKrxBasDd, resolveKrxSession, krxRequestOrder } from "./krx-session";

test("toKrxBasDd: ISO 날짜를 KRX basDd로", () => {
  assert.equal(toKrxBasDd("2026-09-17"), "20260917");
});

test("expectedKrxBasDd: 평일은 하루 전", () => {
  assert.equal(expectedKrxBasDd("2026-09-18"), "20260917"); // 금 → 목
});

test("expectedKrxBasDd: 월요일은 지난 금요일", () => {
  assert.equal(expectedKrxBasDd("2026-09-14"), "20260911");
});

test("expectedKrxBasDd: 휴일 다음 날은 휴일을 건너뛴다 (08-17 광복절 대체공휴일)", () => {
  assert.equal(expectedKrxBasDd("2026-08-18"), "20260814");
});

test("resolveKrxSession: 직전 거래일이면 prev-session", () => {
  assert.equal(resolveKrxSession("20260917", "2026-09-18"), "prev-session");
});

test("resolveKrxSession: 이틀 전 세션이면 stale (06:40 실행의 실제 상황)", () => {
  assert.equal(resolveKrxSession("20260916", "2026-09-18"), "stale");
});

test("resolveKrxSession: 일요일 기준일로 온 응답도 stale (09-15 실행의 20260913 사례)", () => {
  assert.equal(resolveKrxSession("20260913", "2026-09-15"), "stale");
});

test("resolveKrxSession: 응답이 없으면 none", () => {
  assert.equal(resolveKrxSession(null, "2026-09-18"), "none");
  assert.equal(resolveKrxSession("", "2026-09-18"), "none");
});


test("krxRequestOrder: 직전 거래일을 먼저 요청하고, 그다음에야 날짜를 역행한다 (월요일 일요일-행 함정 방지)", () => {
  // 09-22(화) 06:45 실행에서 KRX가 일요일(0920) 기준일로 빈 값 1171행을 돌려준 것이 관측됐다.
  // 오늘부터 역행하면 월요일엔 일요일 행을 먼저 만나 매주 stale이 된다.
  // 09-28(월)의 직전 거래일은 추석 연휴(09-24~25)를 건너뛴 09-23(수).
  const order = krxRequestOrder("2026-09-28", "2026-09-28");
  assert.equal(order[0], "20260923");
  assert.ok(!order.slice(1).includes("20260923"));
  assert.deepEqual(order.slice(1, 4), ["20260928", "20260927", "20260926"]);
});

test("krxRequestOrder: 백필(과거 reportDate)도 그 날짜의 직전 거래일을 먼저 요청한다", () => {
  assert.equal(krxRequestOrder("2026-09-16", "2026-09-28")[0], "20260915");
});
