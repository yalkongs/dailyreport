// scripts/dev/capture-market-freeze.ts
// market 경로 프롬프트 조각의 현재 출력을 픽스처로 고정한다(묶음 3, 2026-09-30).
// 픽스처를 다시 만들 일은 market 프롬프트를 '의도적으로' 바꿀 때뿐이다.
import fs from "node:fs";
import { renderVoiceExemplars } from "../../lib/voice-exemplars";
import { buildTemporalFramingBlock } from "../../lib/temporal-framing";
import { describeWeekdayRhythm } from "../../lib/weekday-rhythm";
import { getMarketCalendarInfo } from "../../lib/market-calendar";

const out: Record<string, string> = { voice: renderVoiceExemplars() };
for (const d of ["2026-06-30", "2026-06-29", "2026-01-19", "2026-10-06", "2026-09-28"]) {
  out[`temporal_${d}`] = buildTemporalFramingBlock(getMarketCalendarInfo(d), "market");
}
for (const role of ["monday_setup", "friday_recap", "midweek"] as const) {
  out[`weekday_${role}`] = describeWeekdayRhythm(role, "market");
}
fs.mkdirSync("lib/__fixtures__", { recursive: true });
fs.writeFileSync("lib/__fixtures__/market-prompt-freeze.json", JSON.stringify(out, null, 2) + "\n");
console.log("wrote", Object.keys(out).length, "keys");
