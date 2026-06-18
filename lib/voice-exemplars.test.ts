import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVoiceExemplars, HEADLINE_EXEMPLARS } from "./voice-exemplars";

test("renderVoiceExemplars: 원칙·시드 헤드라인·반례를 한 블록에 담는다", () => {
  const block = renderVoiceExemplars();
  // 원칙(긍정+소프트 칼리브레이션)
  assert.match(block, /진부한 비유와 반복되는 구문 틀은 피하라/);
  // 시드 헤드라인 포함(자사 살아남은 문장)
  assert.ok(block.includes(HEADLINE_EXEMPLARS[0].text));
  // 구조 클리셰 반례 명시
  assert.match(block, /그린 \[지도/);
});

test("HEADLINE_EXEMPLARS: 각 항목은 text와 note를 가진다", () => {
  assert.ok(HEADLINE_EXEMPLARS.length >= 3);
  for (const e of HEADLINE_EXEMPLARS) {
    assert.equal(typeof e.text, "string");
    assert.equal(typeof e.note, "string");
    assert.ok(e.text.length > 0 && e.note.length > 0);
  }
});
