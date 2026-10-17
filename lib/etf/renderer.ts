// lib/etf/renderer.ts
//
// ETF Today 페이지(2026-10-17 아침 리포트 개편, spec 3.2). 위에서부터:
//   머리글 + 모자이크(미리보기 카드와 같은 그림) → 제목·부제 → 세 줄 요약 → 자산군별 판단 재료
//   → 오늘 확인할 것 → 레버리지·인버스 주의(있을 때만) → 펼쳐 보기(국내·미국 ETF 표)
//   → 참고한 뉴스 → 데이터 기준 → 투자자 보호 기준·법적 고지(맨 끝)
// 숫자(대표 ETF 예시·등락·추정 거래대금)는 코드가 데이터에서 렌더하고, 모델은 문장만 쓴다.
import * as fs from 'fs'
import * as path from 'path'
import type { MorningReport, CollectedData, EtfQuote } from './types'
import { getEtfByTicker } from './universe'
import { polishKoreanReportText } from './report-language'
import { googleFinanceQuoteUrl } from './etf-links'
import {
  REPORT_PREVIEW_IMAGE_HEIGHT,
  REPORT_PREVIEW_IMAGE_WIDTH,
  REPORT_SITE_NAME,
  reportPreviewDescription,
  reportPreviewImageFilename,
  reportPreviewImageUrl,
  reportPreviewTitle,
  reportRouteUrl,
} from './report-preview'
// R1 (2026-07-22): 선택 로직은 story-characters.ts로 이동(렌더러·프롬프트·검증 공유).
import { isTacticalEtf } from './story-characters'
import { buildAssetClassSlots, cardSlot, type AssetClassSlot, type AssetRep } from './asset-classes'
import { buildMosaicTiles, renderEtfCardSvg, renderMosaicSvg, saveCardPng, type MosaicTile } from '../preview/data-card'
import { LEGAL_DISCLAIMER_ITEMS, LEGAL_DISCLAIMER_TITLE } from '../legal-disclaimer'
import { koreanWeekday } from '../market-calendar'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const e = escapeHtml

// Logo loading is centralized in lib/preview/brand-logo.ts so the same
// candidate list / mime detection serves both the HTML report cover and
// the link-preview PNG.
import { tryLoadBrandLogoDataUri } from '../preview/brand-logo'

interface RenderHtmlOptions {
  publicBaseUrl?: string
}

interface HtmlMetadata {
  canonicalUrl?: string
  description: string
  imageUrl: string
  previewTitle: string
}

function imBankLogoSrc(): string {
  const src = tryLoadBrandLogoDataUri()
  if (!src) {
    console.warn('[renderer] iM 뱅크 로고 파일을 찾을 수 없습니다. 빈 src 반환.')
    return ''
  }
  return src
}

