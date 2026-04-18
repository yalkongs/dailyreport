// Preview metadata + SVG renderer for the ETF morning report.
// `type` parameter was removed along with the evening edition; paths now
// live under `/etf-reports/…`.

export const REPORT_PREVIEW_IMAGE_WIDTH = 1080
export const REPORT_PREVIEW_IMAGE_HEIGHT = 1350

export function reportPreviewTitle(headline: string): string {
  return `iMBank ETF Today · ${headline.trim()}`
}

export function reportPreviewDescription(date: string, subline?: string): string {
  const summary = subline?.trim()
  return summary
    ? `${date} Morning Edition · ${summary}`
    : `${date} Morning Edition · iM뱅크 AI Analyst ETF 전용 보고서`
}

export function reportPreviewImageFilename(date: string): string {
  return `${date}-preview.png`
}

export function reportPreviewImagePath(date: string): string {
  return `/etf-reports/${reportPreviewImageFilename(date)}`
}

export function normalizePublicBaseUrl(publicBaseUrl?: string): string | null {
  if (!publicBaseUrl) return null
  const trimmed = publicBaseUrl.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.endsWith('/') ? withProtocol : `${withProtocol}/`
}

export function absoluteReportUrl(pathOrUrl: string, publicBaseUrl?: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl

  const base = normalizePublicBaseUrl(publicBaseUrl)
  if (!base) return pathOrUrl

  if (pathOrUrl.startsWith('/')) return new URL(pathOrUrl, base).toString()
  return new URL(`/etf-reports/${pathOrUrl}`, base).toString()
}

export function reportPreviewImageUrl(date: string, publicBaseUrl?: string): string {
  const p = reportPreviewImagePath(date)
  return publicBaseUrl ? absoluteReportUrl(p, publicBaseUrl) : reportPreviewImageFilename(date)
}

export function reportRouteUrl(date: string, publicBaseUrl?: string): string | undefined {
  const base = normalizePublicBaseUrl(publicBaseUrl)
  if (!base) return undefined
  return new URL(`/etf-reports/${date}`, base).toString()
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

export function renderReportPreviewSvg(date: string, headline: string, subline?: string): string {
  const edition = 'MORNING EDITION'
  const titleLines = wrapText(headline, 15, 4)
  const sublineLines = wrapText(subline ?? 'ETF 시장 데이터와 KRX 지표를 바탕으로 오늘의 투자 방향을 정리합니다.', 26, 3)
  const titleStartY = 640
  const sublineStartY = titleStartY + titleLines.length * 78 + 66

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_PREVIEW_IMAGE_WIDTH}" height="${REPORT_PREVIEW_IMAGE_HEIGHT}" viewBox="0 0 ${REPORT_PREVIEW_IMAGE_WIDTH} ${REPORT_PREVIEW_IMAGE_HEIGHT}" role="img" aria-label="${escapeXml(reportPreviewTitle(headline))}">
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
  <rect width="1080" height="1350" fill="#f5f7f3"/>
  <rect x="72" y="74" width="936" height="1202" rx="34" fill="#ffffff" stroke="#d9e0dc" stroke-width="2" filter="url(#softShadow)"/>
  <rect x="72" y="74" width="936" height="16" rx="8" fill="url(#brandRibbon)"/>
  <path d="M162 212H276V326H162V212ZM276 121C418 121 533 236 533 378H419C419 299 355 235 276 235V121ZM533 378C533 236 648 121 790 121H904V235H790C711 235 647 299 647 378H533Z" fill="#00bfa5"/>
  <path d="M276 121C418 121 533 236 533 378C533 279 481 193 402 149C365 131 322 121 276 121Z" fill="#84d96b" opacity="0.95"/>
  <text x="120" y="450" fill="#5d6062" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="34" font-weight="800" letter-spacing="0">iM뱅크 AI Analyst</text>
  <text x="120" y="504" fill="#111817" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="58" font-weight="900" letter-spacing="0">ETF Today</text>
  ${titleLines.map((line, index) => `<text x="120" y="${titleStartY + index * 78}" fill="#111817" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="62" font-weight="900" letter-spacing="0">${escapeXml(line)}</text>`).join('\n  ')}
  <rect x="120" y="${sublineStartY - 42}" width="132" height="10" rx="5" fill="#00bfa5"/>
  ${sublineLines.map((line, index) => `<text x="120" y="${sublineStartY + index * 42}" fill="#4e5a55" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="0">${escapeXml(line)}</text>`).join('\n  ')}
  <g transform="translate(120 1150)">
    <rect x="0" y="0" width="242" height="58" rx="8" fill="#eefbf6" stroke="#bce5dc"/>
    <text x="28" y="38" fill="#008f7f" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${escapeXml(date)}</text>
    <rect x="270" y="0" width="262" height="58" rx="8" fill="#f3faed" stroke="#cbe5bc"/>
    <text x="298" y="38" fill="#386a31" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="0">${edition}</text>
  </g>
  <text x="120" y="1248" fill="#7b8580" font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans KR', Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="0">ETF 전용 보고서 · iMBank ETF Today</text>
</svg>`
}
