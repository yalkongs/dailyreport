// lib/weekly/types.ts — iM AI Economist 주간 전망(Weekly Outlook).
//
// 숫자는 econo 파이프라인(~/dev/econo, Python)이 facts로 확정해 넘기고, 이 저장소는 렌더만 한다.
// content(문장)는 Claude가 facts의 표시 문자열만 인용해 쓴 것이다.

export interface WeeklyContent {
  headline: string;
  subline: string;
  cardLine: string;
  summary: { lastWeek: string; thisWeek: string; outlook: string };
  review: string[];
  watch: { date: string; title: string; body: string }[];
  outlook: { inflation: string; scenario: string; usRate: string; limits: string };
  risks: { title: string; ifConfirmed: string; ifNot: string }[];
  closing: string;
}

export interface WeeklyMarketRow {
  key: string;
  name: string;
  kind: "pct" | "bp";
  change: number;
  close_display: string;
  change_display: string;
  close_date: string;
  direction: "up" | "down" | "flat";
}

export interface WeeklyMacroRow {
  key: string;
  name: string;
  period_label: string;
  value_display: string;
  prev_period_label: string;
  prev_display: string;
  change_display: string;
}

export interface WeeklyForecastRow {
  period: string;
  period_label: string;
  median_display: string;
  band68_display: string;
  band90_display: string;
  median: number;
  lower_68: number;
  upper_68: number;
  lower_90: number;
  upper_90: number;
}

export interface WeeklyPublishedTarget {
  key: string;
  name: string;
  unit: string;
  decimals: number;
  last_label: string;
  last_display: string;
  history: { period: string; value: number }[];
  forecast: WeeklyForecastRow[];
  backtest_error_reduction_display: string;
}

export interface WeeklyCalendarEvent {
  date: string;
  date_label: string;
  time: string;
  country: string;
  name: string;
  importance: number;
}

export interface WeeklyFacts {
  issue_date: string;
  issue_label: string;
  review_week: { start: string; end: string; label: string };
  outlook_week: { start: string; end: string; label: string };
  market: WeeklyMarketRow[];
  stripes: { date: string; pct: number }[];
  macro: WeeklyMacroRow[];
  model: {
    published: WeeklyPublishedTarget[];
    held_back: { key: string; name: string; reason?: string }[];
    scenario: { name: string; months: number; rows: { shock: string; target: string; period_label: string; effect_display: string }[] };
    us_rate_shock: { shock_display: string; rows: { key: string; name: string; horizon_months: number; median_display: string; band68_display: string }[]; held_back: { name: string; reason: string }[] };
  };
  calendar: WeeklyCalendarEvent[];
  provenance?: { collected_at?: string };
}

export interface WeeklyReportMeta {
  date: string;
  headline: string;
  subline: string;
  description: string;
  filePath: string;
  previewPath: string;
  generatedAt: string;
}

export interface WeeklyReportsIndex {
  reports: WeeklyReportMeta[];
  lastUpdated: string;
}