function baseHtml(title: string, date: string, type: string, body: string, metadata?: HtmlMetadata): string {
  const previewTitle = metadata?.previewTitle ?? title
  const description = metadata?.description ?? `${date} ${type} ETF report`
  const imageUrl = metadata?.imageUrl
  const canonicalUrl = metadata?.canonicalUrl

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${e(title)}</title>
  <meta name="description" content="${e(description)}">
  ${canonicalUrl ? `<link rel="canonical" href="${e(canonicalUrl)}">` : ''}
  <meta property="og:site_name" content="${e(REPORT_SITE_NAME)}">
  <meta property="og:title" content="${e(previewTitle)}">
  <meta property="og:description" content="${e(description)}">
  <meta property="og:type" content="article">
  ${canonicalUrl ? `<meta property="og:url" content="${e(canonicalUrl)}">` : ''}
  ${imageUrl ? `<meta property="og:image" content="${e(imageUrl)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${REPORT_PREVIEW_IMAGE_WIDTH}">
  <meta property="og:image:height" content="${REPORT_PREVIEW_IMAGE_HEIGHT}">
  <meta property="og:image:alt" content="${e(previewTitle)}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${e(previewTitle)}">
  <meta name="twitter:description" content="${e(description)}">
  ${imageUrl ? `<meta name="twitter:image" content="${e(imageUrl)}">` : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --im-teal: #00bfa5;
      --im-teal-deep: #008f7f;
      --im-mint: #84d96b;
      --im-graphite: #5d6062;
      --ink: #161b1d;
      --muted: #5f6b67;
      --line: #d9e0dc;
      --paper: #f5f7f3;
      --panel: #ffffff;
      --soft-teal: #eefbf6;
      --warning: #b26b00;
      --up: #D32F2F;
      --down: #1565C0;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;
           background: var(--paper); color: var(--ink); max-width: 760px; margin: 0 auto; padding: 26px 18px; word-break: keep-all; }
    .cover { background: var(--panel); border: 1px solid var(--line); border-top: 8px solid var(--im-teal);
             border-radius: 8px; padding: 22px; margin-bottom: 26px; box-shadow: 0 14px 34px rgba(31, 54, 48, 0.08); }
    .masthead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 14px; align-items: center; margin-bottom: 16px; }
    .brand-lockup { display: flex; gap: 12px; align-items: center; min-width: 0; }
    .brand-logo { display: block; width: 72px; height: 72px; object-fit: contain; flex: 0 0 auto; }
    .brand-name { font-size: 13px; color: var(--im-graphite); font-weight: 800; line-height: 1.2; white-space: nowrap; }
    .report-name { font-size: 28px; line-height: 1; font-weight: 900; letter-spacing: 0; color: var(--ink); margin-top: 3px; white-space: nowrap; }
    .issue-date { color: var(--muted); font-size: 13px; font-weight: 800; white-space: nowrap; }
    .mosaic { margin: 0 0 18px; }
    .mosaic svg { display: block; width: 100%; height: auto; border-radius: 6px; }
    .mosaic figcaption { font-size: 12px; color: var(--muted); line-height: 1.5; margin-top: 6px; }
    .cover h1 { font-size: 30px; font-weight: 900; line-height: 1.25; margin-bottom: 10px; color: var(--ink); letter-spacing: 0; text-wrap: balance; }
    .cover .subline { font-size: 16px; color: var(--muted); line-height: 1.65; }
    .section { margin-bottom: 30px; }
    .section-title { position: relative; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink); letter-spacing: 1.4px;
                     border-top: 3px solid var(--ink); border-bottom: 1px solid var(--line); padding: 11px 0 10px; margin-bottom: 14px; font-weight: 900; }
    .section-title::before { content: ""; width: 32px; height: 7px; background: var(--im-teal); border-radius: 6px; }
    .section-note { font-size: 12px; color: var(--muted); line-height: 1.6; margin-bottom: 12px; }
    .narrative { font-size: 15px; line-height: 1.8; color: #27302d; }
    /* 세 줄 요약 상자 — Market(lib/report-template.css .summary-box)과 같은 모양 */
    .summary-box { background: #EEFAF7; border: 1px solid #BFE9DF; border-radius: 10px; padding: 8px 16px; margin-bottom: 30px; }
    .summary-list { list-style: none; }
    .summary-row { display: flex; align-items: baseline; gap: 12px; padding: 10px 0; }
    .summary-row + .summary-row { border-top: 1px solid #D3EEE7; }
    .summary-label { flex: none; width: 66px; font-size: 13px; font-weight: 700; color: var(--im-teal-deep); }
    .summary-text { font-size: 15px; line-height: 1.65; color: #1A2421; min-width: 0; word-break: keep-all; overflow-wrap: break-word; }
    .asset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .asset-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
    .asset-label { font-size: 16px; font-weight: 900; color: var(--ink); margin-bottom: 10px; }
    .field-label { font-size: 11px; font-weight: 900; color: var(--im-teal-deep); margin-bottom: 5px; }
    .rep-list { list-style: none; display: grid; gap: 6px; }
    .rep-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; align-items: baseline; font-size: 13px; }
    .rep-badge { font-size: 10px; font-weight: 900; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; background: #fbfcfa; }
    .rep-name { font-weight: 800; overflow-wrap: anywhere; }
    .rep-code { color: #6b746e; font-size: 11px; margin-left: 4px; white-space: nowrap; }
    .rep-change { white-space: nowrap; }
    .asset-field { border-top: 1px solid #e8ece8; padding-top: 9px; margin-top: 10px; }
    .asset-field p { font-size: 13px; line-height: 1.6; color: #2d3531; overflow-wrap: anywhere; }
    .check-list { list-style: none; display: grid; gap: 10px; }
    .check-item { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; background: var(--panel); border: 1px solid var(--line);
                  border-left: 4px solid var(--im-mint); border-radius: 8px; padding: 12px 14px; }
    .check-time { font-size: 13px; font-weight: 900; color: var(--im-teal-deep); font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .check-what { font-size: 15px; font-weight: 900; line-height: 1.45; margin-bottom: 6px; color: #1c2421; }
    .check-field { font-size: 13px; color: #3c4642; line-height: 1.55; overflow-wrap: anywhere; }
    .check-label { font-weight: 900; color: var(--muted); margin-right: 4px; }
    .tactical { background: #fff7e7; border: 1px solid #ecd3a6; border-left: 4px solid var(--warning); border-radius: 8px; padding: 14px 16px; }
    .tactical .section-title { border-top: 0; padding-top: 0; border-bottom-color: #ecd3a6; }
    .tactical-note { font-size: 12px; color: #6b5532; line-height: 1.6; margin-top: 8px; }
    .details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
    .details > summary { cursor: pointer; font-weight: 900; color: var(--im-teal-deep); }
    .table-title { font-size: 12px; font-weight: 900; color: var(--ink); margin: 16px 0 6px; }
    .table-wrap { overflow-x: auto; }
    .etf-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .etf-table th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 800; border-bottom: 2px solid var(--line); padding: 6px 4px; white-space: nowrap; }
    .etf-table td { border-bottom: 1px solid #e8ece8; padding: 7px 4px; vertical-align: top; line-height: 1.4; }
    .etf-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .etf-table .tag { color: var(--muted); white-space: nowrap; }
    .table-note { font-size: 11px; color: var(--muted); margin-top: 10px; line-height: 1.6; }
    .change-up { color: var(--up); font-weight: 900; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .change-down { color: var(--down); font-weight: 900; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .change-flat { color: var(--muted); font-weight: 800; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .etf-chip { display: inline-flex; align-items: baseline; gap: 4px; border: 1px solid #bce5dc; background: var(--soft-teal);
                color: var(--im-teal-deep); border-radius: 6px; padding: 1px 6px; font-size: 0.92em; line-height: 1.45; white-space: nowrap; }
    .etf-chip-us { border-color: #c7d2e4; background: #f6f8fc; color: #2d4f77; }
    .etf-chip-alert { border-color: #e3c59b; background: #fff7e8; color: #7a4b10; }
    .etf-chip-name { font-weight: 800; }
    .etf-chip-code { color: #6b746e; font-size: 0.86em; }
    .etf-link { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(0, 143, 127, 0.35); }
    .etf-link:hover { color: var(--im-teal-deep); border-bottom-color: currentColor; }
    .etf-link:focus-visible { outline: 2px solid var(--im-teal); outline-offset: 2px; border-radius: 4px; }
    .etf-chip.etf-link { border-bottom: 1px solid #bce5dc; }
    .source-list { display: grid; gap: 8px; }
    .source-item { font-size: 13px; line-height: 1.5; border-bottom: 1px solid #d6ddd3; padding-bottom: 8px; color: #38413d; }
    .source-item a { color: var(--im-teal-deep); overflow-wrap: anywhere; }
    .data-note { font-size: 13px; color: var(--muted); line-height: 1.7; margin-bottom: 28px; background: var(--panel);
                 border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .client-notice { background: var(--panel); border: 1px solid var(--line); border-top: 5px solid var(--im-graphite);
                     border-radius: 8px; padding: 18px; margin-bottom: 28px; }
    .notice-title { font-size: 18px; font-weight: 900; color: var(--ink); margin-bottom: 8px; }
    .notice-text { font-size: 13px; color: var(--muted); line-height: 1.65; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .pill { border: 1px solid var(--line); border-radius: 6px; background: var(--soft-teal); color: var(--im-teal-deep);
            font-size: 11px; font-weight: 900; padding: 5px 8px; }
    .legal-title { font-size: 13px; font-weight: 900; color: var(--ink); margin-top: 16px; padding-top: 14px;
                   border-top: 1px solid var(--line); }
    .legal-list { margin: 8px 0 0; padding-left: 18px; list-style: disc; }
    .legal-list li { font-size: 12px; color: var(--muted); line-height: 1.65; margin-bottom: 5px; word-break: keep-all; }
    .legal-list li:last-child { margin-bottom: 0; }
    @media (max-width: 600px) {
      body { padding: 14px 10px; }
      .cover { padding: 16px; margin-bottom: 22px; }
      .brand-logo { width: 60px; height: 60px; }
      .report-name { font-size: 24px; }
      .cover h1 { font-size: 25px; }
      .cover .subline, .narrative { font-size: 15px; }
      .asset-grid { grid-template-columns: 1fr; }
      .summary-label { width: 62px; }
      .check-item { grid-template-columns: 1fr; gap: 4px; }
      .etf-chip { max-width: 100%; white-space: normal; vertical-align: baseline; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

const COMMODITY_NAME = /골드|gold|silver|원유|oil|wti|commodity|원자재/i
const TAG_BY_CATEGORY: Record<string, string> = {
  '채권': '채권', '테마': '테마', '섹터': '섹터', '해외지수': '해외지수', '팩터': '팩터', '지수': '지수',
}

// 유니버스 category가 1순위. 이름 정규식은 유니버스 밖 종목에만 쓴다
// (단독 '금'은 '금융'·'금리'에 걸려서 제외). 펼쳐 보기 표의 '구분' 칸.
// 레버리지·인버스는 '전술'로 뭉뚱그리지 않고 그대로 쓴다(시세 이름이 티커 그대로면 유니버스 이름으로 판정).
export function inferEtfTag(q: EtfQuote): string {
  const def = getEtfByTicker(q.ticker)
  const names = [q.name, def?.name ?? ''].filter(Boolean)
  if (names.some(name => isTacticalEtf({ ...q, name }))) {
    return names.some(name => /인버스|inverse/i.test(name)) ? '인버스' : '레버리지'
  }
  if (def) {
    if (def.category === '대안') return COMMODITY_NAME.test(q.name) || COMMODITY_NAME.test(def.name) ? '원자재' : '대안'
    return TAG_BY_CATEGORY[def.category] ?? '지수'
  }
  const name = q.name.toLowerCase()
  if (/반도체|semiconductor|ai|바이오|bio/.test(name)) return '테마'
  if (/채권|bond|국채|tlt|ief|shy/.test(name)) return '채권'
  if (COMMODITY_NAME.test(name)) return '원자재'
  return '지수'
}

function formatEtfIdentity(q: EtfQuote): { primary: string; secondary: string; plain: string } {
  if (q.market === 'KR') {
    const code = q.ticker.replace(/\.(KS|KQ)$/i, '')
    const name = /\.(KS|KQ)$/i.test(q.name) ? code : q.name
    return {
      primary: name,
      secondary: `(${code})`,
      plain: `${name} (${code})`,
    }
  }

  const secondary = q.name && q.name !== q.ticker ? q.name : ''
  return {
    primary: q.ticker,
    secondary,
    plain: secondary ? `${q.ticker} ${secondary}` : q.ticker,
  }
}

function etfLinkAttrs(ticker: string): string {
  const url = googleFinanceQuoteUrl(ticker)
  if (!url) return ''
  return ` href="${e(url)}" target="_blank" rel="noopener noreferrer"`
}

function renderEtfLink(ticker: string, html: string, className = 'etf-link'): string {
  const attrs = etfLinkAttrs(ticker)
  if (!attrs) return html
  return `<a class="${e(className)}"${attrs}>${html}</a>`
}

// 카드·표용 이름과 코드: 국내는 이름 + 6자리 코드, 미국은 이름 + 티커.
// 시세 이름이 비었거나 티커 그대로면 유니버스 이름을 쓴다.
function etfNameAndCode(ticker: string, name: string, market: 'KR' | 'US'): { name: string; code: string } {
  const code = market === 'KR' ? ticker.replace(/\.(KS|KQ)$/i, '') : ticker
  const raw = (name ?? '').trim()
  const tickerLike = !raw || raw === ticker || /\.(KS|KQ)$/i.test(raw)
  return { name: tickerLike ? (getEtfByTicker(ticker)?.name ?? code) : raw, code }
}

function renderNameAndCode(ticker: string, name: string, market: 'KR' | 'US'): string {
  const id = etfNameAndCode(ticker, name, market)
  return renderEtfLink(ticker, `<span class="rep-name">${e(id.name)}</span><span class="rep-code">${e(id.code)}</span>`)
}

function compactKrwAmount(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}조 원`
  if (abs >= 1e8) return `${(value / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}억 원`
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`
}

function compactUsdAmount(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function formatAmountForQuote(q: EtfQuote, value: number): string {
  return q.market === 'KR' ? compactKrwAmount(value) : compactUsdAmount(value)
}

// 등락률 표기는 기존 렌더러 그대로(+ 부호, 하락은 ASCII '-', 소수 둘째 자리).
function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '-'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function changeClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || pct === 0) return 'change-flat'
  return pct > 0 ? 'change-up' : 'change-down'
}

function renderPct(pct: number | null | undefined, extraClass = ''): string {
  return `<span class="${changeClass(pct)}${extraClass ? ` ${extraClass}` : ''}">${e(formatPct(pct))}</span>`
}

function renderReportText(text: string, quotes: EtfQuote[]): string {
  return renderEtfChips(replaceKnownEtfTickers(polishKoreanReportText(text), quotes), quotes)
}

function polishKoreanText(text: string): string {
  return polishKoreanReportText(text)
}

function replaceKnownEtfTickers(text: string, quotes: EtfQuote[]): string {
  const withKnownNames = quotes
    .filter(q => q.market === 'KR' && /\.(KS|KQ)$/i.test(q.ticker))
    .sort((a, b) => b.ticker.length - a.ticker.length)
    .reduce((next, quote) => next.replaceAll(quote.ticker, formatEtfIdentity(quote).plain), text)
  return withKnownNames.replace(/\b([0-9][0-9A-Z]{5})\.(KS|KQ)\b/gi, '$1')
}

function renderEtfChips(text: string, quotes: EtfQuote[]): string {
  const candidates = buildEtfMentionCandidates(quotes)
    .filter(item => text.includes(item.label))

  if (candidates.length === 0) return e(text)

  const pattern = new RegExp(candidates.map(item => escapeRegExp(item.label)).join('|'), 'g')
  let cursor = 0
  let html = ''
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    html += e(text.slice(cursor, index))
    const candidate = candidates.find(item => item.label === match[0])
    html += candidate ? renderEtfChip(candidate.quote, candidate.label) : e(match[0])
    cursor = index + match[0].length
  }
  html += e(text.slice(cursor))
  return html
}

interface EtfMentionCandidate {
  quote: EtfQuote
  label: string
}

function buildEtfMentionCandidates(quotes: EtfQuote[]): EtfMentionCandidate[] {
  const candidates: EtfMentionCandidate[] = []
  const seen = new Set<string>()

  const add = (quote: EtfQuote, label: string) => {
    const normalized = label.trim()
    if (normalized.length < 2 || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push({ quote, label: normalized })
  }

  for (const quote of quotes) {
    const identity = formatEtfIdentity(quote)
    add(quote, identity.plain)
    if (quote.market === 'KR') {
      const code = quote.ticker.replace(/\.(KS|KQ)$/i, '')
      // Claude가 "KODEX 반도체 (091160)" (공백 포함) 로 쓰는 케이스도 허용.
      // 더 긴 후보가 먼저 매치되도록 공백 변형을 공백 없는 변형보다 먼저 등록.
      add(quote, `${identity.primary} (${code})`)
      add(quote, `${identity.primary}(${code})`)
      add(quote, identity.primary)
    } else {
      add(quote, quote.ticker)
      if (identity.secondary) add(quote, identity.secondary)
    }
  }

  return candidates.sort((a, b) => b.label.length - a.label.length)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderEtfChip(q: EtfQuote, matchedLabel?: string): string {
  const identity = formatEtfIdentity(q)
  const alert = /레버리지|인버스|선물/i.test(q.name) ? ' etf-chip-alert' : ''
  const market = q.market === 'US' ? ' etf-chip-us' : ''
  const displayAsMatched = q.market === 'US' && matchedLabel && matchedLabel !== identity.plain
  const content = displayAsMatched
    ? `<span class="etf-chip-name">${e(matchedLabel)}</span>`
    : `<span class="etf-chip-name">${e(identity.primary)}</span><span class="etf-chip-code">${e(identity.secondary.replace(/[()]/g, ''))}</span>`
  const cls = `etf-chip${market}${alert}`
  const attrs = etfLinkAttrs(q.ticker)
  if (!attrs) return `<span class="${cls}">${content}</span>`
  return `<a class="${cls} etf-link"${attrs}>${content}</a>`
}

function filled(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0
}

// ── 1·2 머리글 + 모자이크, 제목·부제 ────────────────────────────────────
// 모자이크는 미리보기 카드와 같은 그림(lib/preview/data-card.ts). 배치 상수가 1080×600 좌표라
// 같은 좌표계를 viewBox로 두고 화면 폭에 맞춰 줄인다.
const MOSAIC_VIEW_W = 1080
const MOSAIC_VIEW_H = 600
const MOSAIC_CAPTION = '어제 분석한 ETF 등락(Korea·USA, 레버리지·인버스 제외)'

// Market 머리글과 같은 날짜 표기: "2026년 10월 16일 금요일"
function mastheadDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${y}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일 ${koreanWeekday(date)}요일`
}

function renderMasthead(report: MorningReport, data: CollectedData, slots: AssetClassSlot[]): string {
  // 미리보기 카드와 같은 슬롯(card.key, 없으면 주제 슬롯)의 구성원 타일을 강조한다(Ruling 19·21).
  const slot = cardSlot(slots, report.card?.key)
  const tiles = buildMosaicTiles(data.quotes, slot ? new Set(slot.memberTickers) : null)
  const subline = report.cover?.subline
  return `<header class="cover" data-section="masthead">
  <div class="masthead">
    <div class="brand-lockup">
      <img class="brand-logo" src="${imBankLogoSrc()}" alt="iM뱅크">
      <div>
        <div class="brand-name">iM뱅크 AI Analyst</div>
        <div class="report-name">ETF Today</div>
      </div>
    </div>
    <div class="issue-date">${e(mastheadDate(data.date))}</div>
  </div>
  <figure class="mosaic">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MOSAIC_VIEW_W} ${MOSAIC_VIEW_H}" role="img" aria-label="${e(MOSAIC_CAPTION)}">${renderMosaicSvg(tiles, MOSAIC_VIEW_W, MOSAIC_VIEW_H)}</svg>
    <figcaption>${e(MOSAIC_CAPTION)}</figcaption>
  </figure>
  <h1>${renderReportText(report.cover?.headline ?? '', data.quotes)}</h1>
  ${filled(subline) ? `<p class="subline">${renderReportText(subline, data.quotes)}</p>` : ''}
</header>`
}

// ── 3 세 줄 요약 ──────────────────────────────────────────────────────
function renderSummary(report: MorningReport, quotes: EtfQuote[]): string {
  const rows: Array<[string, unknown]> = [
    ['해외 신호', report.summary?.overseas],
    ['국내 상태', report.summary?.domestic],
    ['오늘 핵심', report.summary?.focus],
  ]
  const visible = rows.filter((row): row is [string, string] => filled(row[1]))
  if (visible.length === 0) return ''
  return `<section class="summary-box" data-section="summary" aria-label="세 줄 요약">
  <ul class="summary-list">
    ${visible.map(([label, text]) => `<li class="summary-row"><span class="summary-label">${e(label)}</span><span class="summary-text">${renderReportText(text, quotes)}</span></li>`).join('\n    ')}
  </ul>
</section>`
}

// ── 4 자산군별 판단 재료 ──────────────────────────────────────────────
// 슬롯(중요도순)은 코드가 정하고, 대표 ETF 예시·등락도 코드가 렌더한다.
// 모델이 빠뜨린 슬롯은 숫자만 있는 카드로 그린다(마지막 축소판에서도 깨지지 않게).
function renderRepRow(rep: AssetRep): string {
  return `<li class="rep-row"><span class="rep-badge">예시</span><span>${renderNameAndCode(rep.ticker, rep.name, rep.market)}</span>${renderPct(rep.pct, 'rep-change')}</li>`
}

function renderAssetField(label: string, text: unknown, quotes: EtfQuote[]): string {
  if (!filled(text)) return ''
  return `<div class="asset-field"><div class="field-label">${e(label)}</div><p>${renderReportText(text, quotes)}</p></div>`
}

function renderAssetCards(report: MorningReport, quotes: EtfQuote[], slots: AssetClassSlot[]): string {
  if (slots.length === 0) return ''
  const cards = Array.isArray(report.assetCards) ? report.assetCards : []
  return `<section class="section" data-section="asset-cards">
  <div class="section-title">자산군별 판단 재료</div>
  <p class="section-note">어제 많이 움직인 자산군부터 놓았습니다. 대표 ETF는 흐름을 보여 주는 예시이며 추천 종목이 아닙니다.</p>
  <div class="asset-grid">
  ${slots.map(slot => {
    const card = cards.find(c => typeof c === 'object' && c !== null && c.key === slot.key)
    return `<article class="asset-card" data-asset="${e(slot.key)}">
    <div class="asset-label">${e(slot.label)}</div>
    <div class="field-label">어제 움직임</div>
    <ul class="rep-list">${slot.reps.map(renderRepRow).join('')}</ul>
    ${renderAssetField('이유', card?.reason, quotes)}${renderAssetField('갖고 있다면', card?.ifHolding, quotes)}${renderAssetField('새로 본다면', card?.ifConsidering, quotes)}
  </article>`
  }).join('\n  ')}
  </div>
</section>`
}

// ── 5 오늘 확인할 것 ──────────────────────────────────────────────────
function renderTodayChecks(report: MorningReport, quotes: EtfQuote[]): string {
  const checks = (Array.isArray(report.todayChecks) ? report.todayChecks : [])
    .filter(check => typeof check === 'object' && check !== null && filled(check.what))
  if (checks.length === 0) return ''
  const field = (label: string, text: unknown) => filled(text)
    ? `<div class="check-field"><span class="check-label">${e(label)}</span>${renderReportText(text, quotes)}</div>`
    : ''
  return `<section class="section" data-section="today-checks">
  <div class="section-title">오늘 확인할 것</div>
  <ol class="check-list">
  ${checks.map(check => `<li class="check-item">
    <div class="check-time">${e(check.time ?? '')}</div>
    <div>
      <div class="check-what">${renderReportText(check.what, quotes)}</div>
      ${field('비교 기준', check.baseline)}${field('어긋나면', check.invalidation)}
    </div>
  </li>`).join('\n  ')}
  </ol>
</section>`
}

// ── 6 레버리지·인버스 주의(그날 해당할 때만 모델이 쓴다) ──────────────────
function renderTacticalWarning(report: MorningReport, quotes: EtfQuote[]): string {
  if (!filled(report.tacticalWarning)) return ''
  return `<section class="section tactical" data-section="tactical">
  <div class="section-title">레버리지·인버스 주의</div>
  <p class="narrative">${renderReportText(report.tacticalWarning, quotes)}</p>
  <p class="tactical-note">레버리지·인버스 ETF는 하루 수익률을 추종하는 고위험 상품입니다. 장기 보유 목적, 원금 보존 성향, 상품 구조를 이해하지 못한 경우에는 적합하지 않을 수 있습니다.</p>
</section>`
}

// ── 7 펼쳐 보기: 국내·미국 ETF 표 ─────────────────────────────────────
function estimatedTradingValue(q: EtfQuote): number | null {
  if (q.price === null || q.volume === null || !Number.isFinite(q.price) || !Number.isFinite(q.volume)) return null
  return q.price * q.volume
}

function renderEtfTable(title: string, quotes: EtfQuote[]): string {
  if (quotes.length === 0) return ''
  const sorted = [...quotes].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
  const rows = sorted.map(q => {
    const value = estimatedTradingValue(q)
    return `<tr><td>${renderNameAndCode(q.ticker, q.name, q.market)}</td><td class="tag">${e(inferEtfTag(q))}</td><td class="num">${renderPct(q.changePercent)}</td><td class="num">${e(value !== null ? formatAmountForQuote(q, value) : '-')}</td></tr>`
  }).join('\n      ')
  return `<div class="table-title">${e(title)} (${sorted.length}개)</div>
  <div class="table-wrap">
    <table class="etf-table">
      <thead><tr><th>ETF</th><th>구분</th><th class="num">등락</th><th class="num">추정 거래대금</th></tr></thead>
      <tbody>
      ${rows}
      </tbody>
    </table>
  </div>`
}

function renderDetails(data: CollectedData): string {
  const kr = data.quotes.filter(q => q.market === 'KR')
  const us = data.quotes.filter(q => q.market === 'US')
  if (kr.length === 0 && us.length === 0) return ''
  return `<details class="section details" data-section="details">
  <summary>국내·미국 ETF 전체 등락 펼쳐 보기</summary>
  ${renderEtfTable('국내 ETF · 직전 한국 장', kr)}
  ${renderEtfTable('미국 ETF · 간밤 미국 장', us)}
  <p class="table-note">등락률 높은 순입니다. 추정 거래대금은 종가 × 거래량(국내 원, 미국 달러)으로 계산한 참고값입니다.</p>
</details>`
}

// ── 8 참고한 뉴스 · 데이터 기준 · 투자자 보호 기준(법적 고지는 맨 끝) ─────────
function formatKstDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })} KST`
}

function renderNewsSources(data: CollectedData): string {
  const usedNews = selectRelevantNews(data)
  if (usedNews.length === 0) return ''
  // C09: 입력으로 받은 뉴스 중 키워드로 고른 일부다 — '전략에 사용한' 인용 목록처럼 부르지 않고 원문 링크를 단다.
  return `<div class="section">
  <div class="section-title">참고한 뉴스</div>
  <p class="narrative" style="margin-bottom:12px">리포트 작성 때 입력으로 제공된 뉴스 중 일부입니다. 본문 각 문장과 1:1로 연결된 인용 목록은 아니며, 기사 본문을 확인하지 않은 단정 표현은 근거로 쓰지 않습니다.</p>
  <div class="source-list">
    ${usedNews.map(item => `
    <div class="source-item">
      ${/^https?:\/\//i.test(item.url) ? `<a class="source-link" href="${e(item.url)}" target="_blank" rel="noopener noreferrer">${e(item.title)}</a>` : `<strong>${e(item.title)}</strong>`}<br>
      ${e(item.source)} · ${e(formatKstDateTime(item.publishedAt))} · ${e(sourceDomain(item.url))}
    </div>`).join('')}
  </div>
