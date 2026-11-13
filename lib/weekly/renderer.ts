// lib/weekly/renderer.ts — iM AI Economist 주간 전망 HTML·미리보기 카드.
//
// Daily Market(lib/report-renderer.ts)과 같은 CSS·법적 고지·스트라이프·카드를 쓴다.
// 숫자는 facts의 표시 문자열만 그린다(여기서 계산해 새 숫자를 만들지 않는다 — 차트 좌표 제외).

import * as fs from "fs";
import * as path from "path";
import { stripEmphasisTags } from "../html-entities";
import { LEGAL_DISCLAIMER_ITEMS, LEGAL_DISCLAIMER_TITLE } from "../legal-disclaimer";
import { renderWeeklyCardSvg, saveCardPng } from "../preview/data-card";
import { CARD_HEIGHT, CARD_WIDTH } from "../preview/card-size";
import { escapeHtml } from "../etf/renderer";
import { sanitizeInlineHtml } from "../report-renderer";
import type { WeeklyContent, WeeklyFacts, WeeklyPublishedTarget } from "./types";

export const WEEKLY_PUBLIC_DIR = "weekly-reports";
const SITE = "https://dailyreport-eta.vercel.app";
const DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function loadCSS(): string {
  const p = path.join(__dirname, "..", "report-template.css");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

const WEEKLY_CSS = `
.report-embed .wk-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 4px; }
.report-embed .wk-table th { text-align: left; font-weight: 600; color: var(--slate); font-size: 12px; padding: 6px 4px; border-bottom: 1px solid var(--border, #E5E7EB); }
.report-embed .wk-table td { padding: 8px 4px; border-bottom: 1px solid #F1F5F9; vertical-align: top; word-break: keep-all; }
.report-embed .wk-table td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.report-embed .wk-sub { font-size: 12px; color: #6B7280; }
.report-embed .wk-fan { display: block; width: 100%; height: auto; margin: 12px 0 4px; }
.report-embed .wk-note { font-size: 13px; line-height: 1.6; color: #6B7280; margin-top: 10px; word-break: keep-all; }
.report-embed .wk-h3 { font-size: 15px; font-weight: 700; margin: 22px 0 8px; color: var(--text); }
.report-embed .wk-risk-row { font-size: 14px; line-height: 1.6; margin-top: 6px; word-break: keep-all; }
.report-embed .wk-risk-label { display: inline-block; font-size: 12px; font-weight: 700; color: #0B6E61; margin-right: 6px; }
`;

function dateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 ${wd}요일`;
}

function heatLevel(abs: number): number {
  if (abs >= 5) return 5;
  if (abs >= 3) return 4;
  if (abs >= 1.5) return 3;
  if (abs >= 0.5) return 2;
  if (abs >= 0.1) return 1;
  return 0;
}

// ── 섹션 ──────────────────────────────────────────────────────────────────
function renderHead(c: WeeklyContent, f: WeeklyFacts, css: string): string {
  const headline = escapeHtml(stripEmphasisTags(c.headline));
  const desc = escapeHtml(stripEmphasisTags(`${c.summary.lastWeek} ${c.summary.thisWeek}`)).slice(0, 180);
  const img = `${SITE}/${WEEKLY_PUBLIC_DIR}/${f.issue_date}-preview.png`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headline} - iM AI Economist Weekly</title>
<meta property="og:title" content="${headline}">
<meta property="og:description" content="${desc}">
<meta property="og:site_name" content="iM뱅크">
<meta property="og:type" content="article">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="${CARD_WIDTH}">
<meta property="og:image:height" content="${CARD_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<style>
${css}
${WEEKLY_CSS}
</style>
</head>`;
}

/** 머리글 — 일간 리포트의 스트라이프 없이 로고·이름·날짜만(주간은 글자 중심). */
function renderMasthead(f: WeeklyFacts): string {
  return `<body>
<div class="report-embed">
<div class="report-container">
    <header class="masthead" data-section="masthead">
        <div class="mast-top">
            <div class="mast-brand">
                <svg class="mast-logo" role="img" aria-label="iM뱅크" viewBox="65 231 871 564" width="52.5" height="34"><image href="/im-bank-logo.png" width="1000" height="1000"/></svg>
                <span class="mast-sep" aria-hidden="true"></span>
                <span class="mast-titles"><span class="mast-label">iM AI Economist</span><span class="mast-name">Weekly Outlook</span></span>
            </div>
            <div class="mast-date">${escapeHtml(dateLong(f.issue_date))}</div>
        </div>
    </header>`;
}

