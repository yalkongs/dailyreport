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

  const alertLine = anomalyCount > 0 ? `\n이상 탐지: ${anomalyCount}건` : ''
  const text = `${date} ETF 리포트\n\n${headline}${alertLine}\n\n${url}`

  await sendMessage(botToken, chatId, text)
}

// 운영자 실패 알림은 Telegram이 아니라 exit(1) → GitHub 네이티브 실패 이메일로 일원화
// (2026-06-30 캘린더 F). 옛 sendError는 생성 스텝에 TELEGRAM env가 없어 dead no-op이었고,
// env가 있었다면 고객 공개 채널로 에러를 보내는 foot-gun이라 제거함.

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
