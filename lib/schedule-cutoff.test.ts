import { test } from "node:test";
import assert from "node:assert/strict";
import { isLateScheduledRun } from "./schedule-cutoff";

test("백업 schedule: 08:50 KST 이후면 생성하지 않는다 · dispatch는 시각 무관", () => {
  const at = (hhmm: string) => new Date(`2026-11-27T${hhmm}:00+09:00`);
  assert.equal(isLateScheduledRun("schedule", at("07:30")), false);
  assert.equal(isLateScheduledRun("schedule", at("08:49")), false);
  assert.equal(isLateScheduledRun("schedule", at("08:50")), true);
  assert.equal(isLateScheduledRun("schedule", at("13:12")), true);
  assert.equal(isLateScheduledRun("workflow_dispatch", at("13:12")), false);
  assert.equal(isLateScheduledRun(undefined, at("13:12")), false);
});