function renderTitle(c: WeeklyContent): string {
  return `
    <section class="title-block" data-section="title">
        <h1 class="cover-headline">${escapeHtml(stripEmphasisTags(c.headline))}</h1>
        <p class="cover-subline">${escapeHtml(stripEmphasisTags(c.subline))}</p>
    </section>`;
}

function renderSummary(c: WeeklyContent): string {
  const rows = [
    ["지난주", c.summary.lastWeek],
    ["이번 주", c.summary.thisWeek],
    ["전망", c.summary.outlook],
  ].filter(([, t]) => t.trim());
  return `
    <section class="summary-box" data-section="summary" aria-label="세 줄 요약">
        <ul class="summary-list">${rows.map(([l, t]) => `
            <li class="summary-row"><span class="summary-label">${l}</span><span class="summary-text">${sanitizeInlineHtml(t)}</span></li>`).join("")}
        </ul>
    </section>`;
}

function renderMarket(c: WeeklyContent, f: WeeklyFacts): string {
  const cards = f.market.map((r) => {
    const heatBase = r.kind === "bp" ? Math.abs(r.change) / 10 : Math.abs(r.change);
    const lvl = heatLevel(heatBase);
    const heat = lvl > 0 && r.direction !== "flat" ? ` heat-${r.direction}-${lvl}` : "";
    return `
                <div class="pulse-card${heat}">
                    <div class="label">${escapeHtml(r.name)}</div>
                    <div class="value">${escapeHtml(r.close_display)}</div>
                    <div class="change ${r.direction}">${escapeHtml(r.change_display)}</div>
                </div>`;
  }).join("");
  const paras = c.review.map((p) => `\n                <p>${sanitizeInlineHtml(p)}</p>`).join("");
  return `
    <section class="section" data-section="last-week">
        <h2 class="section-title">지난주 시장 (${escapeHtml(f.review_week.label)})</h2>
        <div class="key-grid">${cards}
        </div>
        <p class="wk-note">종가 기준, 직전 주 마지막 거래일 대비. 금리는 bp(0.01%p) 단위 변화입니다.</p>
        <div class="narrative">${paras}
        </div>
    </section>`;
}

function renderMacro(f: WeeklyFacts): string {
  const rows = f.macro.map((m) => `
                <tr><td>${escapeHtml(m.name)}<div class="wk-sub">${escapeHtml(m.period_label)}</div></td>
                    <td class="num"><strong>${escapeHtml(m.value_display)}</strong></td>
                    <td class="num">${escapeHtml(m.prev_display)}<div class="wk-sub">${escapeHtml(m.prev_period_label)}</div></td></tr>`).join("");
  return `
    <section class="section" data-section="macro">
        <h2 class="section-title">최근 경제지표</h2>
        <table class="wk-table">
            <thead><tr><th>지표</th><th style="text-align:right">최근</th><th style="text-align:right">직전</th></tr></thead>
            <tbody>${rows}
            </tbody>
        </table>
    </section>`;
}

function renderWatch(c: WeeklyContent, f: WeeklyFacts): string {
  const cards = c.watch.slice(0, 4).map((w) => {
    const ev = f.calendar.find((e) => e.date === w.date);
    const badge = ev ? `${ev.date_label}${ev.time ? " " + ev.time : ""}` : w.date;
    return `
            <div class="watch-card">
                <div class="watch-badge">${escapeHtml(badge)}</div>
                <div class="watch-title">${escapeHtml(stripEmphasisTags(w.title))}</div>
                <div class="watch-desc">${sanitizeInlineHtml(w.body)}</div>
            </div>`;
  }).join("");
  const calRows = f.calendar.map((e) => `
                <tr><td>${escapeHtml(e.date_label)}${e.time ? `<div class="wk-sub">${escapeHtml(e.time)}</div>` : ""}</td><td>${escapeHtml(e.country)}</td><td>${escapeHtml(e.name)}</td></tr>`).join("");
  const cal = f.calendar.length === 0 ? "" : `
    <details class="more" data-section="calendar">
        <summary class="more-summary">이번 주 전체 일정</summary>
        <div class="more-body">
        <table class="wk-table">
            <thead><tr><th>날짜(한국시간)</th><th>국가</th><th>일정</th></tr></thead>
            <tbody>${calRows}
            </tbody>
        </table>
        </div>
    </details>`;
  return `
    <section class="section" data-section="this-week">
        <h2 class="section-title">이번 주 볼 것 (${escapeHtml(f.outlook_week.label)})</h2>${cards}
    </section>${cal}`;
}

