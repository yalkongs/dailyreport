/**
 * report-renderer.ts
 *
 * Claude JSON → 완성된 HTML 변환 템플릿 엔진.
 * HTML 구조와 CSS는 코드가 100% 담당하고,
 * Claude는 내러티브 콘텐츠(JSON)만 생성합니다.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  MarketDataCollection,
  MarketIndex,
  HistoricalComparison,
  ReportContent,
  ReportContentBlock,
} from "./types";
import { buildSparklineMap } from "./chart-generator";
import { decodeCharacterReferences, stripEmphasisTags } from "./html-entities";
import { LEGAL_DISCLAIMER_ITEMS, LEGAL_DISCLAIMER_TITLE } from "./legal-disclaimer";
import { renderStripesSvg } from "./preview/data-card";
import { CARD_WIDTH, CARD_HEIGHT } from "./preview/card-size";
import type { StripeSession } from "./preview/data-card";
import { summarySentence } from "./market-summary";
import { previousSessionLabel } from "./session-label";

// --- 유틸리티 ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 모델이 쓴 본문 글(강조 태그 허용 칸)을 HTML에 넣기 전 정리 — Ruling 43 (2026-10-20).
 * 뉴스 제목·요약이 모델 출력으로 흘러 들어가므로 끼어든 태그(<script>·<img onerror> 등)가 공개 페이지에 그대로 나가면 안 된다.
 * 순서(Ruling 37d): ① 문자 참조를 한 번 푼다(decodeCharacterReferences — "S&amp;P"·"S&P" 모두 "S&P", "&nbsp;"는 줄바꿈 없는 공백)
 * ② 전부 escape ③ 프롬프트가 쓰라고 한 강조 태그(속성 없는 <strong>·</strong>)만 되살린다. 속성이 붙은 태그는 글자로 남는다.
 * escape가 풀이 뒤에 오므로 인코딩된 태그("&lt;script&gt;")는 글자 "<script>"로 보일 뿐 태그가 되지 않는다.
 * 화면 글자 = 권유 검사가 보는 풀린 글자(claude-client adviceCheckTexts). 문자열이 아니면 빈 문자열.
 */
export function sanitizeInlineHtml(text: unknown): string {
  if (typeof text !== "string") return "";
  return escapeHtml(decodeCharacterReferences(text)).replace(/&lt;(\/?)strong&gt;/gi, "<$1strong>");
}

/** 변동률 절대값 → 히트맵 강도 등급 (1~5) */
function heatLevel(absPercent: number): number {
  if (absPercent >= 5) return 5;
  if (absPercent >= 3) return 4;
  if (absPercent >= 1.5) return 3;
  if (absPercent >= 0.5) return 2;
  if (absPercent >= 0.1) return 1;
  return 0;
}

/** 숫자 포맷팅: 소수점 2자리, 천 단위 쉼표 */
function formatNumber(value: number, maxDecimals = 2): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

/** CSS 파일 로드 */
function loadCSS(): string {
  const cssPath = path.join(__dirname, "report-template.css");
  if (!fs.existsSync(cssPath)) {
    console.log("⚠️ report-template.css 없음");
    return "";
  }
  return fs.readFileSync(cssPath, "utf-8");
}

// --- 섹션 렌더러들 ---

function renderHead(content: ReportContent, date: string, css: string): string {
  // headline·subline 모두 <strong> 강조 태그 제거 후 escape. 메타(title·description)는
  // 평문이어야 하고, 이 평문이 run.ts 추출을 거쳐 reports-index·프리뷰 이미지로도
  // 흐른다. 프롬프트(:448)는 헤드라인에도 핵심 수치를 허용하므로 헤드라인도 대상.
  const headline = escapeHtml(stripEmphasisTags(content.cover.headline));
  // 2026-10 개편: og:description 은 세 줄 요약(어제+오늘)을 한 문장으로. 요약이 없는 옛 콘텐츠는 부제로 대신한다.
  const description = escapeHtml(summarySentence(content.summary) || stripEmphasisTags(content.cover.subline));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headline} - iM AI Market Report</title>
