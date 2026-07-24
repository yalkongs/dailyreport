import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAndFixTemporal } from "./temporal-consistency";

// 발행일 2026-07-21(화) 기준 실사례. 07-22=수, 07-23=목, 07-28=화.
const REPORT = "2026-07-21";

test("상대어 교정: 내일(07/23, 목) → 모레(07/23, 목) (gap +2)", () => {
  const r = checkAndFixTemporal("내일(07/23, 목) GDP 발표", REPORT);
  assert.equal(r.fixed, "모레(07/23, 목) GDP 발표");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 1);
});

test("요일 오기 교정: 내일(07/22, 목) → 내일(07/22, 수) (gap +1)", () => {
  const r = checkAndFixTemporal("내일(07/22, 목)", REPORT);
  assert.equal(r.fixed, "내일(07/22, 수)");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 1);
});

test("상대어 없는 요일 오기: 07/23(금) → 07/23(목)", () => {
  const r = checkAndFixTemporal("07/23(금) 이벤트", REPORT);
  assert.equal(r.fixed, "07/23(목) 이벤트");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 1);
});

test("창 밖 날짜: 내일(09/15, 화) → hard violation, 텍스트 무변경", () => {
  const src = "내일(09/15, 화) 지표";
  const r = checkAndFixTemporal(src, REPORT);
  assert.equal(r.fixed, src);
  assert.equal(r.violations.length, 1);
  assert.equal(r.softFixes.length, 0);
});

test("상대어 +0/+1/+2 불능: 내일(07/28, 화) → hard violation (요일은 정합)", () => {
  const src = "내일(07/28, 화) FOMC";
  const r = checkAndFixTemporal(src, REPORT);
  assert.equal(r.fixed, src);
  assert.equal(r.violations.length, 1);
  assert.equal(r.softFixes.length, 0);
});

test("연말 경계: 2026-12-31 발행 + 내일(1/1, 토) → 내일(1/1, 금)", () => {
  const r = checkAndFixTemporal("내일(1/1, 토) 신정", "2026-12-31");
  assert.equal(r.fixed, "내일(1/1, 금) 신정");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 1);
});

test("연말 경계 정합 케이스는 무변경: 내일(1/1, 금)", () => {
  const r = checkAndFixTemporal("내일(1/1, 금)", "2026-12-31");
  assert.equal(r.fixed, "내일(1/1, 금)");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 0);
});

test("정합 토큰은 무변경: 오늘(07/21, 화)", () => {
  const r = checkAndFixTemporal("오늘(07/21, 화) 개장", REPORT);
  assert.equal(r.fixed, "오늘(07/21, 화) 개장");
  assert.equal(r.softFixes.length, 0);
  assert.equal(r.violations.length, 0);
});

test("패턴 없는 텍스트는 무변경, 빈 결과", () => {
  const src = "코스피는 오늘 상승 출발했습니다. 반도체가 강세입니다.";
  const r = checkAndFixTemporal(src, REPORT);
  assert.equal(r.fixed, src);
  assert.equal(r.softFixes.length, 0);
  assert.equal(r.violations.length, 0);
});

test("한 텍스트에 상대어·요일 오기 복합 교정", () => {
  // 내일(07/23,목) → 모레, 그리고 07/22(목) → 07/22(수)
  const r = checkAndFixTemporal("내일(07/23, 목)와 07/22(목)", REPORT);
  assert.equal(r.fixed, "모레(07/23, 목)와 07/22(수)");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 2);
});

test("요일 '일' 교정이 상대어 '내일'을 오염시키지 않음 (회귀)", () => {
  // 2026-07-31(금) 발행, 08/01은 토요일. 잘못된 요일 '일'을 교정할 때
  // "내일"의 '일'이 아니라 괄호 안 요일만 바뀌어야 한다.
  const r = checkAndFixTemporal("내일(08/01, 일) 휴장", "2026-07-31");
  assert.equal(r.fixed, "내일(08/01, 토) 휴장");
  assert.equal(r.violations.length, 0);
  assert.equal(r.softFixes.length, 1);
});
