// lib/view/types.ts — Economist View(은행 경제 리포트) 대외판.
// 문장은 {text, type, evidence}로 오고, 숫자는 evidence 행(econo 근거표)에서만 나온다.

export type SentenceType = "fact" | "interpretation" | "conditional";

export interface ViewSentence {
  text: string;
  type: SentenceType;
  evidence: string[];
}

export interface ViewContent {
  title: string;
  cardLine: string;
  lede: ViewSentence[];
  body: { sentences: ViewSentence[] }[];
  chartCaption: ViewSentence;
  readerCheck: ViewSentence[];
  closing: ViewSentence;
}

export interface EvidenceRow {
  id: string;
  kind: "level" | "diff" | "excerpt" | "definition";
  source: string;
  name: string;
  scope?: string;
  series?: string;
  period?: string;
  period_label?: string;
  value?: number;
  unit?: string;
  value_display?: string;
  published?: string;
  text?: string;
  url?: string;
  codes?: string;
  formula?: string;
  inputs?: string[];
}

export interface ViewFacts {
  issue_date: string;
  evidence: {
    cutoff: string;
    latest_period: string;
    latest_label: string;
    rows: EvidenceRow[];
    next_release: { title: string; date: string; time: string; label: string; source: string } | null;
    chart: Record<string, { period: string; value: number }[]>;
  };
  card_stats: { label: string; value: string; caption: string; tone: "up" | "down" | "flat" | "neutral" }[];
  cited: string[];
}

export interface ViewReportMeta {
  date: string;
  headline: string;
  description: string;
  filePath: string;
  previewPath: string;
  generatedAt: string;
}

export interface ViewReportsIndex {
  reports: ViewReportMeta[];
  lastUpdated: string;
}
