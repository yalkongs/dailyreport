// lib/renderer.ts
import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import type { MorningReport, CollectedData, EtfQuote, MacroContext, MorningStrategyInput } from './types'
import { buildMorningStrategyInput } from './morning-strategy'
import { getEtfByTicker } from './universe'
import { polishKoreanReportText } from './report-language'
import { googleFinanceQuoteUrl } from './etf-links'
import {
  REPORT_PREVIEW_IMAGE_HEIGHT,
  REPORT_PREVIEW_IMAGE_WIDTH,
  renderReportPreviewSvg,
  reportPreviewDescription,
  reportPreviewImageFilename,
  reportPreviewImageUrl,
  reportPreviewTitle,
  reportRouteUrl,
} from './report-preview'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const e = escapeHtml

// Brand logo. Filenames searched in priority order; first match wins.
// Mime type is detected from magic bytes so an extension/content
// mismatch (e.g. JPEG bytes saved with .png) still renders correctly.
const IM_BANK_LOGO_CANDIDATES = [
  path.join(process.cwd(), 'public', 'im-bank-logo.png'),
  path.join(process.cwd(), 'public', 'im-bank-logo.jpg'),
  path.join(process.cwd(), 'public', 'im-bank-signature-ko.jpg'),
]

interface RenderHtmlOptions {
  publicBaseUrl?: string
}

interface HtmlMetadata {
  canonicalUrl?: string
  description: string
  imageUrl: string
  previewTitle: string
}

const ETF_LABEL_OVERRIDES: Record<string, string> = {
  '379800.KS': 'KODEX 미국S&P500 (379800)',
  '379810.KS': 'KODEX 미국나스닥100 (379810)',
  '396500.KS': 'TIGER 반도체TOP10 (396500)',
  '453850.KS': 'ACE 미국30년국채액티브(H) (453850)',
  '476550.KS': 'TIGER 미국30년국채커버드콜액티브(H) (476550)',
  '429000.KS': 'TIGER 미국S&P500배당귀족 (429000)',
  '458730.KS': 'TIGER 미국배당다우존스 (458730)',
  '233740.KS': 'KODEX 코스닥150레버리지 (233740)',
  '251340.KS': 'KODEX 코스닥150선물인버스 (251340)',
}

function detectImageMime(buf: Buffer): string {
  // PNG: 89 50 4E 47, JPEG: FF D8 FF, WebP: RIFF....WEBP
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return 'image/jpeg' // safe default
}

