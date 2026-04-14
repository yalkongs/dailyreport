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
  HistoricalComparison,
  ReportContent,
  ReportContentBlock,
  ReportCompassSection,
} from "./types";
import { buildSparklineMap } from "./chart-generator";

// --- 유틸리티 ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const headline = escapeHtml(content.cover.headline);
  const subline = escapeHtml(content.cover.subline);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headline} - iM AI Market Report</title>
<meta property="og:title" content="${headline}">
<meta property="og:description" content="${subline}">
<meta property="og:type" content="article">
<meta property="og:image" content="https://dailyreport-eta.vercel.app/api/og?date=${date}">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="900">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${headline}">
<meta name="twitter:description" content="${subline}">
<meta name="twitter:image" content="https://dailyreport-eta.vercel.app/api/og?date=${date}">
<style>
${css}
</style>
</head>`;
}

function renderCover(content: ReportContent, date: string, dayOfWeek: string): string {
  // 날짜를 "2026년 4월 14일 화요일" 형식으로 변환
  const [y, m, d] = date.split("-");
  const dateStr = `${y}년 ${parseInt(m)}월 ${parseInt(d)}일 ${dayOfWeek}요일`;

  return `<body>
<div class="report-embed">
<div class="report-container">
    <section class="cover">
        <div class="cover-date">${dateStr}</div>
        <h1 class="cover-headline">${escapeHtml(content.cover.headline)}</h1>
        <p class="cover-subline">${escapeHtml(content.cover.subline)}</p>
        <div class="cover-byline">iM AI Analyst</div>
    </section>`;
}

function renderMarketPulse(
  data: MarketDataCollection,
  historicalData: HistoricalComparison[]
): string {
  const sparkMap = buildSparklineMap(historicalData);

  // 표시할 지표 목록 구성
  interface PulseItem {
    label: string;
    value: string;
    changePercent: number;
    direction: "up" | "down" | "flat";
  }

  const items: PulseItem[] = [];

  // 주식 지수
  const allIndices = [
    ...data.koreaStocks,
    ...data.usStocks,
    ...data.japanStocks,
  ];
  for (const idx of allIndices) {
    if (idx.price == null) continue;
    const pct = idx.changePercent ?? 0;
    items.push({
      label: idx.nameKo,
      value: formatNumber(idx.price),
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  }

  // 환율 — 원/달러만
  const usdkrw = data.forex.find((f) => f.symbol === "KRW=X");
  if (usdkrw?.rate != null) {
    const pct = usdkrw.changePercent ?? 0;
    items.push({
      label: usdkrw.nameKo,
      value: formatNumber(usdkrw.rate),
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  }

  // 원자재
  for (const c of data.commodities) {
    if (c.price == null) continue;
    const pct = c.changePercent ?? 0;
    items.push({
      label: c.nameKo,
      value: `$${formatNumber(c.price)}`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  }

  // 암호화폐
  for (const cr of data.crypto) {
    if (cr.price == null) continue;
    const pct = cr.changePercent ?? 0;
    items.push({
      label: cr.nameKo,
      value: `$${formatNumber(cr.price, 0)}`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  }

  // 카드 HTML 생성
  let cardsHtml = "";
  for (const item of items) {
    const abs = Math.abs(item.changePercent);
    const level = heatLevel(abs);
    const heatClass = level > 0 ? ` heat-${item.direction === "down" ? "down" : "up"}-${level}` : "";
    const changeClass = item.direction;
    const changeText = `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;

    // 스파크라인 매칭
    const sparkSvg = sparkMap.get(item.label);

    if (sparkSvg) {
      cardsHtml += `                <div class="pulse-card${heatClass}" style="display:flex;align-items:center;gap:8px">` +
        `<div style="flex-shrink:0">${sparkSvg}</div>` +
        `<div style="flex:1;min-width:0">` +
        `<div class="label">${escapeHtml(item.label)}</div>\n` +
        `                    <div class="value">${item.value}</div>\n` +
        `                    <div class="change ${changeClass}">${changeText}</div></div></div>\n`;
    } else {
      cardsHtml += `                <div class="pulse-card${heatClass}">\n` +
        `                    <div class="label">${escapeHtml(item.label)}</div>\n` +
        `                    <div class="value">${item.value}</div>\n` +
        `                    <div class="change ${changeClass}">${changeText}</div>\n` +
        `                </div>\n`;
    }
  }

  return `
    <section class="section">
        <h2 class="section-title">시장 체온</h2>
        <div class="market-grid">
${cardsHtml}        </div>
    </section>`;
}

