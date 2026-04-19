// Market report preview card generator.
// Mirrors lib/etf/report-preview.ts using the shared B-style template
// from lib/preview/preview-card.ts. Output PNGs land at
// public/reports/<date>-preview.png and are linked in Telegram via
// sendPhoto for a guaranteed link-preview card.

import * as fs from 'fs'
import * as path from 'path'
import {
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  renderPreviewCardPng,
} from '../preview/preview-card'

export const MARKET_PREVIEW_IMAGE_WIDTH = PREVIEW_WIDTH
export const MARKET_PREVIEW_IMAGE_HEIGHT = PREVIEW_HEIGHT

export const MARKET_REPORTS_PUBLIC_DIR = 'reports'

export function marketPreviewFilename(date: string): string {
  return `${date}-preview.png`
}

export function marketPreviewPath(date: string): string {
  return `/${MARKET_REPORTS_PUBLIC_DIR}/${marketPreviewFilename(date)}`
}

/**
 * Generates and saves the market preview PNG to
 * public/reports/<date>-preview.png. Returns the absolute file path.
 */
export async function saveMarketPreviewImage(
  date: string,
  headline: string,
  subline?: string,
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`saveMarketPreviewImage: invalid date format "${date}"`)
  }
  const dir = path.join(process.cwd(), 'public', MARKET_REPORTS_PUBLIC_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const filename = marketPreviewFilename(date)
  const filePath = path.join(dir, filename)

  await renderPreviewCardPng(
    {
      date,
      sectionLabel: 'Market Today',
      edition: 'MORNING DIGEST',
      footer: '글로벌 시장 일일 리포트 · iMBank Market Today',
      headline,
      subline:
        subline?.trim() ||
        '오늘의 글로벌 금융 시장 흐름과 주요 지표 변화를 한눈에 정리합니다.',
    },
    filePath,
  )

  console.log(`[market-preview] 저장: ${filePath}`)
  return filePath
}
