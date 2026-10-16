import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCheck, calendarFor, type CheckInput } from "../scripts/check-delivery";

// 독립 도착 감시(감사 F06b)의 판정 — 영업일에 telegram/<kind>=success가 아니면 모두 경보.
const base: CheckInput = {
  kind: "market",
  date: "2026-10-14",
  calendarCovered: true,
  krOpen: true,
  reportSha: "abc123",
  telegramStatus: "success",
  lookupError: null,
};

test("decideCheck: 영업일 + success → 통과", () => {
  const r = decideCheck(base);
  assert.equal(r.ok, true);
  assert.equal(r.code, "sent");
});

test("decideCheck: 한국 휴장(주말·공휴일)은 리포트가 없어도 통과 — 정상 휴장에 경보 금지", () => {
  const r = decideCheck({ ...base, krOpen: false, holidayName: "한글날", reportSha: null, telegramStatus: null });
  assert.equal(r.ok, true);
  assert.equal(r.code, "holiday");
  assert.match(r.message, /휴장\(한글날\)/);
  assert.match(decideCheck({ ...base, krOpen: false, reportSha: null, telegramStatus: null }).message, /휴장\(주말\)/);
});

test("decideCheck: 휴장 캘린더가 없는 해는 실패 — 파이프라인이 발송을 막으므로 갱신 필요", () => {
  const r = decideCheck({ ...base, date: "2099-01-05", calendarCovered: false });
  assert.equal(r.ok, false);
  assert.equal(r.code, "calendar_missing");
  assert.match(r.message, /2099년/);
});

test("decideCheck: 조회 실패 → 실패(조회 실패)", () => {
  const r = decideCheck({ ...base, reportSha: null, telegramStatus: null, lookupError: "GitHub API 503" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "lookup_failed");
  assert.match(r.message, /조회 실패.*503/);
});

test("decideCheck: 영업일인데 리포트 커밋 없음 → 실패(리포트 없음)", () => {
  const r = decideCheck({ ...base, reportSha: null, telegramStatus: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, "no_report");
  assert.match(r.message, /리포트 없음/);
});

test("decideCheck: 리포트는 있는데 status 없음 → 실패(미발송)", () => {
  const r = decideCheck({ ...base, telegramStatus: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, "not_sent");
  assert.match(r.message, /미발송/);
});

test("decideCheck: pending·error는 결과 불명 → 실패, failure는 발송 실패 → 실패", () => {
  for (const s of ["pending", "error", "failure"] as const) {
    const r = decideCheck({ ...base, kind: "etf", telegramStatus: s });
    assert.equal(r.ok, false, s);
    assert.equal(r.code, s);
    assert.match(r.message, new RegExp(`status=${s}`));
    assert.match(r.message, /^ETF 리포트\(2026-10-14\)/);
  }
});

test("calendarFor: lib/market-calendar 기준 — 영업일·주말·공휴일·미커버 연도", () => {
  assert.deepEqual(calendarFor("2026-10-14"), { calendarCovered: true, krOpen: true, holidayName: undefined });
  assert.deepEqual(calendarFor("2026-10-17"), { calendarCovered: true, krOpen: false, holidayName: undefined });
  assert.deepEqual(calendarFor("2026-10-09"), { calendarCovered: true, krOpen: false, holidayName: "한글날" });
  assert.equal(calendarFor("2099-01-05").calendarCovered, false);
});
