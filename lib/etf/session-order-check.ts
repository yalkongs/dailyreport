// lib/etf/session-order-check.ts
// 2026-11-27 시간 순서 설계(docs/superpowers/specs/2026-11-27-session-order-design.md) — 검증.
// 국내 전일 등락을 그보다 뒤에 열린 간밤 미국 장으로 설명한 문장을 잡는다.
//   11-23 "필라델피아 반도체지수를 10.73% 끌어내렸고, 국내 반도체 ETF도 그 충격을 고스란히 받았습니다"
// 오탐이 재생성·축소판 발송으로 이어지므로 보수적으로: 한 문장에 ① 국내 대상 ② 간밤 세션 근거
// ③ 인과 연결어가 모두 있고 ④ 오늘 개장 맥락이 없을 때만 위반이다.
import type { IndexQuote } from './types'
import type { SessionTimeline } from '../session-timeline'

const KR_SUBJECT = /국내|코스피|코스닥|\(\d{6}\)|KODEX|TIGER|ACE|RISE|SOL|PLUS|HANARO|KIWOOM|KoAct|TIME/
const CAUSAL = /여파|영향|충격|때문|탓|끌어내|끌어 내|받아|받았|받으며|이어받|번지|번져|전이|따라 (?:밀|내|떨어|올|오르)|발목/
const FORWARD = /오늘|개장|장 초반|장초반|출발|이번 장|시초가|아침/
const AFTER_MARKER = /이어 열린|뒤이어 열린|그 뒤 열린|국내 장이 끝난 뒤/
const SESSION_SPLIT = /전일|이어 열린|뒤이어|그 뒤 열린/

const US_NAMES: Array<{ nameKo: string; pattern: RegExp }> = [
  { nameKo: 'S&P500', pattern: /S&P\s?500/ },
  { nameKo: '나스닥', pattern: /나스닥(?!\s?100)/ },
  { nameKo: '다우', pattern: /다우/ },
  { nameKo: '필라델피아 반도체지수', pattern: /필라델피아\s?반도체|SOX/ },
]

function splitSentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, '')
    .split(/(?<=[.!?。])\s+|\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** 문장에 간밤(국내 장 뒤) 미국 지수의 이름과 그 등락 수치가 함께 있는가. */
function citesOvernightIndex(sentence: string, overnight: IndexQuote[]): boolean {
  for (const n of US_NAMES) {
    if (!n.pattern.test(sentence)) continue
    const q = overnight.find(i => i.nameKo === n.nameKo)
    if (!q || typeof q.changePercent !== 'number') continue
    const abs = Math.abs(q.changePercent)
    const forms = [abs.toFixed(2), abs.toFixed(1)]
    if (forms.some(f => new RegExp(`(?<![\\d.])${f.replace('.', '\\.')}\\s?%`).test(sentence))) return true
  }
  return false
}

export function findSessionOrderViolations(text: string, timeline: SessionTimeline, indices: IndexQuote[] | undefined): string[] {
  if (!timeline.overnightAfterKr) return [] // 미국 휴장 — 간밤 세션이 곧 직전 미국 장이다
  // 간밤 세션 값만 — asOf 가 국내 세션 이상인 미국 지수(국내 장 뒤에 열린 장)
  const overnight = (indices ?? []).filter(i => !/^\^K[SQ]/.test(i.symbol) && !!i.asOf && i.asOf >= timeline.krSession)
  const hits: string[] = []
  for (const s of splitSentences(text)) {
    // "…영향을 받았고, 이어 열린 간밤 나스닥은…"처럼 뒤 세션임을 밝혀 나눈 문장은 순서를 지킨 것이다(Codex 지적).
    if (!KR_SUBJECT.test(s) || !CAUSAL.test(s) || FORWARD.test(s) || AFTER_MARKER.test(s)) continue
    if (/간밤/.test(s) || citesOvernightIndex(s, overnight)) hits.push(s.slice(0, 90))
  }
  return hits
}

/**
 * 자산군 카드 — 대표 ETF가 모두 국내 상장이면 reason(어제 움직임의 이유)은 국내 전일 장의 이유다.
 * 그 칸에 간밤 미국 장을 쓰면 연결어가 없어도 인과 주장이다(11-24 "간밤 엔비디아 33% 급등" → 국내 반도체·IT 하락의 이유 칸).
 */
export function findCardSessionOrderViolations(
  cards: ReadonlyArray<{ key: string; reason?: string }> | undefined,
  slots: ReadonlyArray<{ key: string; label: string; reps: ReadonlyArray<{ market: 'KR' | 'US' }> }>,
  timeline: SessionTimeline,
): string[] {
  if (!timeline.overnightAfterKr || !Array.isArray(cards)) return []
  const hits: string[] = []
  for (const c of cards) {
    const slot = slots.find(s => s.key === c?.key)
    if (!slot || slot.reps.length === 0 || !slot.reps.every(r => r.market === 'KR')) continue
    const reason = typeof c.reason === 'string' ? c.reason.replace(/<[^>]+>/g, '') : ''
    // 두 세션을 '전일 국내…, (이어 열린) 간밤…'으로 갈라 쓴 대비 문장은 순서를 지킨 것이다(10-28·11-18~20 실례).
    if (/간밤/.test(reason) && !FORWARD.test(reason) && !SESSION_SPLIT.test(reason)) hits.push(`${slot.label}: ${reason.slice(0, 80)}`)
  }
  return hits
}