/** 팬 차트: 최근 12개월 실적 + 모형 전망 중앙값·68%·90% 구간. 좌표 계산만 하고 숫자 라벨은 facts 문자열을 쓴다. */
export function renderFanChart(t: WeeklyPublishedTarget): string {
  const W = 680, H = 250, L = 44, R = 16, T = 16, B = 34;
  const hist = t.history.slice(-12);
  const fc = t.forecast;
  const n = hist.length + fc.length;
  if (hist.length === 0 || fc.length === 0) return "";
  const vals = [...hist.map((h) => h.value), ...fc.flatMap((r) => [r.lower_90, r.upper_90])];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 0.5;
  lo -= pad; hi += pad;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1);
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const f1 = (v: number) => v.toFixed(1);
  const last = hist.length - 1;
  const band = (loK: "lower_68" | "lower_90", hiK: "upper_68" | "upper_90") => {
    const up = fc.map((r, i) => `${f1(x(last + 1 + i))},${f1(y(r[hiK]))}`);
    const dn = fc.map((r, i) => `${f1(x(last + 1 + i))},${f1(y(r[loK]))}`).reverse();
    const anchor = `${f1(x(last))},${f1(y(hist[last].value))}`;
    return `${anchor} ${up.join(" ")} ${dn.join(" ")}`;
  };
  const histPath = hist.map((h, i) => `${i ? "L" : "M"}${f1(x(i))},${f1(y(h.value))}`).join(" ");
  const medPath = `M${f1(x(last))},${f1(y(hist[last].value))} ` + fc.map((r, i) => `L${f1(x(last + 1 + i))},${f1(y(r.median))}`).join(" ");
  // y 눈금 4개(좌표용 값, 라벨은 소수 1자리)
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="#EEF2F7"/><text x="${L - 6}" y="${f1(y(v) + 4)}" text-anchor="end" font-size="11" fill="#9CA3AF">${v.toFixed(1)}</text>`).join("");
  const periods = [...hist.map((h) => h.period), ...fc.map((r) => r.period)];
  const xlabels = periods.map((p, i) => (i % 3 === 0 || i === n - 1) ? `<text x="${f1(x(i))}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#6B7280">${escapeHtml(p.slice(2).replace("-", "."))}</text>` : "").join("");
  return `<svg class="wk-fan" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(t.name)} 실적과 모형 전망(중앙값, 68%·90% 구간)">
