import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderVoiceExemplars } from "./voice-exemplars";
import { buildTemporalFramingBlock } from "./temporal-framing";
import { describeWeekdayRhythm } from "./weekday-rhythm";
import { getMarketCalendarInfo } from "./market-calendar";

const frozen: Record<string, string> = JSON.parse(
  fs.readFileSync("lib/__fixtures__/market-prompt-freeze.json", "utf8"),
);

test("market 목표 보이스 블록은 묶음 3 이전과 바이트 단위로 같다", () => {
  assert.equal(renderVoiceExemplars(), frozen.voice);
  assert.equal(renderVoiceExemplars("market"), frozen.voice);
});

for (const d of ["2026-06-30", "2026-06-29", "2026-01-19", "2026-10-06", "2026-09-28"]) {
  test(`market 시점 블록(${d})은 고정 스냅샷과 같다(2026-10-06 결정 8 확장으로 의도적 갱신)`, () => {
    assert.equal(buildTemporalFramingBlock(getMarketCalendarInfo(d), "market"), frozen[`temporal_${d}`]);
  });
}

for (const role of ["monday_setup", "friday_recap", "midweek"] as const) {
  test(`market 요일 리듬(${role})은 묶음 3 이전과 같다`, () => {
    assert.equal(describeWeekdayRhythm(role, "market"), frozen[`weekday_${role}`]);
  });
}
