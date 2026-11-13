import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFanChart, renderWeeklyReport, weeklyCardSvg } from "./renderer";
import { checkWeeklyCompliance } from "../../scripts/render-weekly";
import { LEGAL_DISCLAIMER_ITEMS } from "../legal-disclaimer";
import type { WeeklyContent, WeeklyFacts } from "./types";

const facts: WeeklyFacts = {
  issue_date: "2026-11-09", issue_label: "2026년 11월 9일",
  review_week: { start: "2026-11-02", end: "2026-11-06", label: "11월 2일(월)~11월 6일(금)" },
  outlook_week: { start: "2026-11-09", end: "2026-11-13", label: "11월 9일(월)~11월 13일(금)" },
  market: [{ key: "kospi", name: "코스피", kind: "pct", change: -11.7, close_display: "5,059.69", change_display: "-11.7%", close_date: "2026-11-06", direction: "down" }],
  stripes: [{ date: "2026-10-30", pct: 3.2 }, { date: "2026-11-06", pct: -11.7 }],
  macro: [{ key: "kr_cpi_yoy", name: "소비자물가 상승률", period_label: "2026년 10월", value_display: "2.8%", prev_period_label: "2026년 9월", prev_display: "2.9%", change_display: "-0.1%p" }],
  model: {
    published: [{
      key: "kr_cpi_yoy", name: "소비자물가 상승률", unit: "%", decimals: 1, last_label: "2026년 10월", last_display: "2.8%",
      history: [{ period: "2026-09", value: 2.9 }, { period: "2026-10", value: 2.8 }],
      forecast: [{ period: "2026-11", period_label: "2026년 11월", median_display: "2.8%", band68_display: "2.4~3.2%", band90_display: "2.2~3.4%", median: 2.8, lower_68: 2.4, upper_68: 3.2, lower_90: 2.2, upper_90: 3.4 }],
      backtest_error_reduction_display: "10%",
    }],
    held_back: [{ key: "kr_ktb3y", name: "국고채 3년" }],
    scenario: { name: "유가 ±20%", months: 6, rows: [] },
    us_rate_shock: { shock_display: "미국 정책금리 0.25%p 인상", rows: [], held_back: [] },
  },
  calendar: [{ date: "2026-11-10", date_label: "11월 10일(화)", time: "22:30", country: "미국", name: "미국 CPI", importance: 5 }],
};
const content: WeeklyContent = {
  headline: "코스피 11.7% 급락, 유가도 하락", subline: "부제 <script>x</script>", cardLine: "카드 한 줄",
  summary: { lastWeek: "지난주", thisWeek: "이번 주", outlook: "전망" },
  review: ["문단 <strong>강조</strong>"], watch: [{ date: "2026-11-10", title: "미국 CPI", body: "본문" }],
  outlook: { inflation: "물가", scenario: "", usRate: "", limits: "한계" },
  risks: [{ title: "리스크", ifConfirmed: "확인", ifNot: "어긋남" }], closing: "마무리",
};

test("주간 HTML: 섹션 순서, 법적 고지 맨 끝, 스크립트 이스케이프, 강조 태그만 허용", () => {
  const html = renderWeeklyReport(content, facts);
  const order = ["masthead", "title", "summary", "last-week", "macro", "this-week", "outlook", "risks", "method", "footer"]
    .map((s) => html.indexOf(`data-section="${s}"`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `순서: ${order}`);
  assert.ok(html.includes(LEGAL_DISCLAIMER_ITEMS[0]));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<strong>강조</strong>"));
  assert.ok(html.includes("/weekly-reports/2026-11-09-preview.png"));
  assert.ok(html.includes("11월 10일(화) 22:30"), "watch 배지는 일정의 날짜·시각");
});

test("팬 차트: 전망이 없으면 빈 문자열, 있으면 svg", () => {
  assert.equal(renderFanChart({ ...facts.model.published[0], forecast: [] }), "");
  assert.match(renderFanChart(facts.model.published[0]), /^<svg class="wk-fan"/);
});

test("카드: 머리 줄 이름이 Weekly Outlook", () => {
  assert.match(weeklyCardSvg(content, facts), /Weekly Outlook/);
});

test("준법 검사: 권유 명령형을 잡는다", () => {
  assert.deepEqual(checkWeeklyCompliance(content), { hard: [], soft: [], etf: [] });
  const bad = { ...content, review: ["지금 반도체 비중을 늘리세요."] };
  assert.ok(checkWeeklyCompliance(bad).hard.length > 0);
});