${grid}
<polygon points="${band("lower_90", "upper_90")}" fill="#00BFA5" fill-opacity="0.12"/>
<polygon points="${band("lower_68", "upper_68")}" fill="#00BFA5" fill-opacity="0.25"/>
<path d="${histPath}" fill="none" stroke="#111827" stroke-width="2.2"/>
<path d="${medPath}" fill="none" stroke="#0B6E61" stroke-width="2.2" stroke-dasharray="6 4"/>
<line x1="${f1(x(last))}" x2="${f1(x(last))}" y1="${T}" y2="${H - B}" stroke="#D1D5DB" stroke-dasharray="2 3"/>
${xlabels}
</svg>`;
}

function renderOutlook(c: WeeklyContent, f: WeeklyFacts): string {
  const m = f.model;
  const blocks: string[] = [];
  for (const t of m.published) {
    const rows = t.forecast.map((r) => `
                <tr><td>${escapeHtml(r.period_label)}</td><td class="num"><strong>${escapeHtml(r.median_display)}</strong></td><td class="num">${escapeHtml(r.band68_display)}</td><td class="num">${escapeHtml(r.band90_display)}</td></tr>`).join("");
    blocks.push(`
        <h3 class="wk-h3">${escapeHtml(t.name)}</h3>
        ${renderFanChart(t)}
        <p class="wk-note">검은 선: 실적(최근 ${escapeHtml(t.last_label)} ${escapeHtml(t.last_display)}) · 초록 점선: 모형 전망 중앙값 · 음영: 68%·90% 구간</p>
        <table class="wk-table">
            <thead><tr><th>시점</th><th style="text-align:right">중앙값</th><th style="text-align:right">68% 구간</th><th style="text-align:right">90% 구간</th></tr></thead>
            <tbody>${rows}
            </tbody>
        </table>`);
  }
  const narrative = (text: string) => text.trim() ? `\n            <p>${sanitizeInlineHtml(text)}</p>` : "";
  const scen = m.scenario.rows.length === 0 ? "" : `
        <h3 class="wk-h3">시나리오: ${escapeHtml(m.scenario.name)}</h3>
        <div class="narrative">${narrative(c.outlook.scenario)}</div>`;
  const shockRows = m.us_rate_shock.rows.map((r) => `
                <tr><td>${escapeHtml(r.name)}<div class="wk-sub">${r.horizon_months}개월 뒤</div></td><td class="num"><strong>${escapeHtml(r.median_display)}</strong></td><td class="num">${escapeHtml(r.band68_display)}</td></tr>`).join("");
  const shock = m.us_rate_shock.rows.length === 0 ? "" : `
        <h3 class="wk-h3">${escapeHtml(m.us_rate_shock.shock_display)}의 과거 평균적 파급</h3>
        <div class="narrative">${narrative(c.outlook.usRate)}</div>
        <table class="wk-table">
            <thead><tr><th>변수</th><th style="text-align:right">중앙값</th><th style="text-align:right">68% 구간</th></tr></thead>
            <tbody>${shockRows}
            </tbody>
        </table>`;
  return `
    <section class="section" data-section="outlook">
        <h2 class="section-title">AI Economist 전망</h2>
        <div class="narrative">${narrative(c.outlook.inflation)}</div>${blocks.join("")}${scen}${shock}
        <p class="wk-note">${sanitizeInlineHtml(c.outlook.limits)}</p>
    </section>`;
}

function renderRisks(c: WeeklyContent): string {
  const cards = c.risks.slice(0, 3).map((r) => `
            <div class="sowhat-card">
                <div class="sowhat-title">${escapeHtml(stripEmphasisTags(r.title))}</div>
                <p class="wk-risk-row"><span class="wk-risk-label">확인되면</span>${sanitizeInlineHtml(r.ifConfirmed)}</p>
                <p class="wk-risk-row"><span class="wk-risk-label">어긋나면</span>${sanitizeInlineHtml(r.ifNot)}</p>
            </div>`).join("");
  return `
    <section class="section" data-section="risks">
        <h2 class="section-title">이번 주 리스크 점검</h2>${cards}
    </section>`;
}

function renderMethod(f: WeeklyFacts): string {
  const at = f.provenance?.collected_at ? ` 데이터는 ${escapeHtml(f.provenance.collected_at.slice(0, 16).replace("T", " "))}(UTC)에 수집했습니다.` : "";
  return `
    <section class="data-basis" data-section="method">
        <p class="source-note"><strong>작성 방법</strong> 시장 수치는 각 시장의 종가, 경제지표는 공식 발표값입니다. 전망은 2004년 이후 국내외 월간 지표로 추정한 베이지안 벡터자기회귀(BVAR) 모형의 결과이며, 과거 검증에서 단순 예측보다 정확했던 지표만 싣습니다. 문장은 AI가 이 수치들만 인용해 작성했습니다.${at}</p>
    </section>`;
}

function renderFooter(c: WeeklyContent): string {
  const items = LEGAL_DISCLAIMER_ITEMS.map((i) => `<li>${escapeHtml(i)}</li>`).join("\n            ");
  return `
    <footer class="report-footer" data-section="footer">
        <div class="closing">${escapeHtml(stripEmphasisTags(c.closing))}</div>
        <div class="copyright">© iM뱅크 | Powered by iM AI Economist | 데이터 출처: 한국은행 ECOS, FRED, Yahoo Finance, 미 연준</div>
        <div class="legal-notice">
            <div class="legal-title">${escapeHtml(LEGAL_DISCLAIMER_TITLE)}</div>
            <ul class="legal-list">
            ${items}
            </ul>
        </div>
    </footer>
</div>
</div>
</body>
</html>`;
}

/** 주간 전망 HTML. 섹션: 머리글 → 제목 → 세 줄 요약 → 지난주 시장 → 최근 경제지표 → 이번 주 볼 것 → 전망 → 리스크 → 작성 방법 → 푸터(법적 고지 맨 끝). */
export function renderWeeklyReport(c: WeeklyContent, f: WeeklyFacts): string {
  return [
    renderHead(c, f, loadCSS()),
    renderMasthead(f),
    renderTitle(c),
    renderSummary(c),
    renderMarket(c, f),
    renderMacro(f),
    renderWatch(c, f),
    renderOutlook(c, f),
    renderRisks(c),
    renderMethod(f),
    renderFooter(c),
  ].join("\n");
}

export function weeklyCardSvg(c: WeeklyContent, f: WeeklyFacts): string {
  return renderWeeklyCardSvg({
    date: f.issue_date,
    headline: stripEmphasisTags(c.headline),
    line: stripEmphasisTags(c.cardLine),
    stats: f.card_stats,
  });
}

export async function saveWeeklyPreview(c: WeeklyContent, f: WeeklyFacts, outPath: string): Promise<string> {
  return saveCardPng(weeklyCardSvg(c, f), outPath);
}
