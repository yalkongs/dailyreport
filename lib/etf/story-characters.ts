// lib/etf/story-characters.ts
//
// R1 (2026-07-22): Characters 카드-산문 정합. renderer.ts에서 선택 로직을 이동해
// 렌더러·프롬프트(claude-client)·검증(report-quality)이 **같은 배정**을 공유하게 한다.
// (이동만 — 로직 무변경. renderer.ts는 여기서 import.)
//
// 배경: 렌더러가 렌더 시점에 selectStoryCharacters(quotes)로 카드 4장의 ETF를
// 결정론적으로 고르는데, 프롬프트는 Claude에게 그 배정을 알려주지 않아 Claude가 추측 →
// 카드(나스닥100)와 산문(S&P500)이 어긋나는 사고(7/21 발행본) 발생. 배정 주입(프롬프트)과
// 검증(validator)을 한 소스에서 계산하도록 여기로 모은다.

import type { EtfQuote, MorningReport } from './types'

export interface StoryCharacters {
  primary: EtfQuote | undefined
  gate: EtfQuote | undefined
  alternative: EtfQuote | undefined
  warning: EtfQuote | undefined
}

export function isTacticalEtf(q: EtfQuote): boolean {
  return /레버리지|인버스|2x|선물인버스|inverse/i.test(q.name)
}

export function findQuoteByName(quotes: EtfQuote[], pattern: RegExp): EtfQuote | undefined {
  return quotes.find(q => pattern.test(q.name))
}

export function selectStoryCharacters(quotes: EtfQuote[]): StoryCharacters {
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

// ─── R1 검증: 카드 ETF와 슬롯 산문의 정합 ────────────────────────────
// 각 슬롯 산문(존재 시)이 해당 카드 ETF의 정규화된 종목명 또는 6자리 코드를 포함해야 한다.
// 정규화: 공백 제거 후 비교(chip 표기 "KODEX 반도체(091160)"·"KODEX 반도체 (091160)" 변형 흡수).

function stripSpaces(s: string): string {
  return s.replace(/\s+/g, '')
}

function krCode(q: EtfQuote): string | null {
  const code = q.ticker.replace(/\.(KS|KQ)$/i, '')
  return /^\d{6}$/.test(code) ? code : null
}

const CHARACTER_SLOTS: Array<keyof StoryCharacters> = ['primary', 'gate', 'alternative', 'warning']
const SLOT_LABEL: Record<keyof StoryCharacters, string> = {
  primary: '주인공(primary)',
  gate: '게이트(gate)',
  alternative: '대안(alternative)',
  warning: '경계(warning)',
}

export function checkCharacterProseConsistency(report: MorningReport, quotes: EtfQuote[]): string[] {
  const prose = report.narrativeNotes?.characters
  if (!prose) return [] // Tier 1 fallback 등 산문 없으면 자연 skip

  const characters = selectStoryCharacters(quotes)
  const violations: string[] = []

  for (const slot of CHARACTER_SLOTS) {
    const card = characters[slot]
    const text = prose[slot]
    if (!card || typeof text !== 'string' || text.trim().length === 0) continue

    const proseNoSpace = stripSpaces(text)
    const nameNoSpace = stripSpaces(card.name)
    const code = krCode(card)
    const matchesName = nameNoSpace.length > 0 && proseNoSpace.includes(nameNoSpace)
    const matchesCode = code !== null && text.includes(code)
    if (!matchesName && !matchesCode) {
      const codeLabel = code ? ` (${code})` : ''
      violations.push(
        `Characters ${SLOT_LABEL[slot]} 카드-산문 불일치: 카드는 "${card.name}"${codeLabel}인데 산문이 이를 지칭하지 않음`
      )
    }
  }

  return violations
}