function imBankLogoSrc(): string {
  for (const candidate of IM_BANK_LOGO_CANDIDATES) {
    try {
      const image = fs.readFileSync(candidate)
      const mime = detectImageMime(image)
      return `data:${mime};base64,${image.toString('base64')}`
    } catch {
      // try next candidate
    }
  }
  console.warn('[renderer] iM 뱅크 로고 파일을 찾을 수 없습니다. 빈 src 반환.')
  return ''
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
      --soft-mint: #f3faed;
      --warning: #b26b00;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif;
           background: var(--paper); color: var(--ink); max-width: 1080px; margin: 0 auto; padding: 26px 18px; }
    .cover { background: var(--panel); border: 1px solid var(--line); border-top: 8px solid var(--im-teal);
             border-radius: 8px; padding: 24px; margin-bottom: 26px; box-shadow: 0 14px 34px rgba(31, 54, 48, 0.08); }
    .masthead { display: flex; justify-content: space-between; gap: 18px; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 24px; }
    .brand-lockup { display: flex; gap: 14px; align-items: center; min-width: 0; }
    .brand-logo { display: block; width: 84px; height: 84px; object-fit: contain; flex: 0 0 auto; }
    .brand-name { font-size: 13px; color: var(--im-graphite); font-weight: 800; line-height: 1.2; }
    .report-name { font-size: 30px; line-height: 1; font-weight: 900; letter-spacing: 0; color: var(--ink); margin-top: 3px; }
    .issue-meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; color: var(--muted); font-size: 11px; font-weight: 800; }
    .issue-meta span { border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; background: #fbfcfa; }
    .cover-grid { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 24px; align-items: end; }
    .cover .badge { font-size: 12px; color: var(--im-teal-deep); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px; font-weight: 900; }
    .cover h1 { font-size: 42px; font-weight: 900; line-height: 1.15; margin-bottom: 12px; color: var(--ink); letter-spacing: 0; }
    .cover .subline { font-size: 17px; color: var(--muted); line-height: 1.65; max-width: 720px; }
    .cover-note { border-left: 4px solid var(--im-mint); padding: 14px 0 14px 14px; color: var(--im-graphite); font-size: 13px; line-height: 1.6; }
    .cover-note strong { display: block; color: var(--ink); font-size: 12px; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 6px; }
    .section { margin-bottom: 42px; }
    .section-title { position: relative; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink); letter-spacing: 1.4px; text-transform: uppercase;
                     border-top: 3px solid var(--ink); border-bottom: 1px solid var(--line); padding: 11px 0 10px; margin-bottom: 16px; font-weight: 900; }
    .section-title::before { content: ""; width: 32px; height: 7px; background: var(--im-teal); border-radius: 6px; }
    .narrative { font-size: 16px; line-height: 1.85; color: #27302d; }
    .strategy-hero { background: var(--ink); border: 0; border-left: 8px solid var(--im-teal);
                     border-radius: 8px; padding: 24px; margin-bottom: 30px; color: #ffffff; box-shadow: 0 16px 32px rgba(0, 0, 0, 0.12); }
    .client-notice { background: var(--panel); border: 1px solid var(--line); border-top: 5px solid var(--im-graphite);
                     border-radius: 8px; padding: 18px; margin-bottom: 28px; }
    .notice-title { font-size: 18px; font-weight: 900; color: var(--ink); margin-bottom: 8px; }
    .notice-text { font-size: 13px; color: var(--muted); line-height: 1.65; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .pill { border: 1px solid var(--line); border-radius: 6px; background: var(--soft-teal); color: var(--im-teal-deep);
            font-size: 11px; font-weight: 900; padding: 5px 8px; }
    .customer-grid, .preflight-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .customer-card, .preflight-item { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .customer-type, .preflight-label { font-size: 12px; color: var(--im-teal-deep); font-weight: 900; margin-bottom: 6px; }
    .customer-text, .preflight-text { font-size: 12px; color: var(--muted); line-height: 1.55; }
    .hero-kicker { font-size: 12px; letter-spacing: 1.6px; color: var(--im-mint); text-transform: uppercase; margin-bottom: 8px; font-weight: 900; }
    .hero-title { font-size: 28px; line-height: 1.32; font-weight: 900; margin-bottom: 16px; color: #ffffff; }
    .hero-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 14px 0; }
    .hero-item { border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 8px; padding: 13px; background: rgba(255, 255, 255, 0.08); }
    .hero-label { font-size: 11px; color: #cbd6d2; margin-bottom: 6px; font-weight: 800; }
    .hero-value { font-size: 15px; font-weight: 900; color: #ffffff; line-height: 1.45; }
    .avoid { margin-top: 12px; padding: 12px; background: #fff7e7; border-left: 4px solid var(--warning); border-radius: 6px; color: #493315; }
    .logic-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .logic-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .logic-label { font-size: 11px; color: var(--muted); margin-bottom: 7px; font-weight: 900; }
    .logic-text { font-size: 13px; color: #2d3531; line-height: 1.6; }
    .snapshot-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }
    .snapshot-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .snapshot-list { display: grid; gap: 9px; }
    .snapshot-row { display: grid; grid-template-columns: 86px 1fr; gap: 10px; align-items: start; }
    .snapshot-key { font-size: 11px; color: var(--im-teal-deep); font-weight: 900; }
    .snapshot-value { font-size: 13px; color: #2d3531; line-height: 1.55; overflow-wrap: anywhere; }
    .bridge-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .bridge-card { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--im-teal); border-radius: 8px; padding: 14px; }
    .bridge-step { font-size: 11px; color: var(--muted); font-weight: 900; margin-bottom: 6px; }
    .bridge-signal { font-size: 14px; font-weight: 900; color: var(--im-teal-deep); line-height: 1.5; margin-bottom: 7px; }
    .bridge-target { font-size: 13px; color: #2d3531; line-height: 1.6; }
    .match-table { display: grid; gap: 8px; }
    .match-row { display: grid; grid-template-columns: 0.9fr 1.1fr 1fr; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .match-head { font-size: 11px; color: var(--im-teal-deep); font-weight: 900; margin-bottom: 4px; }
    .match-body { font-size: 13px; color: #2d3531; line-height: 1.5; overflow-wrap: anywhere; }
    .heatmap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .heat-cell { border: 1px solid var(--line); border-radius: 8px; padding: 10px; min-height: 82px; box-shadow: inset 0 3px 0 rgba(0, 191, 165, 0.12); }
    .heat-name { font-size: 12px; font-weight: 900; color: #1c2421; line-height: 1.35; margin-bottom: 6px; }
    .heat-meta { font-size: 10px; color: #59655f; margin-bottom: 5px; }
    .heat-value { font-size: 18px; font-weight: 800; text-align: right; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .heat-sub { font-size: 10px; color: #59655f; margin-top: 4px; line-height: 1.4; }
    .heat-pos-3 { background: #d6efe2; }
    .heat-pos-2 { background: #e7f5ec; }
    .heat-pos-1 { background: #f4faf5; }
    .heat-flat { background: var(--panel); }
    .heat-neg-1 { background: #fff4ee; }
    .heat-neg-2 { background: #f8ded6; }
    .heat-neg-3 { background: #efc6bd; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; font-size: 10px; color: #5b6660; }
    .legend span { border: 1px solid var(--line); border-radius: 5px; padding: 3px 6px; background: var(--panel); }
    .scan-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .scan-label { font-size: 12px; color: var(--im-teal-deep); font-weight: 900; margin: 4px 0 10px; }
    .issue-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .issue-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .issue-title { font-size: 13px; font-weight: 900; color: var(--im-teal-deep); margin-bottom: 6px; }
    .issue-reason { font-size: 12px; color: #4e5a55; line-height: 1.5; margin-bottom: 8px; }
    .issue-links { display: flex; flex-wrap: wrap; gap: 5px; }
    .action-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .action-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; box-shadow: 0 8px 22px rgba(31, 54, 48, 0.06); }
    .action-panel-title { font-size: 12px; color: var(--ink); font-weight: 900; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid var(--im-teal); }
    .compact-etf-row { border-top: 1px solid #e2e7df; padding: 11px 0; min-height: 132px; display: grid; grid-template-rows: auto auto 1fr; }
    .compact-etf-row:first-of-type { border-top: 0; padding-top: 0; }
    .compact-head { display: grid; grid-template-columns: minmax(0, 1fr) 54px; gap: 10px; align-items: start; margin-bottom: 7px; }
    .compact-title { min-width: 0; }
    .compact-name { font-size: 13px; font-weight: 900; color: var(--im-teal-deep); line-height: 1.35; min-height: 36px;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
                    word-break: keep-all; overflow-wrap: anywhere; }
    .compact-code { font-size: 11px; color: #6b746e; margin-left: 4px; white-space: nowrap; }
    .compact-change { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .compact-note { font-size: 12px; color: #4e5a55; line-height: 1.45; margin-top: 7px; align-self: end; }
    .etf-chip { display: inline-flex; align-items: baseline; gap: 4px; border: 1px solid #bce5dc; background: var(--soft-teal);
                color: var(--im-teal-deep); border-radius: 6px; padding: 1px 6px; font-size: 0.92em; line-height: 1.45; white-space: nowrap; }
    .etf-chip-us { border-color: #c7d2e4; background: #f6f8fc; color: #2d4f77; }
    .etf-chip-alert { border-color: #e3c59b; background: #fff7e8; color: #7a4b10; }
    .etf-chip-name { font-weight: 800; }
    .etf-chip-code { color: #6b746e; font-size: 0.86em; }
    .watch-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
    .watch-item { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--im-mint); border-radius: 8px; padding: 16px; margin-bottom: 0; }
    .etf-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
                padding: 14px; margin-bottom: 10px; box-shadow: 0 8px 20px rgba(31, 54, 48, 0.05); }
    .etf-card-head { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; margin-bottom: 10px; }
    .etf-card-left .etf-primary { display: inline-block; font-size: 14px; font-weight: 900; color: var(--im-teal-deep); margin-right: 8px; }
    .etf-card-left .etf-secondary { display: inline-block; font-size: 13px; color: #626d67; }
    .etf-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
    .etf-tag { font-size: 10px; color: #52615b; background: var(--soft-mint); border: 1px solid #dfe6dc; border-radius: 5px; padding: 2px 6px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
    .metric-item { background: #fbfcfa; border: 1px solid #e0e5dc; border-radius: 6px; padding: 8px; min-width: 0; }
    .metric-label { font-size: 10px; color: #6b746e; margin-bottom: 3px; }
    .metric-value { font-size: 12px; font-weight: 800; color: #202824; overflow-wrap: anywhere; text-align: right; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .visual-stack { display: grid; gap: 7px; margin-top: 8px; }
    .bar-row { display: grid; grid-template-columns: 72px 1fr 48px; gap: 8px; align-items: center; font-size: 11px; color: #5b6660; }
    .metric-bar { position: relative; height: 8px; background: #edf1eb; border-radius: 999px; overflow: hidden; }
    .metric-zero { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #c3cbc3; }
    .metric-fill { position: absolute; top: 0; bottom: 0; border-radius: 999px; }
    .metric-pos { background: var(--im-teal); }
    .metric-neg { background: #c45145; }
    .micro-spark { display: inline-grid; grid-template-columns: repeat(8, 3px); gap: 2px; align-items: end; height: 18px; margin-right: 6px; vertical-align: middle; }
    .micro-spark i { display: block; width: 3px; background: var(--im-teal); border-radius: 2px 2px 0 0; }
    .change-up { color: var(--im-teal-deep); font-weight: 900; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .change-down { color: #b94135; font-weight: 800; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .anomaly-card { background: #fff7f4; border: 1px solid #e0b8ac; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
    .anomaly-badge { display: inline-block; background: #f2d4ca; color: #9d3329;
                     font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-right: 6px; }
    .watch-title { font-weight: 900; margin-bottom: 10px; color: #1c2421; line-height: 1.45; }
    .watch-body { font-size: 14px; color: #4e5a55; line-height: 1.6; }
    .macro-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .macro-item { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; min-width: 0; }
    .macro-label { font-size: 10px; color: #6b746e; margin-bottom: 6px; white-space: nowrap; }
    .macro-value { font-size: 18px; font-weight: 900; text-align: left; white-space: nowrap; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .score-row { display: grid; grid-template-columns: 150px 74px 1fr; gap: 10px; align-items: start;
                 padding: 11px 0; border-bottom: 1px solid #d6ddd3; }
    .score-label { font-weight: 900; color: #1c2421; }
    .score-value { color: var(--im-teal-deep); font-weight: 900; }
    .score-detail { font-size: 13px; color: #53605a; line-height: 1.5; }
    .strategy-map { display: grid; gap: 12px; }
    .strategy-item { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; box-shadow: 0 8px 20px rgba(31, 54, 48, 0.05); }
    .strategy-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .story-card { background: var(--panel); border: 1px solid var(--line); border-left: 8px solid var(--im-mint);
                  border-radius: 8px; padding: 22px; margin-bottom: 30px; box-shadow: 0 12px 26px rgba(31, 54, 48, 0.07); }
    .story-title { font-size: 27px; line-height: 1.3; font-weight: 900; margin-bottom: 12px; color: #111514; }
    .story-body { font-size: 15px; line-height: 1.75; color: #2d3531; }
    .story-acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
    .story-act { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fbfcfa; }
    .story-act-label { font-size: 11px; color: var(--im-teal-deep); font-weight: 900; margin-bottom: 6px; }
    .story-act-value { font-size: 15px; font-weight: 900; color: #151a18; line-height: 1.45; margin-bottom: 6px; }
    .story-act-note { font-size: 12px; color: #4e5a55; line-height: 1.5; }
    .spine { display: grid; gap: 10px; }
    .spine-step { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 12px; align-items: stretch; }
    .spine-marker { background: var(--im-teal-deep); color: #ffffff; border-radius: 8px; padding: 10px 8px;
                    display: grid; align-content: center; text-align: center; min-height: 92px; }
    .spine-marker strong { font-size: 13px; line-height: 1.25; }
    .spine-marker span { display: block; font-size: 10px; color: #dbe8e1; margin-top: 4px; }
    .spine-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
    .spine-kicker { font-size: 11px; color: var(--muted); font-weight: 900; margin-bottom: 6px; }
    .spine-headline { font-size: 15px; color: #1c2421; font-weight: 900; line-height: 1.5; margin-bottom: 8px; }
    .spine-detail { font-size: 13px; color: #4e5a55; line-height: 1.6; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e5dc; }
    .spine-detail-label { font-size: 11px; color: #6b746e; font-weight: 800; margin-bottom: 4px; }
    .character-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .character-card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; box-shadow: 0 8px 20px rgba(31, 54, 48, 0.05); }
    .character-head { display: flex; justify-content: space-between; gap: 10px; align-items: start; margin-bottom: 8px; }
    .character-role { font-size: 11px; color: var(--im-teal-deep); font-weight: 900; margin-bottom: 4px; }
    .character-name { font-size: 14px; color: #1c2421; font-weight: 900; line-height: 1.35; }
    .character-code { font-size: 11px; color: #6b746e; margin-top: 2px; }
    .character-move { font-size: 14px; font-weight: 800; white-space: nowrap; }
    .character-metrics { grid-template-columns: 0.72fr 1fr 0.72fr; gap: 6px; }
    .character-metrics .metric-item { padding: 7px 6px; }
    .character-metrics .metric-label { white-space: nowrap; }
    .character-metrics .metric-value { font-size: 11px; white-space: nowrap; overflow-wrap: normal; }
    .resolution-grid { display: grid; gap: 10px; }
    .resolution-row { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px;
                      display: grid; grid-template-columns: 110px 1fr 1fr; gap: 10px; }
    .resolution-label { font-size: 12px; color: #ffffff; border-radius: 4px; padding: 3px 8px; font-weight: 800; width: fit-content; }
    .stance { color: #ffffff; border-radius: 4px; padding: 3px 8px; font-size: 12px; font-weight: 800; }
    .stance-prefer { background: var(--im-teal-deep); }
    .stance-watch { background: #b97918; }
    .stance-neutral { background: #647067; }
    .stance-caution { background: #b34739; }
    .tickers { font-size: 12px; color: var(--im-teal-deep); margin-bottom: 8px; font-weight: 800; }
    .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
    .action-box { background: #fbfcfa; border: 1px solid #e0e5dc; border-radius: 6px; padding: 10px; min-width: 0; }
    .action-box-primary { grid-column: 1 / -1; background: var(--soft-teal); border-color: #bce5dc; }
    .action-label { font-size: 11px; color: var(--im-teal-deep); margin-bottom: 5px; font-weight: 900; }
    .action-text { font-size: 12px; color: #2d3531; line-height: 1.55; overflow-wrap: anywhere; }
    .bar-row strong { text-align: right; font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .risk-alert { border-left: 4px solid #d18a22; padding: 12px; background: #fff4df; margin-bottom: 8px; border-radius: 6px; }
    .source-list { display: grid; gap: 8px; }
    .source-item { font-size: 13px; line-height: 1.5; border-bottom: 1px solid #d6ddd3; padding-bottom: 8px; color: #38413d; }
    .source-item a { color: var(--im-teal-deep); overflow-wrap: anywhere; }
    .etf-link { color: inherit; text-decoration: none; border-bottom: 1px solid rgba(0, 143, 127, 0.35); }
    .etf-link:hover { color: var(--im-teal-deep); border-bottom-color: currentColor; }
    .etf-link:focus-visible { outline: 2px solid var(--im-teal); outline-offset: 2px; border-radius: 4px; }
    .etf-title-link, .compact-link, .character-link { border-bottom-color: transparent; }
    .etf-chip.etf-link, .etf-tag.etf-link { border-bottom: 1px solid #bce5dc; }
    .methodology details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .methodology summary { cursor: pointer; font-weight: 900; color: var(--im-teal-deep); }
    .term-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; }
    .term-item { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .term-name { font-size: 12px; font-weight: 900; color: var(--im-teal-deep); margin-bottom: 5px; }
    .term-body { font-size: 12px; color: #4e5a55; line-height: 1.55; }
    .data-note { font-size: 13px; color: var(--muted); line-height: 1.7; margin-top: 16px; background: var(--panel);
                 border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .closing { font-size: 15px; color: var(--im-teal-deep); font-style: italic;
               border-top: 1px solid var(--line); padding-top: 24px; margin-top: 40px; }
    @media (max-width: 720px) {
      body { padding: 18px 12px; }
      .cover { padding: 26px 0 22px; margin-bottom: 22px; }
      .masthead, .cover-grid { grid-template-columns: 1fr; display: grid; }
      .masthead { align-items: start; }
      .issue-meta { justify-content: flex-start; }
      .cover { padding: 18px; }
      .cover-note { border-left: 0; border-top: 4px solid var(--im-mint); padding: 12px 0 0; }
      .section { margin-bottom: 30px; }
      .strategy-hero, .client-notice, .logic-card, .bridge-card, .snapshot-panel, .match-row, .issue-card, .action-panel, .watch-item, .etf-card, .strategy-item, .term-item, .data-note { padding: 12px; }
      .hero-grid, .logic-grid, .snapshot-grid, .bridge-grid, .match-row, .scan-columns, .issue-grid, .action-board, .watch-grid, .action-grid, .term-grid, .customer-grid, .preflight-grid { grid-template-columns: 1fr; }
      .macro-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .macro-item { padding: 10px; }
      .story-acts, .spine-step, .character-grid, .resolution-row { grid-template-columns: 1fr; }
      .spine-marker { min-height: 0; text-align: left; }
      .heatmap-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .character-metrics { grid-template-columns: 0.72fr 1fr 0.72fr; }
      .etf-card-head { grid-template-columns: 1fr; gap: 6px; }
      .etf-card-head > .change-up, .etf-card-head > .change-down { justify-self: start; }
      .etf-card-left .etf-primary, .compact-name, .bridge-target, .watch-body, .action-text { max-width: 100%; overflow-wrap: anywhere; }
      .compact-head { grid-template-columns: minmax(0, 1fr) 54px; align-items: start; }
      .etf-chip { max-width: 100%; white-space: normal; vertical-align: baseline; overflow-wrap: anywhere; }
      .etf-chip-name { overflow-wrap: anywhere; }
      .bar-row { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; }
      .bar-row .metric-bar { grid-column: 1 / -1; }
      .score-row { grid-template-columns: 1fr; gap: 4px; }
      .cover h1 { font-size: 30px; }
    }
    @media (max-width: 430px) {
      body { padding: 14px 10px; }
      .brand-logo { width: 68px; height: 68px; }
      .report-name { font-size: 25px; }
      .cover h1 { font-size: 25px; }
      .cover .subline, .narrative { font-size: 15px; }
      .hero-title { font-size: 20px; }
      .metric-grid { gap: 6px; }
      .metric-item { padding: 7px; }
      .metric-value { font-size: 11px; }
      .macro-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
      .macro-item { padding: 9px; }
      .macro-label { font-size: 9px; margin-bottom: 5px; }
      .macro-value { font-size: 16px; }
      .character-metrics { gap: 4px; }
      .character-metrics .metric-item { padding: 6px 4px; }
      .character-metrics .metric-label { font-size: 9px; }
      .character-metrics .metric-value { font-size: 10px; }
      .compact-head { grid-template-columns: minmax(0, 1fr) 54px; gap: 6px; }
      .micro-spark { grid-template-columns: repeat(6, 3px); }
      .micro-spark i:nth-child(n+7) { display: none; }
      .strategy-head { display: grid; grid-template-columns: 1fr; gap: 6px; }
      .stance { justify-self: start; }
      .snapshot-row { grid-template-columns: 1fr; gap: 3px; }
      .heatmap-grid { grid-template-columns: 1fr; }
      .heat-cell { min-height: 0; }
    }
  </style>
</head>
<body>
${body}
</body>
</html>`
}

function renderEtfCard(q: EtfQuote): string {
  const pct = q.changePercent
  const pctStr = pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '미확보'
  const cls = pct !== null && pct >= 0 ? 'change-up' : 'change-down'
  const price = q.price !== null ? q.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '미확보'
  const volume = q.volume !== null ? q.volume.toLocaleString('ko-KR') : '미확보'
  const estimatedTradingValue = q.tradingValue !== undefined
    ? q.tradingValue
    : q.price !== null && q.volume !== null
      ? q.price * q.volume
      : null
  const metrics = [
    renderMetricItem('가격', price),
    renderMetricItem('거래량', volume),
    estimatedTradingValue !== null ? renderMetricItem(q.market === 'US' ? '추정거래대금(USD)' : '거래대금(원)', formatAmountForQuote(q, estimatedTradingValue)) : '',
    q.aum !== null ? renderMetricItem(q.market === 'KR' ? '순자산(원)' : 'AUM(USD)', formatAmountForQuote(q, q.aum)) : q.market === 'KR' ? renderMetricItem('순자산(원)', '미확보') : '',
    q.market === 'US' ? renderMetricItem('유동성', inferLiquidity(q)) : '',
    q.market === 'US' && q.prev20AvgVolume !== null ? renderMetricItem('평균거래량', q.prev20AvgVolume.toLocaleString('ko-KR')) : '',
    q.nav !== null ? renderMetricItem('NAV', q.nav.toLocaleString('ko-KR', { maximumFractionDigits: 2 })) : '',
    q.premiumDiscount !== null ? renderMetricItem('괴리율', `${q.premiumDiscount > 0 ? '+' : ''}${q.premiumDiscount.toFixed(2)}%`) : '',
  ].filter(Boolean).slice(0, 6).join('')
  const bars = [
    renderMetricBar('등락률', q.changePercent, 8, '%'),
    q.premiumDiscount !== null ? renderMetricBar('괴리율', q.premiumDiscount, 1.5, '%') : '',
    q.dailyIndexGap !== undefined && q.dailyIndexGap !== null ? renderMetricBar('지수대비', q.dailyIndexGap, 5, '%p') : '',
  ].filter(Boolean).join('')
  const tags = [
    q.market === 'KR' ? '국내' : '미국',
    inferEtfTag(q),
    q.underlyingIndexName ? q.underlyingIndexName : '',
  ].filter(Boolean).slice(0, 3)

  return `<div class="etf-card">
  <div class="etf-card-head">
    <div class="etf-card-left">
      ${renderQuoteIdentityLink(q)}
      <div class="etf-tags">${tags.map(tag => `<span class="etf-tag">${e(tag)}</span>`).join('')}</div>
    </div>
    <span class="${cls}">${e(pctStr)}</span>
  </div>
  ${metrics ? `<div class="metric-grid">${metrics}</div>` : ''}
  ${bars ? `<div class="visual-stack">${bars}</div>` : ''}
</div>`
}

function renderMetricItem(label: string, value: string): string {
  return `<div class="metric-item"><div class="metric-label">${e(label)}</div><div class="metric-value">${e(value)}</div></div>`
}

function inferLiquidity(q: EtfQuote): string {
  const volume = q.volume ?? 0
  if (volume >= 10_000_000) return '높음'
  if (volume >= 1_000_000) return '보통'
  if (volume > 0) return '낮음'
  return '미확보'
}

function renderMetricBar(label: string, value: number | null | undefined, maxAbs: number, suffix: string): string {
  if (value === null || value === undefined) return ''
  const width = Math.min(50, Math.abs(value) / maxAbs * 50)
  const left = value >= 0 ? 50 : 50 - width
  const cls = value >= 0 ? 'metric-pos' : 'metric-neg'
  const display = `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`
  return `<div class="bar-row">
    <span>${e(label)}</span>
    <div class="metric-bar"><span class="metric-zero"></span><span class="metric-fill ${cls}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></div>
    <strong>${e(display)}</strong>
  </div>`
}

function inferEtfTag(q: EtfQuote): string {
  const name = q.name.toLowerCase()
  if (/레버리지|2x|인버스|inverse/.test(name)) return '전술'
  if (/반도체|semiconductor|ai|바이오|bio/.test(name)) return '테마'
  if (/채권|bond|국채|tlt|ief|shy/.test(name)) return '채권'
  if (/금|gold|원유|oil|commodity|원자재/.test(name)) return '원자재'
  return '지수'
}

function isTacticalEtf(q: EtfQuote): boolean {
  return /레버리지|인버스|2x|선물인버스|inverse/i.test(q.name)
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

function renderQuoteIdentityLink(q: EtfQuote, className = 'etf-link etf-title-link'): string {
  const identity = formatEtfIdentity(q)
  return renderEtfLink(
    q.ticker,
    `<span class="etf-primary">${e(identity.primary)}</span><span class="etf-secondary">${e(identity.secondary)}</span>`,
    className
  )
}

function renderPlainTickerLink(ticker: string, label: string, className = 'etf-link'): string {
  return renderEtfLink(ticker, e(label), className)
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

function renderMacroItem(label: string, value: string): string {
  return `<div class="macro-item">
  <div class="macro-label">${e(label)}</div>
  <div class="macro-value">${e(value)}</div>
</div>`
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatMacro(macro: MacroContext): string {
  return `<div class="macro-grid">
  ${renderMacroItem('USD/KRW', formatNumber(macro.usdKrw, 0))}
  ${renderMacroItem('VIX', formatNumber(macro.vix, 2))}
  ${renderMacroItem('US 10Y', macro.us10y ? `${macro.us10y.toFixed(2)}%` : '-')}
  ${renderMacroItem('WTI', formatNumber(macro.wti, 1))}
  ${renderMacroItem('Gold', formatNumber(macro.gold, 0))}
  ${renderMacroItem('Fear&Greed', formatNumber(macro.fearGreed, 0))}
</div>`
}

function renderStrategyDashboard(strategy: MorningStrategyInput, quotes: EtfQuote[]): string {
  const headwinds = strategy.scores
    .filter(score => ['ratesPressure', 'dollarPressure', 'inflationPressure', 'volatilityPressure'].includes(score.key) && score.score > 0)
    .slice(0, 3)
    .map(scoreSummaryText)
  const tailwinds = strategy.scores
    .filter(score => ['riskAppetite', 'koreaTransmission'].includes(score.key) && score.score > 0)
    .slice(0, 2)
    .map(scoreSummaryText)
  const confidenceText = strategy.regime.confidence >= 75 ? '높음' : strategy.regime.confidence >= 60 ? '중간 이상' : '중간 이하'
  return `<div class="section">
  <div class="section-title">오늘 시장 국면 판단</div>
  <p class="narrative" style="margin-bottom:16px">${e(strategy.regime.summary)} 전략 확신도는 ${e(confidenceText)}(${e(String(strategy.regime.confidence))}/100)입니다. ${e(headwinds.length ? `제한 요인: ${headwinds.join(' · ')}` : `우호 요인: ${tailwinds.join(' · ') || '뚜렷한 방향성 제한'}`)}</p>
  ${strategy.scores.map(score => `
    <div class="score-row">
      <div class="score-label">${e(score.displayLabel)}</div>
      <div class="score-value">${e(score.displayLevel)}</div>
      <div class="score-detail">${renderReportText(`${score.stance} · ${score.evidence.map(item => `${item.label} ${item.value}`).join(' / ')}`, quotes)}</div>
  </div>`).join('')}
</div>`
}

function scoreSummaryText(score: MorningStrategyInput['scores'][number]): string {
  if (score.displayLabel.endsWith(score.displayLevel)) return score.displayLabel
  return `${score.displayLabel} ${score.displayLevel}`
}

function stanceClass(stance: string): string {
  if (stance === '선호') return 'stance-prefer'
  if (stance === '관찰') return 'stance-watch'
  if (stance === '경계') return 'stance-caution'
  return 'stance-neutral'
}

function displayStance(stance: string): string {
  return stance === '선호' ? '확인 우선' : stance
}

function renderStrategyMap(strategy: MorningStrategyInput, quotes: EtfQuote[]): string {
  return `<div class="section">
  <div class="section-title">ETF군별 전략 지도</div>
  <div class="strategy-map">
  ${strategy.etfGroupStrategies.map(item => `
    <div class="strategy-item">
      <div class="strategy-head">
        <strong>${e(item.group)}</strong>
        <span class="stance ${stanceClass(item.stance)}">${e(displayStance(item.stance))}</span>
      </div>
      <div class="tickers">${item.tickers.map(ticker => renderStrategyTicker(ticker, quotes)).join(' · ')}</div>
      <div class="watch-body">${renderReportText(publicText(item.rationale), quotes)}</div>
      <div class="action-grid">
        <div class="action-box"><div class="action-label">점검 기준</div><div class="action-text">${renderReportText(publicText(item.actionGuide), quotes)}</div></div>
        <div class="action-box"><div class="action-label">확인</div><div class="action-text">${renderReportText(publicText(item.confirmSignal), quotes)}</div></div>
        <div class="action-box"><div class="action-label">피할 점</div><div class="action-text">${renderReportText(publicText(item.avoid), quotes)}</div></div>
      </div>
    </div>`).join('')}
  </div>
</div>`
}

function renderStrategyTicker(ticker: string, quotes: EtfQuote[]): string {
  const quote = quotes.find(q => q.ticker === ticker)
  if (quote) return renderPlainTickerLink(quote.ticker, formatEtfIdentity(quote).plain)
  return renderPlainTickerLink(ticker, formatKnownTicker(ticker))
}

function formatKnownTicker(ticker: string): string {
  const override = ETF_LABEL_OVERRIDES[ticker]
  if (override) return override
  const def = getEtfByTicker(ticker)
  if (def?.market === 'KR') return `${def.name} (${ticker.replace(/\.(KS|KQ)$/i, '')})`
  if (def) return `${def.ticker} ${def.name}`
  if (/\.(KS|KQ)$/i.test(ticker)) return ticker.replace(/\.(KS|KQ)$/i, '')
  return ticker
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
  return withKnownNames.replace(/\b(\d{6})\.(KS|KQ)\b/gi, '$1')
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

function publicText(text: string): string {
  return polishKoreanText(text)
}

function renderClientNotice(data: CollectedData, strategy: MorningStrategyInput): string {
  return `<div class="client-notice">
  <div class="notice-title">투자자 보호 기준</div>
  <div class="notice-text">이 자료는 iM뱅크 고객의 ETF 시장 이해를 돕는 시장정보입니다. 고객별 투자성향, 투자목적, 보유상품, 손실감내 수준을 반영한 투자권유가 아니며 주문 전 상품설명서, 총보수, 세금, 환헤지 여부, NAV/iNAV, 괴리율을 별도로 확인해야 합니다.</div>
  <div class="pill-row">
    <span class="pill">기준일 ${e(data.date)}</span>
    <span class="pill">생성 ${e(formatKstDateTime(strategy.generatedAt))}</span>
  </div>
</div>`
}

function renderExecutiveSummary(strategy: MorningStrategyInput): string {
  return `<div class="strategy-hero">
  <div class="hero-kicker">ETF Today Decision Frame</div>
  <div class="hero-title">${e(publicText(strategy.executiveSummary.title))}</div>
  <div class="hero-grid">
    <div class="hero-item"><div class="hero-label">시장 태도</div><div class="hero-value">${e(strategy.executiveSummary.tacticalStance)}</div></div>
    <div class="hero-item"><div class="hero-label">확인 우선 ETF군</div><div class="hero-value">${e(publicText(strategy.executiveSummary.preferredGroups.join(' · ') || '없음'))}</div></div>
    <div class="hero-item"><div class="hero-label">보류/경계</div><div class="hero-value">${e(publicText([...strategy.executiveSummary.watchGroups, ...strategy.executiveSummary.cautionGroups].slice(0, 4).join(' · ') || '없음'))}</div></div>
  </div>
  <div class="avoid"><strong>오늘 피해야 할 실수</strong><br>${e(publicText(strategy.executiveSummary.avoidToday))}</div>
</div>`
}

function renderTodayChecklist(report: MorningReport, quotes: EtfQuote[]): string {
  const labels = [
    { scope: '개장 30분', condition: '조건', action: '행동', avoid: '피할 점' },
    { scope: '환율/금리', condition: '조건', action: '행동', avoid: '피할 점' },
    { scope: '주문 리스크', condition: '조건', action: '행동', avoid: '피할 점' },
  ]

  return `<div class="section">
  <div class="section-title">오늘의 실행 체크리스트</div>
  <div class="watch-grid">
  ${report.todayWatch.items.slice(0, 3).map((item, index) => {
    const label = labels[index] ?? labels[2]
    return `<div class="watch-item">
    <div class="watch-title">${e(label.scope)} · ${renderReportText(item.title, quotes)}</div>
    <div class="action-grid">
      <div class="action-box action-box-primary"><div class="action-label">${e(label.condition)}</div><div class="action-text">${renderReportText(item.body, quotes)}</div></div>
      <div class="action-box"><div class="action-label">${e(label.action)}</div><div class="action-text">${e(checklistActionText(index))}</div></div>
      <div class="action-box"><div class="action-label">${e(label.avoid)}</div><div class="action-text">${e(checklistAvoidText(index))}</div></div>
    </div>
  </div>`
  }).join('')}
  </div>
</div>`
}

function renderStoryOpening(report: MorningReport, data: CollectedData): string {
  const characters = selectStoryCharacters(data.quotes)
  const primary = characters.primary
  const gate = characters.gate
  const primaryName = primary ? formatEtfIdentity(primary).plain : '국내 성장 ETF'
  const gateName = gate ? formatEtfIdentity(gate).plain : '환노출 해외 ETF'
  const usdKrw = data.macro.usdKrw !== null && data.macro.usdKrw !== undefined
    ? `USD/KRW ${formatNumber(data.macro.usdKrw, 0)}`
    : '환율'

  return `<div class="story-card">
  <div class="hero-kicker">Story of the Day</div>
  <div class="story-title">오늘의 초점은 ${renderReportText(report.cover.headline, data.quotes)}</div>
  <div class="story-body">${renderReportText(report.cover.subline, data.quotes)} ${e('이 리포트는 선행 신호, 환율 변수, 상품별 실행 조건 순서로 읽습니다.')}</div>
  <div class="story-acts">
    <div class="story-act">
      <div class="story-act-label">1막 · 선행 신호</div>
      <div class="story-act-value">${renderReportText(shortReportText(firstSentence(report.overnightBrief.narrative), 96), data.quotes)}</div>
      <div class="story-act-note">${renderReportText(`${primaryName}의 거래대금이 이 신호를 확인해 주는지 살핍니다.`, data.quotes)}</div>
    </div>
    <div class="story-act">
      <div class="story-act-label">2막 · 환율 변수</div>
      <div class="story-act-value">${e(usdKrw)}</div>
      <div class="story-act-note">${renderReportText(`${gateName}는 기초지수 성과와 환율 부담을 분리해서 봅니다.`, data.quotes)}</div>
    </div>
    <div class="story-act">
      <div class="story-act-label">3막 · 국내 검증</div>
      <div class="story-act-value">개장 30분 거래대금</div>
      <div class="story-act-note">가격보다 거래대금과 괴리율을 먼저 확인합니다.</div>
    </div>
  </div>
</div>`
}

function renderStorySpine(report: MorningReport, data: CollectedData): string {
  const steps = [
    {
      label: '발단',
      act: '1막',
      kicker: '해외 선행 신호',
      text: report.overnightBrief.narrative,
    },
    {
      label: '갈등',
      act: '2막',
      kicker: '환율과 국내 거래의 제약',
      text: report.overnightBrief.krImpact,
    },
    {
      label: '해결',
      act: '3막',
      kicker: '상품별 실행 조건',
      text: report.usEtfHighlights.sectorNarrative,
    },
  ]

  return `<div class="section">
  <div class="section-title">Story Spine</div>
  <div class="spine">
    ${steps.map(step => renderSpineStep(step, data.quotes)).join('')}
  </div>
</div>`
}

function renderSpineStep(
  step: { label: string; act: string; kicker: string; text: string },
  quotes: EtfQuote[]
): string {
  const first = firstSentence(step.text)
  const headline = shortReportText(first, 110)
  const detail = spineDetailText(step.text, first, headline)
  return `<div class="spine-step">
  <div class="spine-marker"><strong>${e(step.label)}</strong><span>${e(step.act)}</span></div>
  <div class="spine-card">
    <div class="spine-kicker">${e(step.kicker)}</div>
    <div class="spine-headline">${renderReportText(headline, quotes)}</div>
    ${detail ? `<div class="spine-detail"><div class="spine-detail-label">근거 설명</div>${renderReportText(detail, quotes)}</div>` : ''}
  </div>
</div>`
}

function spineDetailText(text: string, first: string, headline: string): string {
  const normalizedText = normalizeWhitespace(text)
  const normalizedFirst = normalizeWhitespace(first)
  const normalizedHeadline = normalizeWhitespace(headline)
  if (normalizedText === normalizedHeadline) return ''
  if (normalizedHeadline !== normalizedFirst) return normalizedText
  if (!normalizedText.startsWith(normalizedFirst)) return normalizedText
  return normalizedText.slice(normalizedFirst.length).trim()
}

function firstSentence(text: string): string {
  const normalized = normalizeWhitespace(text)
  const match = normalized.match(/^(.+?[.!?])(?:\s|$)/)
  return match ? match[1] : normalized
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface StoryCharacters {
  primary: EtfQuote | undefined
  gate: EtfQuote | undefined
  alternative: EtfQuote | undefined
  warning: EtfQuote | undefined
}

function selectStoryCharacters(quotes: EtfQuote[]): StoryCharacters {
  const kr = quotes.filter(q => q.market === 'KR')
  const primary = findQuoteByName(kr, /반도체|AI|소프트웨어|바이오/) ??
    kr.filter(q => !isTacticalEtf(q) && q.changePercent !== null)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0]
  const gatePool = kr.filter(q => q !== primary)
  const gate = gatePool.find(q => q.name === 'TIGER 미국나스닥100') ??
    gatePool.find(q => q.name === 'TIGER 미국S&P500') ??
    findQuoteByName(gatePool, /미국나스닥100|미국S&P500|미국S&amp;P500/) ??
    findQuoteByName(kr.filter(q => q !== primary), /미국/) ??
    primary
  const alternative = findQuoteByName(kr.filter(q => q !== primary && q !== gate), /국채|장기채|채권|TLT/) ??
    findQuoteByName(kr.filter(q => q !== primary && q !== gate), /배당|커버드콜/) ??
    kr.find(q => !isTacticalEtf(q) && q !== primary && q !== gate)
  const warning = kr.find(q => isTacticalEtf(q) && /레버리지/.test(q.name)) ?? kr.find(isTacticalEtf)

  return { primary, gate, alternative, warning }
}

function findQuoteByName(quotes: EtfQuote[], pattern: RegExp): EtfQuote | undefined {
  return quotes.find(q => pattern.test(q.name))
}

function shortReportText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const sentenceEnd = findSentenceEndBefore(text, maxLength)
  if (sentenceEnd >= 40) return text.slice(0, sentenceEnd + 1)
  return `${text.slice(0, maxLength).trim()}...`
}

function findSentenceEndBefore(text: string, maxLength: number): number {
  const limit = Math.min(text.length, maxLength)
  let found = -1
  for (let i = 0; i < limit; i += 1) {
    const char = text[i]
    if (char !== '.' && char !== '!' && char !== '?') continue
    const next = text[i + 1]
    if (char === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(next ?? '')) continue
    if (next && !/\s/.test(next)) continue
    found = i
  }
  return found
}

function renderStoryCharacters(data: CollectedData): string {
  const characters = selectStoryCharacters(data.quotes)
  const cards = [
    characters.primary ? renderCharacterCard(characters.primary, '성장 신호 확인', '미국 성장주 흐름이 국내 시장의 실제 수요로 이어지는지 확인하는 상품입니다. 거래대금이 함께 늘어야 의미가 커집니다.') : '',
    characters.gate && characters.gate !== characters.primary ? renderCharacterCard(characters.gate, '환율 영향 점검', '같은 해외 지수 흐름이라도 원화 환율에 따라 체감 수익률이 달라집니다. 기초지수와 환율을 분리해서 봅니다.') : '',
    characters.alternative ? renderCharacterCard(characters.alternative, '대안 관찰', '성장주 흐름이 약하거나 금리가 내려갈 때 함께 살펴볼 수 있는 상품입니다. 주도 상품으로 단정하지 않습니다.') : '',
    characters.warning ? renderCharacterCard(characters.warning, '과열 경계', '레버리지와 인버스는 가격 변동을 크게 만듭니다. 일반 장기투자 점검 대상이 아니라 장중 전술형 관찰 대상으로 분리합니다.') : '',
  ].filter(Boolean)

  if (cards.length === 0) return ''

  return `<div class="section">
  <div class="section-title">Characters In The Story</div>
  <div class="character-grid">
    ${cards.join('')}
  </div>
</div>`
}

function renderCharacterCard(q: EtfQuote, role: string, note: string): string {
  const identity = formatEtfIdentity(q)
  const change = q.changePercent !== null ? `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '미확보'
  const moveClass = q.changePercent !== null && q.changePercent >= 0 ? 'change-up' : 'change-down'
  const metrics = [
    q.changePercent !== null ? renderMetricItem('등락률', change) : '',
    q.tradingValue !== undefined && q.tradingValue !== null ? renderMetricItem('거래대금', compactKrwAmount(q.tradingValue)) : '',
    q.premiumDiscount !== null ? renderMetricItem('괴리율', `${q.premiumDiscount > 0 ? '+' : ''}${q.premiumDiscount.toFixed(2)}%`) : '',
    q.nav !== null ? renderMetricItem('NAV', q.nav.toLocaleString('ko-KR', { maximumFractionDigits: 2 })) : '',
  ].filter(Boolean).slice(0, 3).join('')

  return `<div class="character-card">
  <div class="character-head">
    <div>
      <div class="character-role">${e(role)}</div>
      ${renderEtfLink(q.ticker, `<div class="character-name">${e(identity.primary)}</div><div class="character-code">${e(identity.secondary)}</div>`, 'etf-link character-link')}
    </div>
    <div class="character-move ${moveClass}">${e(change)}</div>
  </div>
  ${metrics ? `<div class="metric-grid character-metrics">${metrics}</div>` : ''}
  <div class="watch-body">${e(publicText(note))}</div>
</div>`
}

function renderStoryResolution(data: CollectedData): string {
  const characters = selectStoryCharacters(data.quotes)
  const success = uniqueQuotes([characters.primary, characters.gate]).map(q => formatEtfIdentity(q).plain).join(' · ')
  const delay = characters.alternative ? formatEtfIdentity(characters.alternative).plain : '장기채·배당 ETF'
  const overheat = characters.warning ? formatEtfIdentity(characters.warning).plain : '레버리지·인버스 ETF'

  return `<div class="section">
  <div class="section-title">How The Story Resolves</div>
  <div class="resolution-grid">
    <div class="resolution-row">
      <div><span class="resolution-label stance-prefer">연결 확인</span></div>
      <div class="action-text">${renderReportText(success || '국내 성장 ETF', data.quotes)}</div>
      <div class="action-text">해외 성장주 흐름과 국내 거래대금이 함께 나타나면 관찰 우선순위를 높입니다.</div>
    </div>
    <div class="resolution-row">
      <div><span class="resolution-label stance-watch">확인 보류</span></div>
      <div class="action-text">${renderReportText(delay, data.quotes)}</div>
      <div class="action-text">성장주 흐름이 국내 거래대금으로 이어지지 않으면 대안 관찰 대상으로 분류합니다.</div>
    </div>
    <div class="resolution-row">
      <div><span class="resolution-label stance-caution">과열 경계</span></div>
      <div class="action-text">${renderReportText(overheat, data.quotes)}</div>
      <div class="action-text">괴리율 확대, 얇은 호가, 환율 재상승이 겹치면 일반 검토 대상에서 제외합니다.</div>
    </div>
  </div>
</div>`
}

function uniqueQuotes(quotes: Array<EtfQuote | undefined>): EtfQuote[] {
  const seen = new Set<string>()
  const out: EtfQuote[] = []
  for (const quote of quotes) {
    if (!quote || seen.has(quote.ticker)) continue
    seen.add(quote.ticker)
    out.push(quote)
  }
  return out
}

function checklistActionText(index: number): string {
  if (index === 0) return '거래대금이 함께 늘어날 때만 관찰 우선순위를 높입니다.'
  if (index === 1) return '환율과 금리가 불리하면 추가 편입 판단을 서두르지 않습니다.'
  return '괴리율이 커지면 시장가보다 지정가를 우선합니다.'
}

function checklistAvoidText(index: number): string {
  if (index === 0) return '해외 ETF 강세만 보고 국내 ETF를 장 시작 직후 추격하지 않습니다.'
  if (index === 1) return 'USD/KRW 부담 구간에서 환노출 ETF를 한 번에 늘리지 않습니다.'
  return '레버리지·인버스는 일반 장기투자 점검 대상에서 제외합니다.'
}

function findQuote(quotes: EtfQuote[], ticker: string): EtfQuote | undefined {
  return quotes.find(q => q.ticker === ticker)
}

function fmtQuoteMove(q: EtfQuote | undefined): string {
  if (!q || q.changePercent === null) return '미확보'
  return `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`
}

function quoteLabel(q: EtfQuote | undefined, fallback: string): string {
  return q ? formatEtfIdentity(q).plain : fallback
}

function renderGlobalKrMatching(data: CollectedData): string {
  const pairs = [
    { theme: '미국 S&P 500', global: ['SPY', 'VOO', 'IVV'], kr: ['360750.KS', '379800.KS'], check: '환율과 S&P 500 선물 방향을 함께 확인합니다.' },
    { theme: '미국 나스닥 100', global: ['QQQ'], kr: ['133690.KS', '379810.KS'], check: '성장주 강세가 원화 환율 부담을 상쇄하는지 확인합니다.' },
    { theme: '반도체', global: ['SOXX', 'SMH'], kr: ['091160.KS', '396500.KS', '381180.KS'], check: '미국 반도체 흐름과 국내 거래대금 증가를 함께 확인합니다.' },
    { theme: '장기 미국채', global: ['TLT', 'IEF'], kr: ['453850.KS', '476550.KS'], check: '미국 10년 금리와 TLT 방향이 일치하는지 확인합니다.' },
    { theme: '배당성장', global: ['SCHD', 'VIG'], kr: ['458730.KS', '429000.KS'], check: '방어 수요와 환율 수준을 분리해서 판단합니다.' },
  ]

  const rows = pairs.map(pair => {
    const globalQuotes = pair.global.map(ticker => findQuote(data.quotes, ticker)).filter(Boolean) as EtfQuote[]
    const krQuotes = pair.kr.map(ticker => findQuote(data.quotes, ticker)).filter(Boolean) as EtfQuote[]
    const globalText = globalQuotes.length ? globalQuotes.map(formatMatchQuote).join(' · ') : pair.global.map(ticker => renderPlainTickerLink(ticker, ticker)).join(' · ')
    const krText = krQuotes.length ? krQuotes.map(formatMatchQuote).join(' · ') : pair.kr.map(ticker => renderPlainTickerLink(ticker, formatKnownTicker(ticker))).join(' · ')
    return `<div class="match-row">
      <div><div class="match-head">테마</div><div class="match-body">${e(pair.theme)}</div></div>
      <div><div class="match-head">글로벌 신호</div><div class="match-body">${globalText}</div></div>
      <div><div class="match-head">국내 실행 확인</div><div class="match-body">${krText}<br>${e(pair.check)}</div></div>
    </div>`
  }).join('')

  return `<div class="section">
  <div class="section-title">상세 글로벌-KR ETF 매칭</div>
  <div class="methodology">
    <details>
      <summary>상세 글로벌-KR ETF 매칭 보기</summary>
      <div class="match-table">${rows}</div>
    </details>
  </div>
</div>`
}

function formatMatchQuote(q: EtfQuote): string {
  const identity = formatEtfIdentity(q)
  return `${renderPlainTickerLink(q.ticker, identity.plain)} ${e(fmtQuoteMove(q))}`
}

function renderGlobalKoreaBridge(data: CollectedData): string {
  const soxx = findQuote(data.quotes, 'SOXX')
  const qqq = findQuote(data.quotes, 'QQQ')
  const tlt = findQuote(data.quotes, 'TLT')
  const semiconductor = findQuote(data.quotes, '091160.KS')
  const bio = findQuote(data.quotes, '364970.KS')
  const sp500Kr = findQuote(data.quotes, '360750.KS')
  const leverage = findQuote(data.quotes, '122630.KS')
  const inverse = findQuote(data.quotes, '252670.KS')

  const bridgeItems = [
    {
      step: '미국 기술주 신호',
      signal: `SOXX ${fmtQuoteMove(soxx)} · QQQ ${fmtQuoteMove(qqq)}`,
      target: `${quoteLabel(semiconductor, '국내 반도체 ETF')}와 ${quoteLabel(bio, '국내 성장 테마 ETF')}는 장 초반 거래대금 증가가 확인 포인트입니다.`,
    },
    {
      step: '환율 영향',
      signal: `USD/KRW ${formatNumber(data.macro.usdKrw, 0)}`,
      target: `${quoteLabel(sp500Kr, '국내 상장 해외 ETF')}는 보유분 환율 효과와 추가 편입 비용을 분리해서 봅니다.`,
    },
    {
      step: '변동성 실행 리스크',
      signal: `TLT ${fmtQuoteMove(tlt)} · VIX ${formatNumber(data.macro.vix, 2)}`,
      target: `${quoteLabel(leverage, '레버리지 ETF')}와 ${quoteLabel(inverse, '인버스 ETF')}는 기초지수 방향과 NAV를 먼저 확인합니다.`,
    },
  ]

  return `<div class="section">
  <div class="section-title">해외 신호가 국내 ETF에 미치는 영향</div>
  <div class="bridge-grid">
    ${bridgeItems.map(item => `
    <div class="bridge-card">
      <div class="bridge-step">${e(item.step)}</div>
      <div class="bridge-signal">${renderReportText(item.signal, data.quotes)}</div>
      <div class="bridge-target">${renderReportText(item.target, data.quotes)}</div>
    </div>`).join('')}
  </div>
</div>`
}

function renderMarketHeatmap(data: CollectedData): string {
  const groups = [
    { name: '미국 대표지수', meta: 'SPY·QQQ·IWM', tickers: ['SPY', 'QQQ', 'IWM'] },
    { name: '반도체·AI', meta: 'SOXX·SMH·국내 반도체', tickers: ['SOXX', 'SMH', '091160.KS', '396500.KS'] },
    { name: '한국 ETF', meta: '수집 KR 50 평균', tickers: data.quotes.filter(q => q.market === 'KR').map(q => q.ticker).slice(0, 80) },
    { name: '환노출 해외', meta: '국내 상장 미국 ETF', tickers: ['360750.KS', '133690.KS', '379800.KS', '379810.KS'] },
    { name: '채권', meta: 'TLT·IEF·BND', tickers: ['TLT', 'IEF', 'BND'] },
    { name: '금·원자재', meta: 'GLD·USO·DBC', tickers: ['GLD', 'USO', 'DBC'] },
    { name: '에너지', meta: 'XLE·원유', tickers: ['XLE', '261220.KS'] },
    { name: '레버리지/인버스', meta: '국내 전술형', tickers: ['122630.KS', '252670.KS', '233740.KS', '251340.KS'] },
  ]

  const cells = groups
    .map(group => {
      const values = group.tickers
        .map(ticker => findQuote(data.quotes, ticker)?.changePercent)
        .filter((value): value is number => value !== null && value !== undefined)
      if (values.length === 0) return ''
      const avg = values.reduce((a, b) => a + b, 0) / values.length
      const sampleText = values.length <= 2 ? `참고값 · ${values.length}개` : `${values.length}개 평균`
      return `<div class="heat-cell ${heatClass(avg)}">
        <div class="heat-name">${e(group.name)}</div>
        <div class="heat-meta">${e(group.meta)} · ${e(sampleText)}</div>
        <div class="heat-value">${e(`${avg > 0 ? '+' : ''}${avg.toFixed(2)}%`)}</div>
      </div>`
    })
    .filter(Boolean)
    .join('')

  if (!cells) return ''

  return `<div class="section">
  <div class="section-title">ETF Market Heatmap</div>
  <div class="heatmap-grid">${cells}</div>
  <div class="legend"><span>1D 기준</span><span>-3% 이하</span><span>-1~-3%</span><span>-1~+1%</span><span>+1~+3%</span><span>+3% 이상</span></div>
  <p class="heat-sub">모든 수치는 1D 기준입니다. 표본 수 2개 이하는 시장 대표값이 아니라 참고값입니다. 5D 흐름은 12개월 시계열 수집 후 표시합니다.</p>
</div>`
}

function heatClass(value: number): string {
  if (value >= 3) return 'heat-pos-3'
  if (value >= 1) return 'heat-pos-2'
  if (value > 0) return 'heat-pos-1'
  if (value <= -3) return 'heat-neg-3'
  if (value <= -1) return 'heat-neg-2'
  if (value < 0) return 'heat-neg-1'
  return 'heat-flat'
}

function renderIssueEtfs(data: CollectedData): string {
  const issues = [
    { title: '반도체·AI', reason: '미국 반도체 흐름이 국내 IT ETF 거래대금으로 이어지는지 확인합니다.', tickers: ['SOXX', 'SMH', '091160.KS', '396500.KS'] },
    { title: '배당·인컴', reason: '변동성 확대 구간에서 방어 수요가 커지는지 확인합니다.', tickers: ['SCHD', 'VIG', '458730.KS'] },
    { title: '장기채·금리', reason: '미국 10년 금리 변화가 장기채 ETF 가격에 반영되는지 봅니다.', tickers: ['TLT', 'IEF', '453850.KS'] },
    { title: '환노출 미국주식', reason: '기초지수 성과와 USD/KRW 효과를 분리해 판단합니다.', tickers: ['360750.KS', '133690.KS', '379810.KS'] },
    { title: '레버리지·인버스', reason: '장 초반 NAV·괴리율 확인 전 추격 진입을 피합니다.', tickers: ['122630.KS', '252670.KS', '233740.KS'] },
    { title: '금·원자재', reason: '지정학 뉴스와 달러 방향이 원자재 ETF에 같은 신호를 주는지 봅니다.', tickers: ['GLD', 'SLV', 'USO', '132030.KS'] },
  ]

  const cards = issues.map(issue => {
    const linked = issue.tickers
      .map(ticker => findQuote(data.quotes, ticker))
      .filter(Boolean) as EtfQuote[]
    const fallbackLinks = issue.tickers
      .slice(0, 3)
      .map(ticker => renderPlainTickerLink(ticker, ticker, 'etf-tag etf-link'))
      .join('')
    const links = linked.length
      ? linked.slice(0, 4).map(q => renderEtfLink(q.ticker, `${e(formatEtfIdentity(q).plain)} ${e(fmtQuoteMove(q))}`, 'etf-tag etf-link')).join('')
      : fallbackLinks
    return `<div class="issue-card">
      <div class="issue-title">${e(issue.title)}</div>
      <div class="issue-reason">${e(issue.reason)}</div>
      <div class="issue-links">${links}</div>
    </div>`
  }).join('')

  return `<div class="section">
  <div class="section-title">오늘 이슈별 관찰 ETF</div>
  <p class="narrative" style="margin-bottom:12px">아래 ETF는 이슈 확인용 관찰 대상이며, 추천의 의미가 아닙니다.</p>
  <div class="issue-grid">${cards}</div>
</div>`
}

function renderRiskAlerts(strategy: MorningStrategyInput, quotes: EtfQuote[]): string {
  if (strategy.riskAlerts.length === 0) return ''
  return `<div class="section">
  <div class="section-title">Risk Checklist</div>
  ${strategy.riskAlerts.map(alert => `
    <div class="risk-alert">
      <div class="watch-title">${renderReportText(alert.title, quotes)}</div>
      <div class="watch-body">${renderReportText(alert.body, quotes)}</div>
    </div>`).join('')}
</div>`
}

function renderKrEtfScan(quotes: EtfQuote[]): string {
  const topKr = [...quotes]
    .filter(q => q.market === 'KR' && q.changePercent !== null && !isTacticalEtf(q))
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))

  if (topKr.length === 0) return ''

  return `<div class="section">
  <div class="section-title">KR ETF Market Scanner — 참고 데이터</div>
  <p class="narrative" style="margin-bottom:16px">국내 ETF 스캐너는 KRX OpenAPI 일별매매정보를 기준으로 정리한 참고 데이터입니다. 레버리지·인버스 ETF는 일반 순위에서 제외하고 별도 경고 섹션에 표시합니다.</p>
  <div class="scan-columns">
    <div>
      <div class="scan-label">전술형 제외 상승률 상위 5</div>
      ${topKr.slice(0, 5).map(renderEtfCard).join('')}
    </div>
    <div>
      <div class="scan-label">전술형 제외 하락률 하위 5</div>
      ${topKr.slice(-5).reverse().map(renderEtfCard).join('')}
    </div>
  </div>
</div>`
}

function renderTacticalEtfWarning(quotes: EtfQuote[]): string {
  const tactical = [...quotes]
    .filter(q => q.market === 'KR' && q.changePercent !== null && isTacticalEtf(q))
    .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
    .slice(0, 5)

  if (tactical.length === 0) return ''

  return `<div class="section">
  <div class="section-title">Tactical ETF Warning Board</div>
  <p class="narrative" style="margin-bottom:16px">레버리지·인버스 ETF는 일간 수익률을 추종하는 고위험 전술형 상품입니다. 장기 보유 목적, 원금보존 성향, 상품 구조를 이해하지 못한 고객에게 적합하지 않을 수 있습니다.</p>
  <div class="action-board">
    ${tactical.map(q => {
      const identity = formatEtfIdentity(q)
      const tradingValue = q.tradingValue !== undefined && q.tradingValue !== null ? compactKrwAmount(q.tradingValue) : '미확보'
      const premium = q.premiumDiscount !== null ? `${q.premiumDiscount > 0 ? '+' : ''}${q.premiumDiscount.toFixed(2)}%` : '미확보'
      const gap = q.dailyIndexGap !== undefined && q.dailyIndexGap !== null ? `${q.dailyIndexGap > 0 ? '+' : ''}${q.dailyIndexGap.toFixed(2)}%p` : '미확보'
      return `<div class="action-panel">
        <div class="compact-head">
          <div class="compact-title">
            <div class="compact-name">${renderEtfLink(q.ticker, `${e(identity.primary)}<span class="compact-code">${e(identity.secondary)}</span>`, 'etf-link compact-link')}</div>
            <div class="etf-tags"><span class="etf-tag">전술형</span><span class="etf-tag">일반 순위 제외</span></div>
          </div>
          <span class="compact-change ${q.changePercent !== null && q.changePercent >= 0 ? 'change-up' : 'change-down'}">${e(fmtQuoteMove(q))}</span>
        </div>
        <div class="metric-grid">
          ${renderMetricItem('거래대금(원)', tradingValue)}
          ${renderMetricItem('괴리율', premium)}
          ${renderMetricItem('지수대비', gap)}
        </div>
        <div class="compact-note">기초지수 방향과 NAV 괴리율이 맞지 않으면 등락률이 커도 추격하지 않습니다.</div>
      </div>`
    }).join('')}
  </div>
</div>`
}

function renderDomesticActionBoard(quotes: EtfQuote[]): string {
  const kr = quotes.filter(q => q.market === 'KR')
  const krCore = kr.filter(q => !isTacticalEtf(q))
  const withPremium = krCore
    .filter(q => q.premiumDiscount !== null)
    .sort((a, b) => Math.abs(b.premiumDiscount ?? 0) - Math.abs(a.premiumDiscount ?? 0))
    .slice(0, 3)
  const withTradingValue = krCore
    .filter(q => q.tradingValue !== undefined && q.tradingValue !== null)
    .sort((a, b) => (b.tradingValue ?? 0) - (a.tradingValue ?? 0))
    .slice(0, 3)
  const withIndexGap = krCore
    .filter(q => q.dailyIndexGap !== undefined && q.dailyIndexGap !== null)
    .sort((a, b) => Math.abs(b.dailyIndexGap ?? 0) - Math.abs(a.dailyIndexGap ?? 0))
    .slice(0, 3)

  if (withPremium.length === 0 && withTradingValue.length === 0 && withIndexGap.length === 0) return ''

  return `<div class="section">
  <div class="section-title">Domestic ETF Action Board</div>
  <div class="action-board">
    <div class="action-panel">
      <div class="action-panel-title">유동성 집중</div>
      ${withTradingValue.map(q => renderCompactEtfRow(q, '거래대금 상위 상품입니다. 체결 여건은 양호하지만 장 초반 가격 변동을 먼저 확인합니다.', q.tradingValue ?? 0, '거래대금(원)', compactKrwAmount(q.tradingValue ?? 0), 'liquidity')).join('')}
    </div>
    <div class="action-panel">
      <div class="action-panel-title">가격 괴리</div>
      ${withPremium.map(q => renderCompactEtfRow(q, 'NAV와 체결가 간격을 먼저 점검합니다.', q.premiumDiscount ?? 0, '괴리율', `${(q.premiumDiscount ?? 0) > 0 ? '+' : ''}${(q.premiumDiscount ?? 0).toFixed(2)}%`, 'premium')).join('')}
    </div>
    <div class="action-panel">
      <div class="action-panel-title">기초지수 대비</div>
      ${withIndexGap.map(q => renderCompactEtfRow(q, `${q.underlyingIndexName ?? '기초지수'} 대비 ETF 가격 반응을 확인합니다.`, q.dailyIndexGap ?? 0, '지수대비', `${(q.dailyIndexGap ?? 0) > 0 ? '+' : ''}${(q.dailyIndexGap ?? 0).toFixed(2)}%p`, 'gap')).join('')}
    </div>
  </div>
</div>`
}

function renderCompactEtfRow(q: EtfQuote, note: string, magnitude: number, label: string, value: string, kind: 'liquidity' | 'premium' | 'gap'): string {
  const identity = formatEtfIdentity(q)
  const change = q.changePercent !== null ? `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%` : '미확보'
  const barMax = kind === 'liquidity' ? 2e12 : kind === 'premium' ? 1.5 : 5
  const barValue = kind === 'liquidity' ? Math.min(magnitude, barMax) : magnitude
  const spark = renderMicroSpark(Math.abs(magnitude), kind)
  return `<div class="compact-etf-row">
    <div class="compact-head">
      <div class="compact-title">
        <div class="compact-name">${renderEtfLink(q.ticker, `${e(identity.primary)}<span class="compact-code">${e(identity.secondary)}</span>`, 'etf-link compact-link')}</div>
        <div class="etf-tags"><span class="etf-tag">${e(inferEtfTag(q))}</span><span class="etf-tag">${e(q.market)}</span></div>
      </div>
      <span class="compact-change ${q.changePercent !== null && q.changePercent >= 0 ? 'change-up' : 'change-down'}">${e(change)}</span>
    </div>
    <div class="bar-row">
      <span>${e(label)}</span>
      ${kind === 'liquidity'
        ? `<div class="metric-bar"><span class="metric-fill metric-pos" style="left:0;width:${Math.min(100, barValue / barMax * 100).toFixed(1)}%"></span></div>`
        : renderMetricBarTrack(barValue, barMax)}
      <strong>${e(value)}</strong>
    </div>
    <div class="compact-note">${spark}${e(note)}</div>
  </div>`
}

function renderMetricBarTrack(value: number, maxAbs: number): string {
  const width = Math.min(50, Math.abs(value) / maxAbs * 50)
  const left = value >= 0 ? 50 : 50 - width
  const cls = value >= 0 ? 'metric-pos' : 'metric-neg'
  return `<div class="metric-bar"><span class="metric-zero"></span><span class="metric-fill ${cls}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></div>`
}

function renderMicroSpark(value: number, kind: 'liquidity' | 'premium' | 'gap'): string {
  const scale = kind === 'liquidity' ? Math.min(1, value / 2e12) : Math.min(1, value / (kind === 'premium' ? 1.5 : 5))
  const heights = [0.25, 0.4, 0.32, 0.55, 0.48, 0.7, 0.62, 0.85].map(v => Math.max(3, Math.round((v * 0.45 + scale * 0.55) * 18)))
  return `<span class="micro-spark" aria-hidden="true">${heights.map(h => `<i style="height:${h}px"></i>`).join('')}</span>`
}

function renderDataCoverage(strategy: MorningStrategyInput): string {
  return `<div class="data-note">
  <strong>데이터 기준</strong><br>
  생성 시각: ${e(formatKstDateTime(strategy.generatedAt))}<br>
  ETF 시세: ${strategy.dataCoverage.quoteCount}개(US ${strategy.dataCoverage.usQuoteCount}, KR ${strategy.dataCoverage.krQuoteCount}) · 뉴스: ${strategy.dataCoverage.newsCount}개<br>
  ${e(strategy.dataCoverage.sourceNote)}
</div>`
}

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
  return `<div class="section">
  <div class="section-title">전략에 사용한 뉴스 출처</div>
  <p class="narrative" style="margin-bottom:12px">뉴스는 가격과 거시지표를 보완하는 참고 자료로만 사용합니다. 기사 본문을 확인하지 않은 단정 표현은 전략 근거로 쓰지 않습니다.</p>
  <div class="source-list">
    ${usedNews.map(item => `
    <div class="source-item">
      <strong>${e(item.title)}</strong><br>
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

export function renderMorningHtml(report: MorningReport, data: CollectedData, options: RenderHtmlOptions = {}): string {
  const strategy = buildMorningStrategyInput(data)
  const logoSrc = imBankLogoSrc()
  const topUs = [...data.quotes]
    .filter(q => q.market === 'US' && q.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))

  const body = `
<div class="cover">
  <div class="masthead">
    <div class="brand-lockup">
      <img class="brand-logo" src="${logoSrc}" alt="iM뱅크">
      <div>
        <div class="brand-name">iM뱅크 AI Analyst</div>
        <div class="report-name">ETF Today</div>
      </div>
    </div>
    <div class="issue-meta">
      <span>ETF 전용 보고서</span>
      <span>Morning Edition</span>
      <span>${e(data.date)}</span>
    </div>
  </div>
  <div class="cover-grid">
    <div>
      <div class="badge">ETF TODAY · MARKET DECISION NOTE</div>
      <h1>${renderReportText(report.cover.headline, data.quotes)}</h1>
      <div class="subline">${renderReportText(report.cover.subline, data.quotes)}</div>
    </div>
    <div class="cover-note"><strong>Source</strong>iM뱅크 AI Analyst가 ETF 시장 데이터와 KRX 지표를 바탕으로 작성한 ETF 전용 보고서입니다.</div>
  </div>
</div>

${renderExecutiveSummary(strategy)}

${renderStoryOpening(report, data)}

${renderStorySpine(report, data)}

${renderStoryCharacters(data)}

${renderStoryResolution(data)}

${renderTodayChecklist(report, data.quotes)}

${renderDomesticActionBoard(data.quotes)}

${renderTacticalEtfWarning(data.quotes)}

${renderStrategyDashboard(strategy, data.quotes)}

<div class="section">
  <div class="section-title">Macro Corner</div>
  ${formatMacro(data.macro)}
</div>

${renderGlobalKoreaBridge(data)}

${renderGlobalKrMatching(data)}

${renderStrategyMap(strategy, data.quotes)}

${renderMarketHeatmap(data)}

<div class="section">
  <div class="section-title">간밤 시장 요약</div>
  <p class="narrative">${renderReportText(report.overnightBrief.narrative, data.quotes)}</p>
  <p class="narrative" style="margin-top:10px;color:#7b8ec8">${renderReportText(report.overnightBrief.krImpact, data.quotes)}</p>
</div>

<div class="section">
  <div class="section-title">Sector Narrative</div>
  <p class="narrative">${renderReportText(report.usEtfHighlights.sectorNarrative, data.quotes)}</p>
</div>

${renderIssueEtfs(data)}

${renderKrEtfScan(data.quotes)}

<div class="section">
  <div class="section-title">US ETF Market Scanner — 상승률 상위 5</div>
  <p class="narrative" style="margin-bottom:16px">미국 ETF 스캐너는 해외 신호 확인용입니다. 추정거래대금은 가격과 거래량을 곱한 USD 기준 참고값입니다.</p>
  ${topUs.slice(0, 5).map(renderEtfCard).join('')}
</div>

<div class="section">
  <div class="section-title">US ETF Market Scanner — 하락률 하위 5</div>
  ${topUs.slice(-5).reverse().map(renderEtfCard).join('')}
</div>

${renderRiskAlerts(strategy, data.quotes)}

${renderNewsSources(data)}

<div class="closing">${renderReportText(report.closingLine, data.quotes)}</div>
${renderDataCoverage(strategy)}
${renderClientNotice(data, strategy)}`

  const previewHeadline = polishKoreanText(report.cover.headline)
  const previewSubline = polishKoreanText(report.cover.subline)
  return baseHtml(`${data.date} ETF Today`, data.date, 'morning', body, {
    canonicalUrl: reportRouteUrl(data.date, options.publicBaseUrl),
    description: reportPreviewDescription(data.date, previewSubline),
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

export async function saveReportPreviewImage(
  date: string,
  headline: string,
  subline?: string,
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`saveReportPreviewImage: invalid date format "${date}"`)
  }
  const dir = path.join(process.cwd(), 'public', ETF_REPORTS_PUBLIC_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const filename = reportPreviewImageFilename(date)
  const filePath = path.join(dir, filename)
  const svg = renderReportPreviewSvg(date, polishKoreanText(headline), subline ? polishKoreanText(subline) : undefined)
  await sharp(Buffer.from(svg)).png().toFile(filePath)
  console.log(`[renderer] 링크 프리뷰 이미지 저장: ${filePath}`)
  return filePath
}
