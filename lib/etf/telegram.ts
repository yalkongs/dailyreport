// lib/etf/telegram.ts — ETF-specific Telegram notifier.
//
// Sends the ETF report URL as a plain message (not sendPhoto) so that
// the link-preview card is pulled from the target page's OG metadata.
// The market report pipeline uses sendPhoto with an explicit OG image;
// the two flows are independent and can evolve separately.

import { fetchJson } from './fetcher'

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export async function sendReportUrl(
  url: string,
  date: string,
  headline: string,
  anomalyCount: number,
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 미설정 — 발송 건너뜀')
    return
  }

  const alertLine = anomalyCount > 0 ? `\n⚠️ 이상 탐지: ${anomalyCount}건` : ''
  const text = `🌅 ${date} ETF 리포트\n\n${headline}${alertLine}\n\n👉 ${url}`

  await sendMessage(botToken, chatId, text)
}

export async function sendError(step: string, error: unknown): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) return

  const message = error instanceof Error ? error.message : String(error)
  const text = `🔴 [etf] ${step} 실패\n\n${message}`

  await sendMessage(botToken, chatId, text)
}

async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const apiUrl = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`

  const result = await fetchJson<{ ok: boolean }>(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  })

  if (!result?.ok) {
    console.error('[telegram] 발송 실패:', result)
  } else {
    console.log('[telegram] 발송 완료')
  }
}
