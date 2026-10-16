import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { EVIDENCE_RULES } from "./evidence-rules";

test("C07·C09: 근거·추론 경계 규칙이 자금 이동·원인·금리·거래대금·발표치를 다룬다", () => {
  for (const kw of ["자금 이동", "원인 주장", "수준·당일 변화·추세", "거래대금", "실제 발표치", "반토막"]) {
    assert.ok(EVIDENCE_RULES.includes(kw), kw);
  }
});

test("Market 시스템 프롬프트와 ETF 사용자 프롬프트가 같은 규칙을 쓴다", async () => {
  assert.match(fs.readFileSync("lib/claude-client.ts", "utf8"), /\$\{EVIDENCE_RULES\}/);
  const { buildMorningPrompt } = await import("./etf/claude-client");
  const p = buildMorningPrompt({
    reportType: "morning", date: "2026-10-16", quotes: [], flows: [], investorFlows: [], news: [], analysisLens: "",
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null },
  } as never);
  assert.ok(p.includes(EVIDENCE_RULES));
});