<meta property="og:title" content="${headline}">
<meta property="og:description" content="${description}">
<meta property="og:site_name" content="iM뱅크">
<meta property="og:type" content="article">
<meta property="og:image" content="https://dailyreport-eta.vercel.app/reports/${date}-preview.png">
<meta property="og:image:width" content="${CARD_WIDTH}">
<meta property="og:image:height" content="${CARD_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="https://dailyreport-eta.vercel.app/reports/${date}-preview.png">
<style>
${css}
</style>
</head>`;
}

// 머리글 로고 — 카드(lib/preview/data-card.ts)와 같이 원본 1000×1000 이미지는 그대로 두고 viewBox로 내용 영역(65,231, 871×564)만 잘라 보인다.
const MAST_LOGO_H = 34;
const MAST_LOGO_W = Math.round((871 * MAST_LOGO_H * 10) / 564) / 10;

/** 머리글(로고·이름·날짜) + 최근 20거래일 코스피 스트라이프. 일봉이 없으면 스트라이프와 설명은 생략한다. */
function renderMasthead(date: string, dayOfWeek: string, sessions: StripeSession[]): string {
  // 날짜를 "2026년 4월 14일 화요일" 형식으로 변환
  const [y, m, d] = date.split("-");
  const dateStr = `${y}년 ${parseInt(m)}월 ${parseInt(d)}일 ${dayOfWeek}요일`;

  // 스트라이프 <g> 는 (0,0) 기준 680×120, ▼ 마커가 그 아래 20px 까지 내려오므로 viewBox 높이는 140.
  const stripes = sessions.length === 0 ? "" : `
        <div class="mast-stripes">
            <svg class="mast-stripes-svg" viewBox="0 0 680 140" role="img" aria-label="최근 20거래일 코스피 일간 등락을 색으로 나타낸 띠">${renderStripesSvg(sessions, 680, 120, { marker: true })}</svg>
            <p class="mast-caption">최근 20거래일 코스피 등락(색이 짙을수록 큰 움직임)</p>
        </div>`;

  return `<body>
