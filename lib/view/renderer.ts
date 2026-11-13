// lib/view/renderer.ts — Economist View 대외판 HTML·미리보기 카드.
//
// 한 호에 질문 하나: 제목(질문) → 답(lede) → 차트 → 본문(문장별 근거 각주) → 내 계약에서 확인할 것 → 다음 발표 → 근거표 → 고지.
// 숫자는 content 문장(검증 완료)과 evidence 행의 표시 문자열만 쓴다. 차트 좌표만 여기서 계산한다.

import * as fs from "fs";
import * as path from "path";
import { stripEmphasisTags } from "../html-entities";
import { escapeHtml } from "../etf/renderer";
import { sanitizeInlineHtml } from "../report-renderer";
import { renderWeeklyCardSvg, saveCardPng } from "../preview/data-card";
import { CARD_HEIGHT, CARD_WIDTH } from "../preview/card-size";
import type { EvidenceRow, ViewContent, ViewFacts, ViewSentence } from "./types";

export const VIEW_PUBLIC_DIR = "economist-view";
const SITE = "https://dailyreport-eta.vercel.app";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 예금·금리 해설용 고지문 — 초안(책임편집자·준법 확정 전). 투자상품용 LEGAL_DISCLAIMER_ITEMS는 이 판본에 맞지 않는다.
export const VIEW_DISCLAIMER_DRAFT: readonly string[] = [
  "본 자료는 경제 통계에 대한 정보 제공을 목적으로 작성되었으며, 특정 금융상품의 가입이나 해지를 권유하기 위한 자료가 아닙니다.",
  "본 자료의 금리 통계는 한국은행 등 작성기관이 공표한 예금은행 전체의 가중평균 값으로, iM뱅크를 포함한 개별 은행·상품의 금리와 다를 수 있습니다.",
  "개별 상품의 금리, 만기 후 처리, 중도해지 조건 등은 해당 상품설명서와 약관을 확인하시기 바랍니다.",
  "본 자료는 공표 통계를 바탕으로 AI가 초안을 작성하고 책임편집자가 검토하였습니다. 오류가 확인되면 같은 주소에 정정 사유와 시각을 함께 게시합니다.",
];

const VIEW_CSS = `
.report-embed .ev-lede { font-size: 17px; line-height: 1.75; color: var(--text); margin: 4px 0 18px; word-break: keep-all; }
.report-embed .ev-lede p + p { margin-top: 8px; }
.report-embed .ev-p { font-size: 15.5px; line-height: 1.8; margin: 0 0 14px; word-break: keep-all; }
.report-embed .ev-ref { font-size: 11px; vertical-align: super; margin-left: 2px; color: #0B6E61; text-decoration: none; font-weight: 700; }
.report-embed .ev-chart { display: block; width: 100%; height: auto; margin: 8px 0 4px; }
.report-embed .ev-caption { font-size: 13px; line-height: 1.6; color: #4B5563; margin-bottom: 4px; word-break: keep-all; }
.report-embed .ev-check { background: #F0FAF7; border: 1px solid #CDEDE4; border-radius: 14px; padding: 14px 16px; margin: 18px 0; }
.report-embed .ev-check-title { font-size: 13px; font-weight: 700; color: #0B6E61; margin-bottom: 6px; }
.report-embed .ev-next { font-size: 14px; line-height: 1.6; margin: 10px 0 0; color: var(--text); }
.report-embed .ev-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.report-embed .ev-table th, .report-embed .ev-table td { border-bottom: 1px solid #EEF2F7; padding: 6px 4px; text-align: left; vertical-align: top; word-break: keep-all; }
.report-embed .ev-table td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.report-embed .ev-draft { display: inline-block; font-size: 11px; font-weight: 700; color: #B45309; border: 1px solid #F5C99A; border-radius: 6px; padding: 0 6px; margin-left: 6px; }
`;