</div>`
}

function selectRelevantNews(data: CollectedData): CollectedData['news'] {
  const relevant = /(ETF|반도체|엔비디아|삼성전자|SK하이닉스|금리|연준|FOMC|환율|관세|중국|Taiwan|China|Fed|rates?|semiconductor|Nvidia|bond|treasury)/i
  const reportDate = new Date(`${data.date}T00:00:00+09:00`)
  const minDate = new Date(reportDate)
  minDate.setDate(reportDate.getDate() - 14)
  return data.news
    .filter(item => relevant.test(item.title))
    .filter(item => !/bitcoin|ethereum|비트코인|이더리움|crypto/i.test(item.title))
    .filter(item => {
      const published = new Date(item.publishedAt)
      return Number.isNaN(published.getTime()) || published >= minDate
    })
    .slice(0, 5)
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function renderDataNote(): string {
  return `<div class="data-note">
  <strong>데이터 기준</strong><br>
  전일 종가 기준, NAV·괴리율은 주문 전 장중 iNAV 확인이 필요합니다. 국내 ETF는 직전 한국 장, 미국 ETF는 간밤 미국 장의 종가이며, 추정 거래대금은 종가 × 거래량으로 계산한 참고값입니다.
</div>`
}

function renderClientNotice(data: CollectedData): string {
  // ETF 고유 확인사항(총보수·환헤지·괴리율 등)은 여기에, 법률 근거 고지는
  // 마켓 리포트와 공유하는 lib/legal-disclaimer.ts 문구를 그대로 붙인다.
  const legalItems = LEGAL_DISCLAIMER_ITEMS.map(item => `<li>${e(item)}</li>`).join('\n    ')

  return `<div class="client-notice">
  <div class="notice-title">투자자 보호 기준</div>
  <div class="notice-text">이 자료는 iM뱅크 고객의 ETF 시장 이해를 돕는 시장정보입니다. ETF는 상품마다 기초지수, 총보수, 세금, 환헤지 여부, NAV/iNAV 대비 괴리율, 유동성이 다르므로 주문 전 개별 상품의 (간이)투자설명서와 거래 조건을 반드시 확인해야 합니다.</div>
  <div class="pill-row">
    <span class="pill">기준일 ${e(data.date)}</span>
  </div>
  <div class="legal-title">${e(LEGAL_DISCLAIMER_TITLE)}</div>
  <ul class="legal-list">
    ${legalItems}
  </ul>
