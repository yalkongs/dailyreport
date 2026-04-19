// Shared B-style preview card renderer used by both the ETF and Market
// pipelines. Produces a 1080x1350 PNG suitable for Telegram link
// previews (sendPhoto) and as an OG image fallback.
//
// The card layout:
//   - Top-left: iM Bank logo (180x180)
//   - Section label (e.g. "ETF Today" / "Market Today")
//   - Headline (up to 4 wrapped lines)
//   - Accent bar + subline (up to 3 wrapped lines)
//   - Date + edition badges (bottom-left)
//   - Footer text

import * as fs from 'fs'
import sharp from 'sharp'
import { loadBrandLogoDataUri } from './brand-logo'

export const PREVIEW_WIDTH = 1080
export const PREVIEW_HEIGHT = 1350

export interface PreviewCardData {
  date: string         // YYYY-MM-DD (displayed in left badge)
  sectionLabel: string // big bold label, e.g. "ETF Today" or "Market Today"
  edition: string      // right badge, e.g. "MORNING EDITION" / "MORNING DIGEST"
  footer: string       // bottom-left small grey text
  headline: string     // main headline
  subline: string      // single subline string (will be wrapped)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().replace(/\s+/g, ' ').split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!word) continue
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars))
        if (lines.length >= maxLines) return lines
      }
      continue
    }
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
      if (lines.length >= maxLines) return lines
    } else {
      current = next
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}

export function renderPreviewCardSvg(data: PreviewCardData): string {
  const logoDataUri = loadBrandLogoDataUri()
  const titleLines = wrapText(data.headline, 15, 4)
  const sublineLines = wrapText(data.subline, 26, 3)
  const titleStartY = 600
  const sublineStartY = titleStartY + titleLines.length * 78 + 66

  // Edition badge auto-widens for longer labels (e.g. "MORNING DIGEST" vs "MORNING EDITION")
  const editionBadgeW = Math.max(262, data.edition.length * 14 + 56)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" viewBox="0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}" role="img" aria-label="${escapeXml(data.sectionLabel + ' · ' + data.headline)}">
  <defs>
    <linearGradient id="brandRibbon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00bfa5"/>
      <stop offset="54%" stop-color="#84d96b"/>
      <stop offset="100%" stop-color="#00bfa5"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#17443d" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" fill="#f5f7f3"/>
  <rect x="72" y="74" width="936" height="1202" rx="34" fill="#ffffff" stroke="#d9e0dc" stroke-width="2" filter="url(#softShadow)"/>
  <rect x="72" y="74" width="936" height="16" rx="8" fill="url(#brandRibbon)"/>

  <image x="96" y="110" width="180" height="180" href="${logoDataUri}" preserveAspectRatio="xMinYMin meet"/>

  <text x="120" y="450" fill="#111817" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="58" font-weight="900" letter-spacing="0">${escapeXml(data.sectionLabel)}</text>

  ${titleLines.map((line, i) => `<text x="120" y="${titleStartY + i * 78}" fill="#111817" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="62" font-weight="900" letter-spacing="0">${escapeXml(line)}</text>`).join('\n  ')}

  <rect x="120" y="${sublineStartY - 42}" width="132" height="10" rx="5" fill="#00bfa5"/>
  ${sublineLines.map((line, i) => `<text x="120" y="${sublineStartY + i * 42}" fill="#4e5a55" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="0">${escapeXml(line)}</text>`).join('\n  ')}

  <g transform="translate(120 1150)">
    <rect x="0" y="0" width="242" height="58" rx="8" fill="#eefbf6" stroke="#bce5dc"/>
    <text x="28" y="38" fill="#008f7f" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${escapeXml(data.date)}</text>
    <rect x="270" y="0" width="${editionBadgeW}" height="58" rx="8" fill="#f3faed" stroke="#cbe5bc"/>
    <text x="298" y="38" fill="#386a31" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${escapeXml(data.edition)}</text>
  </g>

  <text x="120" y="1248" fill="#7b8580" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="0">${escapeXml(data.footer)}</text>
</svg>`
}

/**
 * Renders the preview card SVG to a PNG file at outPath. Returns the
 * resolved absolute path. Caller is responsible for ensuring the parent
 * directory exists.
 */
export async function renderPreviewCardPng(data: PreviewCardData, outPath: string): Promise<string> {
  const svg = renderPreviewCardSvg(data)
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  // Touch fs.statSync to surface IO errors early
  fs.statSync(outPath)
  return outPath
}
