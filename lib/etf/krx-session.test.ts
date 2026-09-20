import { test } from "node:test";
import assert from "node:assert/strict";
import { toKrxBasDd, expectedKrxBasDd, resolveKrxSession, probeDeadlinePassed } from "./krx-session";

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

test("probeDeadlinePassed: 09:10 이전은 계속, 이후는 중단", () => {
  assert.equal(probeDeadlinePassed("07:52"), false);
  assert.equal(probeDeadlinePassed("09:09"), false);
  assert.equal(probeDeadlinePassed("09:10"), true);
  assert.equal(probeDeadlinePassed("10:35"), true);
});
