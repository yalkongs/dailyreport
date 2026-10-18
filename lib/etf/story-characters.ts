// lib/etf/story-characters.ts
//
// 레버리지·인버스(전술형) ETF 판정 — 자산군 슬롯(asset-classes.ts)·ETF 데이터 병합(etf-data.ts)·
// 렌더러·미리보기 카드(preview/data-card.ts)가 함께 쓴다.
//
// 이력: R1(2026-07-22)에 Characters 카드 배정(selectStoryCharacters)을 렌더러·프롬프트·검증이 공유하도록
// 여기로 모았으나, 2026-10-17 아침 리포트 개편으로 Characters 산문·카드가 사라져 배정 로직은 제거했다.

import type { EtfQuote } from './types'

export function isTacticalEtf(q: EtfQuote): boolean {
  return /레버리지|인버스|2x|선물인버스|inverse/i.test(q.name)
}
