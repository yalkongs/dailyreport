// Preview metadata for the ETF morning report (labels, description, URL helpers).
// 2026-10-17 개편: 미리보기 이미지는 lib/preview/data-card.ts의 데이터 카드(모자이크)로 그린다
// (lib/etf/renderer.ts saveReportPreviewImage). 이 모듈은 ETF 메타·URL의 단일 출처로 남는다.

import { CARD_WIDTH, CARD_HEIGHT } from '../preview/card-size'

export const REPORT_PREVIEW_IMAGE_WIDTH = CARD_WIDTH
export const REPORT_PREVIEW_IMAGE_HEIGHT = CARD_HEIGHT

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

const charLength = (text: string) => Array.from(text).length
const TRAILING_PUNCT = /[\s,，·.。!?]+$/

// max자를 넘으면 문장 끝 → 구절(쉼표·가운뎃점) → 어절(공백) 경계 순으로 자르고 '…'를 붙인다.
// 경계가 너무 앞(40% 미만)이면 글자 단위로 자른다. 결과는 '…' 포함 max자 이내.
function clipAtBoundary(text: string, max: number): string {
  if (charLength(text) <= max) return text
  const head = Array.from(text).slice(0, Math.max(0, max - 1)).join('')
  const minCut = Math.floor(head.length * 0.4)
  for (const boundary of [/[.!?。](?=\s)/g, /[,，·]/g, /\s/g]) {
    let last = -1
    for (const m of head.matchAll(boundary)) last = m.index ?? last
    if (last >= minCut) return `${head.slice(0, last).replace(TRAILING_PUNCT, '')}…`
  }
  return `${head.replace(TRAILING_PUNCT, '')}…`
}

const DESCRIPTION_SEPARATOR = ' · '
// 해외 신호를 이보다 짧게 줄여야 하면 붙이지 않고 오늘 핵심만 쓴다.
const MIN_OVERSEAS_CHARS = 8

/**
 * og:description — 세 줄 요약의 해외 신호 · 오늘 핵심을 한 줄로(90자 이내).
 * 길면 오늘 핵심은 그대로 두고 해외 신호를 경계에서 줄인다(오늘 핵심 자체가 너무 길면 그것만 줄여 쓴다).
 * 요약이 없으면(옛 리포트 HTML에 메타가 없을 때 page.tsx 폴백) 날짜 기반 기본 문구.
 */
export function reportPreviewDescription(date: string, summary?: { overseas?: string; focus?: string }): string {
  const max = REPORT_PREVIEW_DESCRIPTION_MAX_CHARS
  const overseas = plainText(summary?.overseas)
  const focus = plainText(summary?.focus)
  if (!overseas && !focus) return `${date} Morning Edition · iM뱅크 AI Analyst ETF 전용 보고서`
  if (!focus) return clipAtBoundary(overseas, max)
  if (!overseas) return clipAtBoundary(focus, max)
  const full = `${overseas}${DESCRIPTION_SEPARATOR}${focus}`
  if (charLength(full) <= max) return full
  const budget = max - charLength(DESCRIPTION_SEPARATOR) - charLength(focus)
  if (budget < MIN_OVERSEAS_CHARS) return clipAtBoundary(focus, max)
  return `${clipAtBoundary(overseas, budget)}${DESCRIPTION_SEPARATOR}${focus}`
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