<div class="report-embed">
<div class="report-container">
    <header class="masthead" data-section="masthead">
        <div class="mast-top">
            <div class="mast-brand">
                <svg class="mast-logo" role="img" aria-label="iM뱅크" viewBox="65 231 871 564" width="${MAST_LOGO_W}" height="${MAST_LOGO_H}"><image href="/im-bank-logo.png" width="1000" height="1000"/></svg>
                <span class="mast-sep" aria-hidden="true"></span>
                <span class="mast-titles"><span class="mast-label">iM AI Analyst</span><span class="mast-name">Daily Market</span></span>
            </div>
            <div class="mast-date">${dateStr}</div>
        </div>${stripes}
    </header>`;
}

/** 제목·부제 — 카드와 같은 제목. run.ts·narrative-memory 가 cover-headline·cover-subline 클래스로 추출한다. */
function renderTitle(content: ReportContent): string {
  return `
    <section class="title-block" data-section="title">
        <h1 class="cover-headline">${escapeHtml(stripEmphasisTags(content.cover.headline))}</h1>
        <p class="cover-subline">${escapeHtml(stripEmphasisTags(content.cover.subline))}</p>
    </section>`;
}

/**
 * 세 줄 요약 상자 — 어제 / 오늘 볼 것 / 내 자산은(→ ETF Today). 요약이 없으면(옛 콘텐츠) 생략.
 * M6: 첫 줄 라벨은 직전 한국 거래일 라벨(월요일 '지난 금요일', 휴장 다음 날 '직전 거래일'). 모델 문장은 그대로.
 */
function renderSummary(content: ReportContent, date: string): string {
  const s = content.summary;
  const rows: Array<{ label: string; text: string; href?: string }> = [
    { label: previousSessionLabel(date), text: s?.yesterday ?? "" },
    { label: "오늘 볼 것", text: s?.today ?? "" },
    { label: "내 자산은", text: s?.myAssets ?? "", href: `/etf-reports/${date}` },
  ].filter((r) => r.text.trim());
  if (rows.length === 0) return "";

  const items = rows.map((r) => {
    const text = escapeHtml(r.text.trim());
    const body = r.href
      ? `<a class="summary-text summary-link" href="${escapeHtml(r.href)}">${text}<span class="summary-arrow" aria-hidden="true"> →</span></a>`
      : `<span class="summary-text">${text}</span>`;
    return `
            <li class="summary-row"><span class="summary-label">${r.label}</span>${body}</li>`;
  }).join("");

  return `
    <section class="summary-box" data-section="summary" aria-label="세 줄 요약">
        <ul class="summary-list">${items}
        </ul>
    </section>`;
}

type PulseDirection = "up" | "down" | "flat";

function pulseDirection(pct: number): PulseDirection {
  return pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat";
}

function signedPercent(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** 지표 카드 한 장의 내용 — 핵심 지표(pickKeyIndicators)와 펼쳐 보기의 시장 체온이 같은 모양을 쓴다. */
export interface PulseItem {
  label: string;
  value: string;
  /** 카드 색(방향·진하기)과 기본 등락 문구(±N.NN%)의 기준. 금리처럼 %가 아닌 지표는 같은 색 눈금에 맞춘 값을 넣는다. */
  changePercent: number;
  /** 등락 문구를 기본(±N.NN%) 대신 직접 지정 — 금리는 %p 로 보인다. */
  changeText?: string;
}

/** 지표 카드 한 장. sparkSvg 가 있으면 왼쪽에 추세선을 붙인다. */
function renderPulseCard(item: PulseItem, sparkSvg?: string): string {
  const direction = pulseDirection(item.changePercent);
  const level = heatLevel(Math.abs(item.changePercent));
  const heatClass = level > 0 ? ` heat-${direction === "down" ? "down" : "up"}-${level}` : "";
  const changeText = item.changeText ?? signedPercent(item.changePercent);

  if (sparkSvg) {
    return `                <div class="pulse-card${heatClass}" style="display:flex;align-items:center;gap:8px">` +
      `<div style="flex-shrink:0">${sparkSvg}</div>` +
      `<div style="flex:1;min-width:0">` +
      `<div class="label">${escapeHtml(item.label)}</div>\n` +
      `                    <div class="value">${escapeHtml(item.value)}</div>\n` +
      `                    <div class="change ${direction}">${changeText}</div></div></div>\n`;
  }
  return `                <div class="pulse-card${heatClass}">\n` +
    `                    <div class="label">${escapeHtml(item.label)}</div>\n` +
    `                    <div class="value">${escapeHtml(item.value)}</div>\n` +
    `                    <div class="change ${direction}">${changeText}</div>\n` +
    `                </div>\n`;
}

function indexIndicator(list: MarketIndex[], symbol: string, label: string): PulseItem | null {
  const q = list.find((x) => x.symbol === symbol);
  if (!q || q.price == null) return null;
  return { label, value: formatNumber(q.price), changePercent: q.changePercent ?? 0 };
}

/**
 * 핵심 지표(최대 6개) — 코스피·S&P 500·나스닥·원/달러·미 10년물 + 그날 가장 크게 움직인 유가·금·비트코인 1개.
 * 종목은 심볼로 고르고, 데이터가 없는 항목은 건너뛴다(자리를 다른 지표로 채우지 않는다).
 */
export function pickKeyIndicators(data: MarketDataCollection): PulseItem[] {
  const fixed: Array<PulseItem | null> = [
    indexIndicator(data.koreaStocks, "^KS11", "코스피"),
    indexIndicator(data.usStocks, "^GSPC", "S&P 500"),
    indexIndicator(data.usStocks, "^IXIC", "나스닥"),
  ];

  const usdkrw = data.forex.find((f) => f.symbol === "KRW=X");
  fixed.push(usdkrw?.rate == null ? null : {
    label: "원/달러",
    value: formatNumber(usdkrw.rate),
    changePercent: usdkrw.changePercent ?? 0,
  });

  // 미 10년물: BondData 는 수익률(%)과 전일 대비 변화(%p)만 있고 등락률이 없다. 문구는 %p 그대로 보이고,
  // 색은 변화폭(bp) ÷ 10 을 지수 등락률 눈금에 맞춘 값으로 정한다 — 10bp 가 지수 1% 와 같은 진하기가 되도록.
  const tnx = data.bonds.find((b) => b.symbol === "^TNX");
  if (tnx?.yield == null) {
    fixed.push(null);
  } else {
    const change = tnx.change ?? 0; // %p
    const bp = change * 100;
    fixed.push({
      label: "미 10년물",
      value: `${tnx.yield.toFixed(2)}%`,
      changePercent: bp / 10,
      changeText: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%p`,
    });
  }

  // 그날 변수 1개 — |등락| 최대(같으면 유가 → 금 → 비트코인 순)
  const wti = data.commodities.find((c) => c.symbol === "CL=F");
  const gold = data.commodities.find((c) => c.symbol === "GC=F");
  const btc = data.crypto.find((c) => c.symbol === "BTC-USD");
  const candidates: PulseItem[] = [];
  if (wti?.price != null) candidates.push({ label: wti.nameKo, value: `$${formatNumber(wti.price)}`, changePercent: wti.changePercent ?? 0 });
  if (gold?.price != null) candidates.push({ label: gold.nameKo, value: `$${formatNumber(gold.price)}`, changePercent: gold.changePercent ?? 0 });
  if (btc?.price != null) candidates.push({ label: btc.nameKo, value: `$${formatNumber(btc.price, 0)}`, changePercent: btc.changePercent ?? 0 });
  const variable = candidates.reduce<PulseItem | null>(
    (best, c) => (best === null || Math.abs(c.changePercent) > Math.abs(best.changePercent) ? c : best),
    null,
  );

  return [...fixed, variable].filter((x): x is PulseItem => x !== null).slice(0, 6);
}

