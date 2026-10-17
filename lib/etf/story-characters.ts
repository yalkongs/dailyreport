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
//
// 2026-10-17 아침 리포트 개편: 출력 스키마에서 Characters 산문이 빠져 프롬프트 주입·카드-산문 정합
// 검사(checkCharacterProseConsistency)를 제거했다. isTacticalEtf는 자산군 슬롯(asset-classes.ts)·
// ETF 데이터 병합이 계속 쓴다.

import type { EtfQuote } from './types'

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
