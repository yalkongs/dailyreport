import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVoiceExemplars, HEADLINE_EXEMPLARS, ETF_HEADLINE_EXEMPLARS } from "./voice-exemplars";

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

test("renderVoiceExemplars('etf'): ETF 예시 6개를 담고 market 예시·형태 반례는 뺀다", () => {
  const block = renderVoiceExemplars("etf");
  for (const t of [
    "원화, 하루 만에 20원 되찾다",
    "금 급락·반도체 하락, 방어 우위 국면 진입",
    "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화",
    "반도체 직격, 방어주가 버텼다",
    "미 국채 5% 벽, 원화가 먼저 무너졌다",
    "무디스 성장률 3.5% 상향, 반도체가 국내 주도",
  ]) assert.ok(block.includes(t), t);
  assert.equal(ETF_HEADLINE_EXEMPLARS.length, 6);
  assert.ok(!block.includes("금리 올린 연준, 달러만 웃었다"));   // market 예시
  assert.ok(!block.includes("데이터피드형 제목"));                // 정책으로 이동한 형태 반례
  assert.ok(!block.includes("2절 문어체 틀"));
  assert.ok(!block.includes("다음 날, [주절]"));
  assert.ok(block.includes("한 주를 닫다"));                      // 추가된 번역투 반례
  assert.ok(block.includes("N포인트를 잃었다"));                  // 유지된 반례
  assert.ok(block.includes("괴리율 확대가 체결 비용을 조용히 갉아먹습니다")); // 공유 본문 예시
});