function renderKeyIndicators(data: MarketDataCollection): string {
  const items = pickKeyIndicators(data);
  if (items.length === 0) return "";
  return `
    <section class="section" data-section="key-indicators">
        <h2 class="section-title">핵심 지표</h2>
        <div class="key-grid">
${items.map((item) => renderPulseCard(item)).join("")}        </div>
    </section>`;
}

/**
 * 펼쳐 보기 안의 전체 지표(시장 체온) — 주요 지수·원/달러·원자재·암호화폐, 과거 비교 추세선 포함.
 * hasSparklines = 실제로 추세선이 붙은 카드가 있는지(펼쳐 보기 제목의 "과거 비교"와 추세선 설명이 이 값을 따른다).
 */
function renderMarketPulse(
  data: MarketDataCollection,
  sparkMap: Map<string, string>,
): { html: string; hasSparklines: boolean } {
  const items: PulseItem[] = [];

  // 주식 지수
  const allIndices = [
    ...data.koreaStocks,
    ...data.usStocks,
    ...data.japanStocks,
  ];
  for (const idx of allIndices) {
    if (idx.price == null) continue;
    items.push({ label: idx.nameKo, value: formatNumber(idx.price), changePercent: idx.changePercent ?? 0 });
  }

  // 환율 — 원/달러만
  const usdkrw = data.forex.find((f) => f.symbol === "KRW=X");
  if (usdkrw?.rate != null) {
    items.push({ label: usdkrw.nameKo, value: formatNumber(usdkrw.rate), changePercent: usdkrw.changePercent ?? 0 });
  }

  // 원자재
  for (const c of data.commodities) {
    if (c.price == null) continue;
    items.push({ label: c.nameKo, value: `$${formatNumber(c.price)}`, changePercent: c.changePercent ?? 0 });
  }

  // 암호화폐
  for (const cr of data.crypto) {
    if (cr.price == null) continue;
    items.push({ label: cr.nameKo, value: `$${formatNumber(cr.price, 0)}`, changePercent: cr.changePercent ?? 0 });
  }

  if (items.length === 0) return { html: "", hasSparklines: false };
  const cardsHtml = items.map((item) => renderPulseCard(item, sparkMap.get(item.label))).join("");
  const hasSparklines = items.some((item) => sparkMap.has(item.label));

  // C08 (2026-10-16): 추세선은 다섯 시점을 같은 간격으로 그린다 — 실제 시간 간격이 아니라는 점과
  // 색 기준(1년 전 대비)을 밝혀 일간 등락 색과 혼동하지 않게 한다.
  const sparkNote = hasSparklines
    ? `\n        <p class="pulse-note">추세선: 1년 전·3개월 전·1개월 전·1주 전·현재 5개 시점 비교(시간 간격 비례 아님). 추세선 색은 1년 전 대비, 숫자는 전일 대비입니다.</p>`
    : "";
  return {
    html: `
        <h3 class="more-title">시장 체온</h3>
        <div class="market-grid">
${cardsHtml}        </div>${sparkNote}`,
    hasSparklines,
  };
}

function renderBigStory(content: ReportContent, date: string): string {
  // M6: 월요일·휴장 다음 날엔 "어제"가 아니다 — 직전 한국 거래일 라벨(어제·지난 금요일·직전 거래일).
  let html = `
    <section class="section" data-section="story">
        <h2 class="section-title">${previousSessionLabel(date)} 무슨 일이 있었나</h2>
        <div class="narrative">`;

  for (const block of content.bigStory.content) {
    html += renderContentBlock(block);
  }

  html += `
        </div>
    </section>`;
  return html;
}

