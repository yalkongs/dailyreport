import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConsistencySoftFixesInPlace } from "./report-quality";
import type { MorningReport } from "./types";

// JSON 문자열 레벨 soft fix가 report 객체를 in-place로 교정하는지 검증.
// 2026-10-17 출력 스키마 개편: 옛 overnightBrief.narrative·narrativeNotes.bigPicture 자리를 새 산문 필드로.
function baseReport(overseas: string, focus: string): MorningReport {
  return {
    cover: { headline: "H", subline: "S" },
    summary: { overseas, domestic: "D", focus },
    assetCards: [{ key: "kr-large", ifHolding: "IH", ifConsidering: "IC" }],
    todayChecks: [{ time: "09:00", what: "W", baseline: "B", invalidation: "X" }],
    card: { key: "kr-large", line: "L" },
  };
}

test("temporal 오류를 JSON 레벨에서 교정하고 report를 mutate", () => {
  const report = baseReport("내일(07/23, 목) GDP 발표가 있습니다.", "오늘은 화요일입니다.");
  const r = applyConsistencySoftFixesInPlace(report, "2026-07-21", []);
  assert.equal(report.summary.overseas, "모레(07/23, 목) GDP 발표가 있습니다.");
  assert.equal(r.temporalViolations.length, 0);
  assert.ok(r.softFixes.length >= 1);
});

test("창 밖 상대시제는 temporalViolations로 보고, 텍스트 무변경", () => {
  const report = baseReport("내일(09/15, 화) 지표", "빅픽처");
  const r = applyConsistencySoftFixesInPlace(report, "2026-07-21", []);
  assert.equal(report.summary.overseas, "내일(09/15, 화) 지표");
  assert.equal(r.temporalViolations.length, 1);
});

test("비승인 출처 프레임을 외신으로 치환", () => {
  const report = baseReport("Crypto Briefing이 전한 전망입니다.", "빅픽처");
  const r = applyConsistencySoftFixesInPlace(report, "2026-07-21", ["Crypto Briefing"]);
  assert.equal(report.summary.overseas, "외신이 전한 전망입니다.");
  assert.ok(r.softFixes.length >= 1);
});

test("citationCount 집계", () => {
  const report = baseReport(
    "A에 따르면 X. B에 따르면 Y.",
    "C에 따르면 Z. D에 따르면 W. E에 따르면 V."
  );
  const r = applyConsistencySoftFixesInPlace(report, "2026-07-21", []);
  assert.equal(r.citationCount, 5);
});

test("교정 대상 없으면 report 무변경", () => {
  const report = baseReport("코스피가 상승했습니다.", "반도체가 강세입니다.");
  const before = JSON.stringify(report);
  const r = applyConsistencySoftFixesInPlace(report, "2026-07-21", []);
  assert.equal(JSON.stringify(report), before);
  assert.equal(r.softFixes.length, 0);
  assert.equal(r.temporalViolations.length, 0);
});
