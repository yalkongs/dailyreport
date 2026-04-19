// Preview metadata + SVG renderer for the ETF morning report.
// SVG generation is delegated to lib/preview/preview-card.ts so that the
// ETF and Market reports share a single visual template (B-style).
// This module remains the single import surface for ETF-specific labels
// and URL helpers.

import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  renderPreviewCardSvg as sharedRenderPreviewCardSvg,
} from '../preview/preview-card'

export const REPORT_PREVIEW_IMAGE_WIDTH = PREVIEW_WIDTH
export const REPORT_PREVIEW_IMAGE_HEIGHT = PREVIEW_HEIGHT

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

/**
 * Renders the ETF preview card SVG. Subline is optional — falls back to
 * the standard tagline if not provided so the card never has an empty
 * sub-area.
 */
export function renderReportPreviewSvg(date: string, headline: string, subline?: string): string {
  return sharedRenderPreviewCardSvg({
    date,
    sectionLabel: 'ETF Today',
    edition: 'MORNING EDITION',
    footer: 'ETF 전용 보고서 · iMBank ETF Today',
    headline,
    subline: subline ?? 'ETF 시장 데이터와 KRX 지표를 바탕으로 오늘의 투자 방향을 정리합니다.',
  })
}