function renderContentBlock(block: ReportContentBlock): string {
  switch (block.type) {
    case "paragraph":
      return `\n                <p>${sanitizeInlineHtml(block.text)}</p>`;

    case "pullQuote":
      return `\n                <div class="pull-quote">\n                    ${sanitizeInlineHtml(block.text)}\n                </div>`;

    case "dataCard": {
      let rows = "";
      for (const row of block.rows ?? []) {
        rows += `\n                    <div class="data-row"><span class="data-label">${escapeHtml(row.label)}</span><span class="data-value">${escapeHtml(row.value)}</span></div>`;
      }
      return `\n                <div class="data-card">\n                    <div class="data-title">${escapeHtml(block.title ?? "")}</div>${rows}\n                </div>`;
    }

    default:
      return "";
  }
}

/** 오늘 볼 것 — 최대 3개. 순서는 생성 단계(한국시간 순서 지시)를 그대로 따른다. */
function renderWatchPoints(content: ReportContent): string {
  const points = content.watchPoints.slice(0, 3);
  if (points.length === 0) return "";

  let cards = "";
  for (const wp of points) {
    cards += `
            <div class="watch-card">
                <div class="watch-badge">${escapeHtml(wp.badge)}</div>
                <div class="watch-title">${escapeHtml(wp.title)}</div>
                <div class="watch-desc">${sanitizeInlineHtml(wp.description)}</div>
            </div>`;
  }

  return `
    <section class="section" data-section="today">
        <h2 class="section-title">오늘 볼 것</h2>${cards}
    </section>`;
}

/** 한국 시장에 주는 의미 — 최대 3개("확인되면 / 어긋나면" 조건형은 생성 단계 지시). */
function renderSoWhat(content: ReportContent): string {
  const items = content.soWhat.slice(0, 3);
  if (items.length === 0) return "";

  let cards = "";
  for (const sw of items) {
    cards += `
            <div class="sowhat-card">
                <div class="sowhat-title">${escapeHtml(sw.title)}</div>
                <p>${sanitizeInlineHtml(sw.body)}</p>
            </div>`;
  }

  return `
    <section class="section" data-section="meaning">
        <h2 class="section-title">한국 시장에 주는 의미</h2>${cards}
    </section>`;
}

/** 이번 주 주요 일정 표 — 펼쳐 보기 안에 들어간다. */
function renderCalendar(content: ReportContent): string {
  if (content.calendar.length === 0) return "";

  let rows = "";
  for (const item of content.calendar) {
    const stars = "★".repeat(Math.min(5, item.importance)) + "☆".repeat(Math.max(0, 5 - item.importance));
    rows += `
            <tr>
                <td>${escapeHtml(item.date)}</td>
                <td>${escapeHtml(item.country)}</td>
                <td>${escapeHtml(item.event)}</td>
                <td class="stars">${stars}</td>
            </tr>`;
  }

  return `
        <h3 class="more-title">이번 주 주요 일정</h3>
        <table class="calendar-table">
            <thead><tr><th>날짜</th><th>국가</th><th>이벤트</th><th>중요도</th></tr></thead>
            <tbody>${rows}
            </tbody>
        </table>`;
}

/**
 * 펼쳐 보기(기본 접힘) — 전체 지표·이번 주 일정·과거 비교 추세선. 안에 넣을 것이 없으면 생략한다.
 * 제목은 실제로 들어 있는 것만 나열한다(일정표나 추세선이 없는데 있다고 하지 않는다).
 */
function renderDetails(
  content: ReportContent,
  data: MarketDataCollection,
  historicalData: HistoricalComparison[],
): string {
  const pulse = renderMarketPulse(data, buildSparklineMap(historicalData));
  const calendar = renderCalendar(content);
  const body = pulse.html + calendar;
  if (!body) return "";
  const title = [
    pulse.html && "전체 지표",
    calendar && "이번 주 일정",
    pulse.hasSparklines && "과거 비교",
  ].filter(Boolean).join("·");
  return `
    <details class="more" data-section="details">
        <summary class="more-summary">${title}</summary>
        <div class="more-body">${body}
        </div>
    </details>`;
}

export interface ReportSourceLink {
  title: string;
  source: string;
  url?: string;
}

