import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDeadline, TYPICAL_CALL_MS, CLAUDE_REQUEST_TIMEOUT_MS, CLAUDE_MAX_RETRIES } from "./claude-budget";

test("예산 안이면 새 호출 시작, 남은 시간이 통상 호출 시간보다 짧으면 시작하지 않음", () => {
  let t = 0;
  const d = makeDeadline(10 * 60_000, () => t);
  assert.equal(d.canStartCall(), true);
  t = 7 * 60_000;
  assert.equal(d.canStartCall(), true); // 7 + 3 = 10
  t = 7 * 60_000 + 1;
  assert.equal(d.canStartCall(), false);
  assert.equal(d.elapsedMs(), 7 * 60_000 + 1);
});

test("요청 상한·재시도는 SDK 기본값(10분·2회)보다 작다", () => {
  assert.ok(CLAUDE_REQUEST_TIMEOUT_MS < 10 * 60_000);
  assert.ok(CLAUDE_MAX_RETRIES < 2);
  assert.ok(TYPICAL_CALL_MS < CLAUDE_REQUEST_TIMEOUT_MS);
});

test("두 생성기 모두 요청 상한·재시도 횟수를 명시해 클라이언트를 만든다", async () => {
  const fs = await import("node:fs");
  for (const f of ["lib/claude-client.ts", "lib/etf/claude-client.ts"]) {
    const src = fs.readFileSync(f, "utf8");
    assert.match(src, /new Anthropic\(\{[^}]*timeout: CLAUDE_REQUEST_TIMEOUT_MS[^}]*maxRetries: CLAUDE_MAX_RETRIES/, f);
  }
});
