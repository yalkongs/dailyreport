import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEvidenceConfidence } from "./evidence-confidence";
import type { ContextData, NewsHeadline } from "./types";

function ctx(news: NewsHeadline[], failedSources: string[] = []): ContextData {
  return {
    news,
    economicCalendar: [],
    fredIndicators: [],
    sentiment: {},
    investorFlow: null,
    koreanBonds: [],
    historicalComparison: [],
    contextErrors: failedSources.map((source) => ({ source, status: "error", message: "x" })),
  };
}

const strongNews: NewsHeadline = {
  title: "삼성전자 노사 협상 타결",
  source: "Google News 대형주",
  category: "korea",
  publishedHoursAgo: 1,
};
const weakFreshNews: NewsHeadline = {
  title: "코스피 외국인 순매수 지속",
  source: "Google News 수급",
  category: "korea",
  publishedHoursAgo: 1,
};
const noiseNews: NewsHeadline = {
  title: "오늘 서울 날씨 대체로 맑음",
  source: "etc",
  category: "global",
  publishedHoursAgo: 30,
};

test("strong: 고점수 catalyst + 신선", () => {
  const r = analyzeEvidenceConfidence(ctx([strongNews]));
  assert.equal(r.tier, "strong");
  assert.ok(r.topCatalystScore >= 7);
  assert.equal(r.freshCount, 1);
});

test("thin: catalyst 있으나 약함(4~6)", () => {
  const r = analyzeEvidenceConfidence(ctx([weakFreshNews]));
  assert.equal(r.tier, "thin");
});

test("hollow: minScore 통과 catalyst 0건", () => {
  const r = analyzeEvidenceConfidence(ctx([noiseNews]));
  assert.equal(r.tier, "hollow");
});

test("hollow: 뉴스 빈 배열", () => {
  const r = analyzeEvidenceConfidence(ctx([]));
  assert.equal(r.tier, "hollow");
  assert.equal(r.newsCount, 0);
});

test("hollow: news 소스 실패 (catalyst 있어도)", () => {
  const r = analyzeEvidenceConfidence(ctx([strongNews], ["news"]));
  assert.equal(r.tier, "hollow");
  assert.deepEqual(r.failedSources, ["news"]);
});

test("context null → hollow", () => {
  const r = analyzeEvidenceConfidence(null);
  assert.equal(r.tier, "hollow");
});