// C09 (2026-10-16): 리포트 작성 때 입력으로 준 뉴스 일부와 원문 링크. 본문 주장과 1:1 인용 목록이 아님을 밝힌다.
function renderSources(sources: ReportSourceLink[] | undefined): string {
  const items = (sources ?? []).slice(0, 6);
  if (items.length === 0) return "";
  const li = items.map((s) => {
    const title = escapeHtml(s.title);
    const titleHtml = s.url && /^https?:\/\//i.test(s.url)
      ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
      : title;
    return `<li>${titleHtml} <span class="source-meta">· ${escapeHtml(s.source)}</span></li>`;
  }).join("\n            ");
  return `
    <section class="section" data-section="sources">
        <h2 class="section-title">참고한 뉴스</h2>
        <p class="source-note">리포트 작성 때 입력으로 제공된 뉴스 중 일부입니다. 본문 각 문장과 1:1로 연결된 인용 목록은 아닙니다.</p>
        <ul class="source-list">
            ${li}
        </ul>
    </section>`;
}

/**
 * 데이터 기준 — 참고한 뉴스 다음, 법적 고지 앞(spec §3.1 9행). 수집 시각(KST)과 값의 성격만 밝히고 건수 같은 메타는 두지 않는다.
 * 값은 모두 Yahoo 시세(lib/market-data.ts fetchQuote)의 수집 시점 값이고, 등락은 전일 종가 대비다.
 * 정기 실행(06:40 KST)은 국내·미국·일본·중국 증시가 모두 닫힌 때라 지수는 직전 종가가 된다.
 */
function renderDataBasis(collectedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\+09:00$/.exec(collectedAt);
  const when = m ? `${m[1]}년 ${parseInt(m[2])}월 ${parseInt(m[3])}일 ${m[4]}:${m[5]}(한국시간)에 수집했습니다. ` : "";
  return `
    <section class="data-basis" data-section="data-basis">
        <p class="source-note"><strong>데이터 기준</strong> ${when}주가지수는 수집 시점의 가장 최근 시세(개장 전이면 직전 종가), 환율·원자재·가상자산은 수집 시점 가격이며, 등락은 전일 대비입니다.</p>
    </section>`;
}

function renderFooter(content: ReportContent): string {
  const legalItems = LEGAL_DISCLAIMER_ITEMS
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("\n            ");

  return `
    <footer class="report-footer" data-section="footer">
        <div class="closing">${escapeHtml(content.closingMessage)}</div>
        <div class="copyright">© iM뱅크 | Powered by iM AI Analyst | 데이터 출처: Yahoo Finance, FRED, ECOS, KRX, Google News</div>
        <div class="legal-notice">
            <div class="legal-title">${escapeHtml(LEGAL_DISCLAIMER_TITLE)}</div>
            <ul class="legal-list">
            ${legalItems}
            </ul>
        </div>
    </footer>
</div>
</div>
</body>
</html>`;
}

// --- 메인 렌더 함수 ---

/**
 * Market 리포트 HTML. 섹션 순서(spec 2026-10-17 §3.1):
 * 머리글+스트라이프 → 제목·부제 → 세 줄 요약 → 핵심 지표 → 어제 무슨 일 → 오늘 볼 것 → 한국 시장 의미
 * → 펼쳐 보기 → 참고한 뉴스 → 데이터 기준 → 푸터(법적 고지 맨 끝).
 *
 * mode(event/normal/quiet)는 프롬프트의 "어제 무슨 일" 분량 조절에만 쓰고 섹션 구성은 바꾸지 않는다 —
 * 모드와 무관하게 오늘 볼 것·의미 섹션이 항상 나온다.
 */
export function renderReport(
  content: ReportContent,
  data: MarketDataCollection,
  historicalData: HistoricalComparison[],
  mode?: "event" | "normal" | "quiet",
  sources?: ReportSourceLink[],
  kospiSessions: StripeSession[] = [],
): string {
  const css = loadCSS();

  const sections = [
    renderHead(content, data.date, css),
    renderMasthead(data.date, data.dayOfWeek, kospiSessions),
    renderTitle(content),
    renderSummary(content, data.date),
    renderKeyIndicators(data),
    renderBigStory(content, data.date),
    renderWatchPoints(content),
    renderSoWhat(content),
    renderDetails(content, data, historicalData),
    renderSources(sources),
    renderDataBasis(data.collectedAt),
    renderFooter(content),
  ];

  return sections.filter(Boolean).join("\n");
}
