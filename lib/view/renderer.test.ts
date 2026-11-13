import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceNumbers, renderTwinChart, renderViewReport, viewCardSvg, VIEW_DISCLAIMER } from "./renderer";
import { checkViewCompliance } from "../../scripts/render-view";
import type { ViewContent, ViewFacts } from "./types";

const facts: ViewFacts = {
  issue_date: "2026-11-16",
  evidence: {
    cutoff: "2026-11-16T06:00:00+09:00",
    rows: [
      { id: "dep_new@2026-09", kind: "level", source: "한국은행", name: "예금은행 저축성수신금리(신규취급액 기준)", period_label: "2026년 9월중", value: 3.45, unit: "%", value_display: "3.45%", published: "10월 29일 12:00", url: "https://ecos.bok.or.kr" },
      { id: "dep_new@2026-09:mom", kind: "diff", source: "한국은행(파생)", name: "예금은행 저축성수신금리(신규취급액 기준)", period_label: "2026년 9월중", value: 0.24, unit: "%p", value_display: "+0.24%p", formula: "당월 − 전월" },
      { id: "def:고정금리", kind: "definition", source: "한국은행 ECOS 통계용어", name: "고정금리", text: "약정 기간 중 금리를 일정 수준으로 고정" },
    ],
    parts: { rates: { latest_label: "2026년 9월", next_release: { title: "2026년 10월 금융기관 가중평균금리", date: "2026-11-25", time: "12:00", label: "11월 25일 12:00", source: "한국은행 통계 공표 일정" } } },
    chart: { dep_new: [{ period: "2026-08", value: 3.21 }, { period: "2026-09", value: 3.45 }], dep_bal: [{ period: "2026-08", value: 2.2 }, { period: "2026-09", value: 2.27 }] },
  },
  card_stats: [{ label: "신규취급", value: "3.45%", caption: "9월중 저축성", tone: "neutral" }],
  chart_panels: [
    { key: "dep_new", title: "신규취급액 기준 저축성수신금리", unit: "%", points: [{ period: "2026-08", value: 3.21 }, { period: "2026-09", value: 3.45 }] },
    { key: "dep_bal", title: "잔액 기준 총수신금리", unit: "%", points: [{ period: "2026-08", value: 2.2 }, { period: "2026-09", value: 2.27 }] },
  ],
  sources_line: "한국은행 ECOS·보도자료·통계 공표 일정",
  cited: [],
};
const s = (text: string, evidence: string[] = [], type: "fact" | "interpretation" | "conditional" = "fact") => ({ text, type, evidence });
const content: ViewContent = {
  title: "예금금리가 올랐다는데 내 통장엔 언제 반영될까?", cardLine: "새 거래부터, 기존 예금은 만기 때",
  lede: [s("고정금리 예금은 <script>x</script> 만기 때 반영됩니다.", ["def:고정금리"], "interpretation")],
  body: [{ sentences: [s("신규취급액 기준 저축성수신금리는 3.45%로 0.24%p 올랐습니다.", ["dep_new@2026-09", "dep_new@2026-09:mom"])] }],
  chartCaption: s("최근 12개월 두 금리입니다.", ["meta:chart_window"], "interpretation"),
  readerCheck: [s("만기일을 확인해 보세요.", [], "interpretation")],
  closing: s("11월 25일 12:00 발표를 봅니다.", ["next:rates"], "interpretation"),
};

test("근거 번호는 관측 사실 문장에만, 인용 순서대로(해석 문장의 정의 인용·meta·next_release는 번호 없음)", () => {
  const refs = referenceNumbers(content, facts.evidence.rows);
  assert.deepEqual(Array.from(refs.entries()), [["dep_new@2026-09", 1], ["dep_new@2026-09:mom", 2]]);
});

test("HTML: 섹션 순서, 각주·근거표, 스크립트 이스케이프, 고지문 초안 표시", () => {
  const html = renderViewReport(content, facts);
  const order = ["masthead", "title", "lede", "chart", "body", "reader-check", "next", "evidence", "footer"].map((k) => html.indexOf(`data-section="${k}"`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `순서 ${order}`);
  assert.ok(html.includes('[1,2]</a>'));
  assert.ok(!html.includes("<script>x"));
  assert.ok(html.includes(VIEW_DISCLAIMER[0]) && !html.includes("초안</span>"), "확정 고지문, 초안 표시 없음");
  assert.ok(html.includes("11월 25일 12:00"));
});

test("차트 패널은 지시서 계열(같은 눈금)", () => {
  const svg = renderTwinChart(facts);
  assert.match(svg, /신규취급액 기준 저축성수신금리/);
  assert.match(svg, /잔액 기준 총수신금리/);
});

test("카드 머리 줄은 Economist View", () => {
  assert.match(viewCardSvg(content, facts), /Economist View/);
});

test("준법 검사", () => {
  assert.deepEqual(checkViewCompliance(content), { hard: [], soft: [], etf: [] });
});