function loadCSS(): string {
  const p = path.join(__dirname, "..", "report-template.css");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function dateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 ${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`;
}

/** 인용 순서대로 근거 번호(1부터). 수치·발췌 행만 번호를 단다(meta·next_release 제외). */
export function referenceNumbers(c: ViewContent, rows: EvidenceRow[]): Map<string, number> {
  const known = new Set(rows.map((r) => r.id));
  const nums = new Map<string, number>();
  const all = [...c.lede, ...c.body.flatMap((b) => b.sentences), c.chartCaption, ...c.readerCheck, c.closing];
  for (const s of all) for (const e of s.evidence) if (known.has(e) && !nums.has(e)) nums.set(e, nums.size + 1);
  return nums;
}

function sentenceHtml(s: ViewSentence, refs: Map<string, number>): string {
  const marks = s.evidence.filter((e) => refs.has(e)).map((e) => refs.get(e)!);
  const uniq = Array.from(new Set(marks)).sort((a, b) => a - b);
  const sup = uniq.length ? `<a class="ev-ref" href="#evidence">[${uniq.join(",")}]</a>` : "";
  return `${sanitizeInlineHtml(s.text)}${sup}`;
}

/** 두 패널, 같은 눈금: 신규취급액 기준 저축성수신금리 / 잔액 기준 총수신금리. */
export function renderTwinChart(f: ViewFacts): string {
  const a = f.evidence.chart["dep_new"] ?? [];
  const b = f.evidence.chart["dep_bal"] ?? [];
  if (a.length < 2 || b.length < 2) return "";
  const W = 680, H = 230, padL = 40, padR = 12, gap = 24, top = 30, bottom = 30;
  const panelW = (W - padL - padR - gap) / 2;
  const vals = [...a, ...b].map((p) => p.value);
  const lo = Math.floor(Math.min(...vals) * 2) / 2, hi = Math.ceil(Math.max(...vals) * 2) / 2;
  const y = (v: number) => top + ((H - top - bottom) * (hi - v)) / (hi - lo || 1);
  const f1 = (v: number) => v.toFixed(1);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += 0.5) ticks.push(Math.round(t * 10) / 10);
  const panel = (pts: { period: string; value: number }[], x0: number, title: string, color: string) => {
    const x = (i: number) => x0 + (panelW * i) / (pts.length - 1);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${f1(x(i))},${f1(y(p.value))}`).join(" ");
    const last = pts[pts.length - 1];
    const grid = ticks.map((t) => `<line x1="${f1(x0)}" x2="${f1(x0 + panelW)}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="#EEF2F7"/>`).join("");
    const xl = [0, pts.length - 1].map((i) => `<text x="${f1(x(i))}" y="${H - 10}" text-anchor="${i ? "end" : "start"}" font-size="11" fill="#6B7280">${escapeHtml(pts[i].period.slice(2).replace("-", "."))}</text>`).join("");
    return `${grid}<text x="${f1(x0)}" y="16" font-size="12" font-weight="700" fill="#111827">${escapeHtml(title)}</text>`
      + `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"/>`
      + `<circle cx="${f1(x(pts.length - 1))}" cy="${f1(y(last.value))}" r="3.5" fill="${color}"/>${xl}`;
  };
  const yl = ticks.map((t) => `<text x="${padL - 6}" y="${f1(y(t) + 4)}" text-anchor="end" font-size="11" fill="#9CA3AF">${t.toFixed(1)}</text>`).join("");
  return `<svg class="ev-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="신규취급액 기준 저축성수신금리와 잔액 기준 총수신금리(같은 눈금, 연 %)">${yl}`
    + panel(a, padL, "신규취급액 기준 저축성수신금리", "#0B6E61")
    + panel(b, padL + panelW + gap, "잔액 기준 총수신금리", "#1D4ED8") + `</svg>`;
}