function renderBigStory(content: ReportContent): string {
  let html = `
    <section class="section">
        <h2 class="section-title">오늘의 시장 이야기</h2>
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
      return `\n                <p>${block.text ?? ""}</p>`;

    case "pullQuote":
      return `\n                <div class="pull-quote">\n                    ${block.text ?? ""}\n                </div>`;

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

function renderWatchPoints(content: ReportContent): string {
  if (content.watchPoints.length === 0) return "";

  let cards = "";
  for (const wp of content.watchPoints) {
    cards += `
            <div class="watch-card">
                <div class="watch-badge">${escapeHtml(wp.badge)}</div>
                <div class="watch-title">${escapeHtml(wp.title)}</div>
                <div class="watch-desc">${wp.description}</div>
            </div>`;
  }

  return `
    <section class="section">
        <h2 class="section-title">오늘의 관찰 포인트</h2>${cards}
    </section>`;
}

function renderCompass(content: ReportContent): string {
  if (content.compass.length === 0) return "";

  let boxes = "";
  for (const section of content.compass) {
    boxes += renderCompassBox(section);
  }

  return `
    <section class="section">
        <h2 class="section-title">iM 투자 나침반</h2>
        ${boxes}
    </section>`;
}

function renderCompassBox(section: ReportCompassSection): string {
  let body = "";

  if (section.items && section.items.length > 0) {
    for (const item of section.items) {
      const width = Math.max(5, Math.min(100, item.gaugePercent));
      body += `
                <p><strong>${escapeHtml(item.asset)}:</strong> ${item.body}</p>
                <div class="gauge-bar"><div class="gauge-fill ${item.gaugeType}" style="width:${width}%"></div></div>`;
    }
  }

  if (section.paragraphs) {
    for (const p of section.paragraphs) {
      body += `\n                <p>${p}</p>`;
    }
  }

  return `
            <div class="compass-box">
                <div class="compass-label">${escapeHtml(section.label)}</div>
                <div class="compass-title">${escapeHtml(section.title)}</div>${body}
            </div>`;
}

function renderSoWhat(content: ReportContent): string {
  if (content.soWhat.length === 0) return "";

  let cards = "";
  for (const sw of content.soWhat) {
    cards += `
            <div class="sowhat-card">
                <div class="sowhat-title">${escapeHtml(sw.title)}</div>
                <p>${sw.body}</p>
            </div>`;
  }

  return `
    <section class="section">
        <h2 class="section-title">그래서, 무엇이 달라지나</h2>${cards}
    </section>`;
}

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
    <section class="section">
        <h2 class="section-title">이번 주 주요 일정</h2>
        <table class="calendar-table">
            <thead><tr><th>날짜</th><th>국가</th><th>이벤트</th><th>중요도</th></tr></thead>
            <tbody>${rows}
            </tbody>
        </table>
    </section>`;
}

function renderFooter(content: ReportContent): string {
  return `
    <footer class="report-footer">
        <div class="closing">${escapeHtml(content.closingMessage)}</div>
        <div class="disclaimer">본 리포트는 AI가 자동 생성한 것으로, 투자 권유가 아닙니다. 투자 판단의 책임은 투자자 본인에게 있습니다.</div>
        <div class="copyright">© iM뱅크 | Powered by iM AI Analyst | 데이터 출처: Yahoo Finance, FRED, ECOS, KRX, Google News</div>
    </footer>
</div>
</div>
</body>
</html>`;
}

// --- 메인 렌더 함수 ---

export function renderReport(
  content: ReportContent,
  data: MarketDataCollection,
  historicalData: HistoricalComparison[]
): string {
  const css = loadCSS();

  const sections = [
    renderHead(content, data.date, css),
    renderCover(content, data.date, data.dayOfWeek),
    renderMarketPulse(data, historicalData),
    renderBigStory(content),
    renderWatchPoints(content),
    renderCompass(content),
    renderSoWhat(content),
    renderCalendar(content),
    renderFooter(content),
  ];

  return sections.join("\n");
}
