// Market report preview card generator.
// 2026-10 개편: 최근 20거래일 코스피 스트라이프 데이터 카드(lib/preview/data-card.ts, 1080×1350).
// Output PNGs land at public/reports/<date>-preview.png and are linked in Telegram via
// sendPhoto for a guaranteed link-preview card.

import * as fs from 'fs'
import * as path from 'path'
import {
  renderMarketCardSvg,
  saveCardPng,
} from '../preview/data-card'
import type { StripeSession } from '../preview/data-card'

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
 * headline = 카드 제목, line = 제목 아래 한 줄(cardLine), sessions = 코스피 최근 거래일 등락(비면 스트라이프 자리는 중립색).
 */
export async function saveMarketPreviewImage(
  date: string,
  input: { headline: string; line: string; sessions: StripeSession[] },
): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`saveMarketPreviewImage: invalid date format "${date}"`)
  }
  // marketPreviewPath 는 URL 경로(/reports/…)이므로 파일 쓰기에는 public/ 아래 절대 경로를 따로 만든다.
  const dir = path.join(process.cwd(), 'public', MARKET_REPORTS_PUBLIC_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, marketPreviewFilename(date))

  await saveCardPng(
    renderMarketCardSvg({ date, headline: input.headline, line: input.line, sessions: input.sessions }),
    filePath,
  )

  console.log(`[market-preview] 저장: ${filePath}`)
  return filePath
}