function evidenceTable(refs: Map<string, number>, rows: EvidenceRow[]): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const tr = Array.from(refs.entries()).map(([id, n]) => {
    const r = byId.get(id)!;
    const what = r.kind === "definition" ? `용어 정의: ${r.name}` : r.kind === "excerpt" ? `보도자료: ${r.name}` : `${r.name}${r.period_label ? ` · ${r.period_label}` : ""}`;
    const val = r.value_display ?? (r.text ? `“${r.text.length > 80 ? r.text.slice(0, 80) + "…" : r.text}”` : "");
    const extra = r.kind === "diff" ? ` <span class="wk-sub">(${escapeHtml(r.formula ?? "")})</span>` : "";
    const src = r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.source)}</a>` : escapeHtml(r.source);
    return `<tr><td>[${n}]</td><td>${escapeHtml(what)}${extra}</td><td class="num">${escapeHtml(val)}</td><td>${src}${r.published && r.published !== "이전 공표" ? `<div class="wk-sub">공표 ${escapeHtml(r.published)}</div>` : ""}</td></tr>`;
  }).join("");
  return `
    <details class="more" id="evidence" data-section="evidence">
        <summary class="more-summary">근거표</summary>
        <div class="more-body">
        <table class="ev-table"><thead><tr><th>#</th><th>항목</th><th style="text-align:right">값</th><th>출처</th></tr></thead><tbody>${tr}</tbody></table>
        </div>
    </details>`;
}

export function renderViewReport(c: ViewContent, f: ViewFacts): string {
  const refs = referenceNumbers(c, f.evidence.rows);
  const title = escapeHtml(stripEmphasisTags(c.title));
  const desc = escapeHtml(stripEmphasisTags(c.lede.map((s) => s.text).join(" "))).slice(0, 180);
  const img = `${SITE}/${VIEW_PUBLIC_DIR}/${f.issue_date}-preview.png`;
  const p = (ss: ViewSentence[]) => ss.map((s) => sentenceHtml(s, refs)).join(" ");
  const nr = f.evidence.next_release;
  const legal = VIEW_DISCLAIMER_DRAFT.map((i) => `<li>${escapeHtml(i)}</li>`).join("\n            ");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - iM뱅크 Economist View</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:site_name" content="iM뱅크">
<meta property="og:type" content="article">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="${CARD_WIDTH}">
<meta property="og:image:height" content="${CARD_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<style>
${loadCSS()}
${VIEW_CSS}
</style>
</head>
<body>
<div class="report-embed">
<div class="report-container">
    <header class="masthead" data-section="masthead">
        <div class="mast-top">
            <div class="mast-brand">
                <svg class="mast-logo" role="img" aria-label="iM뱅크" viewBox="65 231 871 564" width="52.5" height="34"><image href="/im-bank-logo.png" width="1000" height="1000"/></svg>
                <span class="mast-sep" aria-hidden="true"></span>
                <span class="mast-titles"><span class="mast-label">iM뱅크 경제 리포트</span><span class="mast-name">Economist View</span></span>
            </div>
            <div class="mast-date">${escapeHtml(dateLong(f.issue_date))}</div>
        </div>
    </header>
    <section class="title-block" data-section="title">
        <h1 class="cover-headline">${title}</h1>
    </section>
    <section class="ev-lede" data-section="lede"><p>${p(c.lede)}</p></section>
    <section class="section" data-section="chart">
        ${renderTwinChart(f)}
        <p class="ev-caption">${sentenceHtml(c.chartCaption, refs)}</p>
    </section>
    <section class="section" data-section="body">
        ${c.body.map((b) => `<p class="ev-p">${p(b.sentences)}</p>`).join("\n        ")}
    </section>
    <section class="ev-check" data-section="reader-check">
        <div class="ev-check-title">내 계약에서 확인할 것</div>
        <p class="ev-p" style="margin:0">${p(c.readerCheck)}</p>
    </section>
    <section data-section="next">
        <p class="ev-next">${sentenceHtml(c.closing, refs)}</p>
        ${nr ? `<p class="wk-note">다음 발표: ${escapeHtml(nr.title)} · ${escapeHtml(nr.label)} (${escapeHtml(nr.source)})</p>` : ""}
    </section>
    ${evidenceTable(refs, f.evidence.rows)}
    <footer class="report-footer" data-section="footer">
        <div class="copyright">© iM뱅크 | Economist View | 자료: 한국은행 ECOS·보도자료·통계 공표 일정 | 발행 기준 ${escapeHtml(f.evidence.cutoff.slice(0, 16).replace("T", " "))}</div>
        <div class="legal-notice" data-draft="true">
            <div class="legal-title">유의사항<span class="ev-draft">초안</span></div>
            <ul class="legal-list">
            ${legal}
            </ul>
        </div>
    </footer>
</div>
</div>
</body>
</html>`;
}

export function viewCardSvg(c: ViewContent, f: ViewFacts): string {
  return renderWeeklyCardSvg({
    date: f.issue_date, headline: stripEmphasisTags(c.title), line: stripEmphasisTags(c.cardLine), stats: f.card_stats,
    brandName: "Economist View", kicker: "iM뱅크 경제 리포트",
  });
}

export async function saveViewPreview(c: ViewContent, f: ViewFacts, outPath: string): Promise<string> {
  return saveCardPng(viewCardSvg(c, f), outPath);
}
