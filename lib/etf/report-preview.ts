// Preview metadata for the ETF morning report (labels, description, URL helpers).
// 2026-10-17 개편: 미리보기 이미지는 lib/preview/data-card.ts의 데이터 카드(모자이크)로 그린다
// (lib/etf/renderer.ts saveReportPreviewImage). 이 모듈은 ETF 메타·URL의 단일 출처로 남는다.

import { PREVIEW_WIDTH, PREVIEW_HEIGHT } from '../preview/preview-card'

export const REPORT_PREVIEW_IMAGE_WIDTH = PREVIEW_WIDTH
export const REPORT_PREVIEW_IMAGE_HEIGHT = PREVIEW_HEIGHT

// og:site_name — 텔레그램은 미리보기 위에 이 이름을 보여 준다(spec §4).
export const REPORT_SITE_NAME = 'iM뱅크'

// og:description 최대 길이(메신저가 자체 글꼴로 보여 주는 설명 문구, spec §4 "약 80자 이내").
export const REPORT_PREVIEW_DESCRIPTION_MAX_CHARS = 90

export function reportPreviewTitle(headline: string): string {
  return `iMBank ETF Today · ${headline.trim()}`
}

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : ''
}

// 90자를 넘으면 단어 경계에서 자르고 '…'를 붙인다(경계가 너무 앞이면 글자 단위).
function clipChars(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  let cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  if (space >= Math.floor(max * 0.6)) cut = cut.slice(0, space)
  return `${cut.replace(/[\s,·.]+$/, '')}…`
}

/**
 * og:description — 세 줄 요약의 해외 신호 · 오늘 핵심을 한 줄로(90자 이내).
 * 요약이 없으면(옛 리포트 HTML에 메타가 없을 때 page.tsx 폴백) 날짜 기반 기본 문구.
 */
export function reportPreviewDescription(date: string, summary?: { overseas?: string; focus?: string }): string {
  const parts = [plainText(summary?.overseas), plainText(summary?.focus)].filter(Boolean)
  if (parts.length === 0) return `${date} Morning Edition · iM뱅크 AI Analyst ETF 전용 보고서`
  return clipChars(parts.join(' · '), REPORT_PREVIEW_DESCRIPTION_MAX_CHARS)
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
