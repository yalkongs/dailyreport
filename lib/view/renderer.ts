// lib/view/renderer.ts — Economist View 대외판 HTML·미리보기 카드.
//
// 한 호에 질문 하나: 제목(질문) → 답(lede) → 차트 → 본문(문장별 근거 각주) → 내 계약에서 확인할 것 → 다음 발표 → 근거표 → 고지.
// 숫자는 content 문장(검증 완료)과 evidence 행의 표시 문자열만 쓴다. 차트 좌표만 여기서 계산한다.

import * as fs from "fs";
import * as path from "path";
import { stripEmphasisTags } from "../html-entities";
import { escapeHtml } from "../etf/renderer";
import { sanitizeInlineHtml } from "../report-renderer";
import { renderTextCardSvg, saveCardPng } from "../preview/data-card";
import { CARD_HEIGHT, CARD_WIDTH } from "../preview/card-size";
import type { EvidenceRow, ViewContent, ViewFacts, ViewSentence, ViewStance } from "./types";

export const VIEW_PUBLIC_DIR = "economist-view";
const SITE = "https://dailyreport-eta.vercel.app";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 예금·금리 해설용 고지문 — 운영자 확정(2026-11-13 초안 문구, 2026-11-14 4번의 "책임편집자가 검토" 표현 삭제). 투자상품용 LEGAL_DISCLAIMER_ITEMS는 이 판본에 맞지 않는다.
export const VIEW_DISCLAIMER: readonly string[] = [
  "본 자료는 경제 통계에 대한 정보 제공을 목적으로 작성되었으며, 특정 금융상품의 가입이나 해지를 권유하기 위한 자료가 아닙니다.",
  "본 자료의 금리 통계는 한국은행 등 작성기관이 공표한 예금은행 전체의 가중평균 값으로, iM뱅크를 포함한 개별 은행·상품의 금리와 다를 수 있습니다.",
  "개별 상품의 금리, 만기 후 처리, 중도해지 조건 등은 해당 상품설명서와 약관을 확인하시기 바랍니다.",
  "본 자료는 공표 통계를 바탕으로 AI가 초안을 작성하였습니다. 오류가 확인되면 같은 주소에 정정 사유와 시각을 함께 게시합니다.",
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
.report-embed .ev-view { border: 1px solid #E5E7EB; border-radius: 14px; padding: 12px 14px; margin: 10px 0; }
.report-embed .ev-view-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.report-embed .ev-view-name { font-size: 14px; font-weight: 700; color: var(--text); }
.report-embed .ev-badge { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 7px; }
.report-embed .ev-badge.s-유지 { color: #374151; background: #F3F4F6; }
.report-embed .ev-badge.s-수정 { color: #B45309; background: #FEF3C7; }
.report-embed .ev-badge.s-신규 { color: #0B6E61; background: #E6F6F2; }
.report-embed .ev-view p { font-size: 14.5px; line-height: 1.7; margin: 2px 0; word-break: keep-all; }
.report-embed .ev-view .lbl { display: block; font-size: 12px; font-weight: 700; color: #6B7280; margin-top: 6px; }
.report-embed .ev-fc td, .report-embed .ev-fc th { font-size: 14px; padding: 6px 4px; border-bottom: 1px solid var(--border, #E5E7EB); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.report-embed .ev-fc th:first-child, .report-embed .ev-fc td:first-child { text-align: left; white-space: normal; word-break: keep-all; }
.report-embed .ev-fc { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
.report-embed .ev-fc .band { display: block; font-size: 12px; color: #6B7280; }
.report-embed .ev-list { list-style: none; margin: 0; padding: 0; }
.report-embed .ev-item { display: flex; gap: 8px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #EEF2F7; }
.report-embed .ev-item:last-child { border-bottom: 0; }
.report-embed .ev-n { flex: none; font-size: 12px; color: #6B7280; font-variant-numeric: tabular-nums; padding-top: 2px; }
.report-embed .ev-main { flex: 1 1 auto; min-width: 0; }
.report-embed .ev-what { font-size: 14px; line-height: 1.5; color: var(--text); word-break: keep-all; }
.report-embed .ev-when { display: block; font-size: 12.5px; color: #4B5563; }
.report-embed .ev-quote { font-size: 13px; line-height: 1.6; color: #374151; margin-top: 2px; word-break: keep-all; }
.report-embed .ev-src { font-size: 12px; color: #6B7280; margin-top: 2px; word-break: keep-all; overflow-wrap: anywhere; }
.report-embed .ev-val { flex: none; font-size: 15px; font-weight: 700; color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; padding-left: 6px; }
.report-embed .ev-agenda li { font-size: 14px; line-height: 1.7; list-style: none; word-break: keep-all; }
`;

function loadCSS(): string {
  const p = path.join(__dirname, "..", "report-template.css");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

function dateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 ${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}요일`;
}

export function allSentences(c: ViewContent): ViewSentence[] {
  return [...c.lede, ...(c.recap ?? []), ...c.body.flatMap((b) => b.sentences),
    ...(c.view ?? []).flatMap((v) => [v.stance, v.reason, v.trigger]), c.chartCaption, ...c.readerCheck, c.closing];
}

/**
 * 인용 순서대로 근거 번호(1부터). 각주는 관측 사실(fact) 문장에만 단다 — 해석·조건부 전망에 정의 발췌를 각주로 달면
 * 정의가 그 해석을 뒷받침하는 것처럼 보인다(검증기는 해석 문장의 논리를 확인하지 않는다). meta·next_release는 번호 없음.
 */
export function referenceNumbers(c: ViewContent, rows: EvidenceRow[]): Map<string, number> {
  const known = new Set(rows.map((r) => r.id));
  const nums = new Map<string, number>();
  const all = allSentences(c);
  for (const s of all) {
    if (s.type !== "fact") continue;
    for (const e of s.evidence) if (known.has(e) && !nums.has(e)) nums.set(e, nums.size + 1);
  }
  return nums;
}

function sentenceHtml(s: ViewSentence, refs: Map<string, number>): string {
  const marks = s.type !== "fact" ? [] : s.evidence.filter((e) => refs.has(e)).map((e) => refs.get(e)!);
  const uniq = Array.from(new Set(marks)).sort((a, b) => a - b);
  const sup = uniq.length ? `<a class="ev-ref" href="#evidence">[${uniq.join(",")}]</a>` : "";
  return `${sanitizeInlineHtml(s.text)}${sup}`;
}

/** 지시서 차트 계열을 나란히(2~3 패널), 모두 같은 눈금으로 그린다. */
export function renderTwinChart(f: ViewFacts): string {
  const panels = (f.chart_panels ?? []).filter((p) => p.points.length >= 2);
  if (panels.length === 0) return "";
  const W = 680, H = 230, padL = 40, padR = 12, gap = 20, top = 30, bottom = 30;
  const panelW = (W - padL - padR - gap * (panels.length - 1)) / panels.length;
  const vals = panels.flatMap((p) => p.points.map((x) => x.value));
  const lo = Math.floor(Math.min(...vals) * 2) / 2, hi = Math.ceil(Math.max(...vals) * 2) / 2;
  const y = (v: number) => top + ((H - top - bottom) * (hi - v)) / (hi - lo || 1);
  const f1 = (v: number) => v.toFixed(1);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += 0.5) ticks.push(Math.round(t * 10) / 10);
  const colors = ["#0B6E61", "#1D4ED8", "#B45309"];
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
  const label = panels.map((p) => p.title).join(", ");
  return `<svg class="ev-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(label)}(같은 눈금, ${escapeHtml(panels[0].unit)})">${yl}`
    + panels.map((p, i) => panel(p.points, padL + (panelW + gap) * i, p.title.replace("(전년동월비)", ""), colors[i % colors.length])).join("")
    + `</svg>`;
}

function evidenceTable(refs: Map<string, number>, rows: EvidenceRow[]): string {
  // 모바일 폭에서 열이 밀려 값이 안 보이지 않도록 표 대신 항목별 카드(번호·항목 / 값 / 출처·공표)로 쌓는다.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = Array.from(refs.entries()).map(([id, n]) => {
    const r = byId.get(id)!;
    const what = r.kind === "definition" ? `용어 정의: ${r.name}` : r.kind === "excerpt" ? `보도자료: ${r.name}` : r.name;
    const when = r.kind === "diff" ? [r.period_label, r.formula].filter(Boolean).join(" ") : (r.kind === "definition" || r.kind === "excerpt") ? "" : (r.period_label ?? "");
    const val = r.value_display ?? (r.text ? `“${r.text.length > 80 ? r.text.slice(0, 80) + "…" : r.text}”` : "");
    const src = r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.source)}</a>` : escapeHtml(r.source);
    const pub = r.published && r.published !== "이전 공표" ? ` · 공표 ${escapeHtml(r.published)}` : "";
    const quote = !r.value_display && r.text;
    return `<li class="ev-item"><span class="ev-n">[${n}]</span><div class="ev-main">
                <div class="ev-what">${escapeHtml(what)}${when ? `<span class="ev-when">${escapeHtml(when)}</span>` : ""}</div>
                ${quote ? `<div class="ev-quote">${escapeHtml(val)}</div>` : ""}
                <div class="ev-src">${src}${pub}</div>
            </div>${quote ? "" : `<span class="ev-val">${escapeHtml(val)}</span>`}</li>`;
  }).join("");
  return `
    <details class="more" id="evidence" data-section="evidence">
        <summary class="more-summary">근거표</summary>
        <div class="more-body">
        <ol class="ev-list">${items}</ol>
        </div>
    </details>`;
}

function renderView(view: ViewStance[], f: ViewFacts, refs: Map<string, number>): string {
  if (view.length === 0) return "";
  const names = f.view_keys ?? { kr_policy: "한국은행 기준금리", inflation: "물가", growth: "경기", markets: "시장금리·환율" };
  const order = ["kr_policy", "inflation", "growth", "markets"];
  const cards = [...view].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).map((v) => `
        <div class="ev-view">
            <div class="ev-view-head"><span class="ev-view-name">${escapeHtml(names[v.key] ?? v.key)}</span><span class="ev-badge s-${escapeHtml(v.status)}">${escapeHtml(v.status)}</span></div>
            <p>${sentenceHtml(v.stance, refs)}</p>
            <p><span class="lbl">근거</span>${sentenceHtml(v.reason, refs)}</p>
            <p><span class="lbl">판단을 바꿀 조건</span>${sentenceHtml(v.trigger, refs)}</p>
        </div>`).join("");
  return `<section class="section" data-section="view">
        <h2 class="section-title">이코노미스트의 판단</h2>${cards}
    </section>`;
}

export function renderForecast(f: ViewFacts): string {
  const fc = f.forecast;
  if (!fc || fc.items.length === 0) return "";
  const n = Math.max(...fc.items.map((i) => i.points.length));
  const heads = fc.items[0].points.map((pt) => `<th>${escapeHtml(pt.period_label)}</th>`).join("");
  const rows = fc.items.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.last.value_display)}<span class="band">${escapeHtml(i.last.period_label)} 실적</span></td>${
    i.points.map((pt) => `<td>${escapeHtml(pt.value_display)}<span class="band">(${escapeHtml(pt.band_display)})</span></td>`).join("")
  }${"<td></td>".repeat(n - i.points.length)}</tr>`).join("");
  return `<section class="section" data-section="forecast">
        <h2 class="section-title">${escapeHtml(fc.title)}</h2>
        <table class="ev-fc"><thead><tr><th>지표</th><th>최근</th>${heads}</tr></thead><tbody>${rows}</tbody></table>
        <p class="wk-note">${escapeHtml(fc.note)}</p>
    </section>`;
}

function renderAgenda(f: ViewFacts): string {
  const items = f.agenda ?? [];
  if (items.length === 0) return "";
  const li = items.map((a) => `<li><strong>${escapeHtml(a.label)}</strong> · ${escapeHtml(a.title)} <span class="wk-sub">(${escapeHtml(a.source)})</span></li>`).join("");
  return `<section class="section" data-section="agenda">
        <h2 class="section-title">이번 주 일정</h2>
        <ul class="ev-agenda">${li}</ul>
    </section>`;
}

export function renderViewReport(c: ViewContent, f: ViewFacts): string {
  const refs = referenceNumbers(c, f.evidence.rows);
  const title = escapeHtml(stripEmphasisTags(c.title));
  const desc = escapeHtml(stripEmphasisTags(c.lede.map((s) => s.text).join(" "))).slice(0, 180);
  const img = `${SITE}/${VIEW_PUBLIC_DIR}/${f.issue_date}-preview.png`;
  const p = (ss: ViewSentence[]) => ss.map((s) => sentenceHtml(s, refs)).join(" ");
  const nrs = Object.values(f.evidence.parts ?? {}).map((p) => p.next_release).filter((x): x is NonNullable<typeof x> => !!x);
  const legal = VIEW_DISCLAIMER.map((i) => `<li>${escapeHtml(i)}</li>`).join("\n            ");
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
    ${(c.recap ?? []).length ? `<section class="section" data-section="recap">
        <h2 class="section-title">지난주 무엇이 있었나</h2>
        <p class="ev-p">${p(c.recap ?? [])}</p>
    </section>` : ""}
    <section class="section" data-section="chart">
        ${renderTwinChart(f)}
        <p class="ev-caption">${sentenceHtml(c.chartCaption, refs)}</p>
    </section>
    <section class="section" data-section="body">
        ${c.body.map((b) => `<p class="ev-p">${p(b.sentences)}</p>`).join("\n        ")}
    </section>
    ${renderView(c.view ?? [], f, refs)}
    ${renderForecast(f)}
    ${renderAgenda(f)}
    <section class="ev-check" data-section="reader-check">
        <div class="ev-check-title">내 계약에서 확인할 것</div>
        <p class="ev-p" style="margin:0">${p(c.readerCheck)}</p>
    </section>
    <section data-section="next">
        <p class="ev-next">${sentenceHtml(c.closing, refs)}</p>
        ${nrs.map((nr) => `<p class="wk-note">다음 발표: ${escapeHtml(nr.title)} · ${escapeHtml(nr.label)} (${escapeHtml(nr.source)})</p>`).join("\n        ")}
    </section>
    ${evidenceTable(refs, f.evidence.rows)}
    <footer class="report-footer" data-section="footer">
        <div class="copyright">© iM뱅크 | Economist View | 자료: ${escapeHtml(f.sources_line ?? "한국은행 ECOS")} | 자료 기준 ${escapeHtml(f.evidence.cutoff.slice(0, 16).replace("T", " "))}</div>
        <div class="legal-notice">
            <div class="legal-title">유의사항</div>
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
  return renderTextCardSvg({
    date: f.issue_date, headline: stripEmphasisTags(c.title), line: stripEmphasisTags(c.cardLine), stats: f.card_stats,
    brandName: "Economist View", kicker: "iM뱅크 경제 리포트",
  });
}

export async function saveViewPreview(c: ViewContent, f: ViewFacts, outPath: string): Promise<string> {
  return saveCardPng(viewCardSvg(c, f), outPath);
}