</div>`
}

export function renderMorningHtml(report: MorningReport, data: CollectedData, options: RenderHtmlOptions = {}): string {
  const slots = buildAssetClassSlots(data.quotes)

  const body = `
${renderMasthead(report, data, slots)}

${renderSummary(report, data.quotes)}

${renderAssetCards(report, data.quotes, slots)}

${renderTodayChecks(report, data.quotes)}

${renderTacticalWarning(report, data.quotes)}

${renderDetails(data)}

${renderNewsSources(data)}

${renderDataNote()}
${renderClientNotice(data)}`

  const previewHeadline = polishKoreanText(report.cover?.headline ?? '')
  return baseHtml(`${data.date} ETF Today`, data.date, 'morning', body, {
    canonicalUrl: reportRouteUrl(data.date, options.publicBaseUrl),
    description: reportPreviewDescription(data.date, {
      overseas: filled(report.summary?.overseas) ? polishKoreanText(report.summary.overseas) : '',
      focus: filled(report.summary?.focus) ? polishKoreanText(report.summary.focus) : '',
    }),
    imageUrl: reportPreviewImageUrl(data.date, options.publicBaseUrl),
    previewTitle: reportPreviewTitle(previewHeadline),
  })
}

// ETF artifacts land under public/etf-reports/ to stay out of the way
// of the market report (public/reports/) that the daily pipeline writes.
export const ETF_REPORTS_PUBLIC_DIR = 'etf-reports'

export function saveReport(html: string, date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`saveReport: invalid date format "${date}"`)
  }
  const dir = path.join(process.cwd(), 'public', ETF_REPORTS_PUBLIC_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `${date}.html`
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, html, 'utf-8')
  console.log(`[renderer] 저장: ${filePath}`)
  return filePath
}

/**
 * 링크 미리보기 PNG(1080×1350) — 데이터 카드(모자이크 + 제목 + "○○를 갖고 있다면" + 한 줄, spec §4).
 * holdingLabel·tiles는 호출 쪽(scripts/run-etf.ts)이 report.card.key 자산군 슬롯에서 정한다.
 */
export async function saveReportPreviewImage(
  date: string,
  input: { headline: string; holdingLabel: string; line: string; tiles: MosaicTile[] },
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`saveReportPreviewImage: invalid date format "${date}"`)
  }
  const filePath = path.join(process.cwd(), 'public', ETF_REPORTS_PUBLIC_DIR, reportPreviewImageFilename(date))
  const svg = renderEtfCardSvg({
    date,
    headline: polishKoreanText(input.headline),
    holdingLabel: input.holdingLabel,
    line: polishKoreanText(input.line),
    tiles: input.tiles,
  })
  await saveCardPng(svg, filePath)
  console.log(`[renderer] 링크 프리뷰 이미지 저장: ${filePath}`)
  return filePath
}
