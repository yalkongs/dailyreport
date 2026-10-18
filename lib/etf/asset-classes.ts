// lib/etf/asset-classes.ts
//
// 2026-10-17 아침 리포트 개편: ETF Today의 "자산군별 판단 재료" 카드 슬롯을 코드가 확정한다.
// 모델은 슬롯(key)별 문장만 쓰고, 대표 ETF 예시와 등락률은 렌더러가 이 슬롯에서 직접 그린다.
// 프롬프트·검증·렌더·미리보기 카드가 같은 슬롯을 쓰도록 계산을 한곳에 둔다.
//
// 분류 기준(유니버스 category·theme·foreignUnderlying, 레버리지·인버스는 isTacticalEtf로 제외):
//   kr-large     국내 대형주      — KR, category 지수(코스닥150 제외: 대형주가 아님)
//   kr-semi      국내 반도체·IT   — KR, theme 반도체·AI·IT
//   kr-sector    그날 움직인 섹터 — KR, 섹터·테마(반도체·AI·IT 제외), theme별 평균 |등락| 최대
//                (유니버스의 국내 섹터·테마는 전부 theme이 있다 — 은행·자동차·금융 등)
//   us-equity    미국 주식(환노출) — KR 해외 기초지수 주식형 중 이름에 '미국'(해외지수·섹터·테마) + US SPY·QQQ
//   bonds        채권             — KR·US category 채권(현금성 상품 — 달러단기·SOFR·단기통안채 등 — 제외)
//   commodities  금·원자재        — KR·US category 대안 중 원자재(리츠·비트코인 제외)
// 국내 슬롯(kr-*)은 국내 세션만 담는다 — foreignUnderlying(해외 기초지수) 국내 상장 ETF는 넣지 않는다.

import type { EtfQuote } from './types'
import { getEtfByTicker } from './universe'
import { isTacticalEtf } from './story-characters'

export type AssetClassKey = 'kr-large' | 'kr-semi' | 'kr-sector' | 'us-equity' | 'bonds' | 'commodities'

export interface AssetRep { ticker: string; name: string; market: 'KR' | 'US'; pct: number }

export interface AssetClassSlot {
  key: AssetClassKey
  label: string
  holdingLabel: string
  theme: string | null
  reps: AssetRep[]
  movePct: number
  // 슬롯에 든 ETF 전부(대표 reps를 고르는 집합). 미리보기 카드·페이지 모자이크의 강조 타일(Ruling 21).
  memberTickers: string[]
}

const SEMI_THEMES = new Set(['반도체', 'AI', 'IT'])
const US_BROAD_INDEX = new Set(['SPY', 'QQQ'])
const NON_EQUITY = new Set(['채권', '대안'])
const COMMODITY_NAME = /골드|gold|silver|원유|oil|wti|commodity|원자재/i
// Ruling 16·19: 현금성 상품은 '채권' 예시가 아니다 — 달러 상품은 환율이 크게 움직인 날 원화 환산 등락이 커져
// 채권 대표로 뽑히고, 원화 단기채는 거의 움직이지 않아 채권 흐름을 보여 주지 못한다
// (유니버스: TIGER 미국달러단기채권액티브, TIGER 미국달러SOFR금리액티브, TIGER 단기통안채).
const CASH_LIKE_NAME = /달러단기|SOFR|KOFR|CD금리|머니마켓|MMF|단기통안|통안채|단기채/i

interface Candidate {
  rep: AssetRep
  category: string
  theme: string | undefined
  foreignUnderlying: boolean
  defName: string
}

function toCandidates(quotes: EtfQuote[]): Candidate[] {
  const out: Candidate[] = []
  for (const q of quotes) {
    const pct = q.changePercent
    if (pct === null || pct === undefined || !Number.isFinite(pct)) continue
    const def = getEtfByTicker(q.ticker)
    if (!def) continue
    if (isTacticalEtf(q) || isTacticalEtf({ ...q, name: def.name })) continue
    out.push({
      rep: { ticker: q.ticker, name: q.name, market: def.market, pct },
      category: def.category,
      theme: def.theme,
      foreignUnderlying: def.foreignUnderlying === true,
      defName: def.name,
    })
  }
  return out
}

const byAbsPctDesc = (a: Candidate, b: Candidate) => Math.abs(b.rep.pct) - Math.abs(a.rep.pct)

// 대표 ETF: 국내 |등락| 1위를 먼저, 둘째는 해외 |등락| 1위(슬롯에 해외가 있으면) 아니면 국내 2위.
function pickReps(members: Candidate[]): AssetRep[] {
  const kr = members.filter(m => m.rep.market === 'KR').slice().sort(byAbsPctDesc)
  const us = members.filter(m => m.rep.market === 'US').slice().sort(byAbsPctDesc)
  const reps: AssetRep[] = []
  if (kr[0]) reps.push(kr[0].rep)
  if (us[0]) reps.push(us[0].rep)
  else if (kr[1]) reps.push(kr[1].rep)
  return reps
}

function movePctOf(reps: AssetRep[]): number {
  return (reps.find(r => r.market === 'KR') ?? reps[0]).pct
}

// 받침이 있으면 '을', 없으면 '를'. 한글 음절이 아니면 '를'.
function objectParticle(word: string): '을' | '를' {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xac00 || code > 0xd7a3) return '를'
  return (code - 0xac00) % 28 === 0 ? '를' : '을'
}

function holding(label: string): string {
  return `${label}${objectParticle(label)} 갖고 있다면`
}

function pickSectorTheme(candidates: Candidate[]): { theme: string; members: Candidate[] } | null {
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    if (c.rep.market !== 'KR' || c.foreignUnderlying) continue
    if (c.category !== '섹터' && c.category !== '테마') continue
    if (!c.theme || SEMI_THEMES.has(c.theme)) continue
    const list = groups.get(c.theme) ?? []
    list.push(c)
    groups.set(c.theme, list)
  }
  let best: { theme: string; members: Candidate[]; avg: number } | null = null
  for (const [theme, members] of groups) {
    const avg = members.reduce((sum, m) => sum + Math.abs(m.rep.pct), 0) / members.length
    if (!best || avg > best.avg) best = { theme, members, avg }
  }
  return best ? { theme: best.theme, members: best.members } : null
}

export function buildAssetClassSlots(quotes: EtfQuote[]): AssetClassSlot[] {
  const candidates = toCandidates(quotes)
  const domestic = candidates.filter(c => c.rep.market === 'KR' && !c.foreignUnderlying)

  const groups: Array<{ key: AssetClassKey; label: string; holdingLabel: string; theme: string | null; members: Candidate[] }> = [
    {
      key: 'kr-large', label: '국내 대형주', holdingLabel: holding('국내 대형주'), theme: null,
      members: domestic.filter(c => c.category === '지수' && !/코스닥/.test(c.defName)),
    },
    {
      key: 'kr-semi', label: '국내 반도체·IT', holdingLabel: holding('반도체'), theme: '반도체',
      members: domestic.filter(c => c.theme !== undefined && SEMI_THEMES.has(c.theme)),
    },
  ]

  const sector = pickSectorTheme(candidates)
  if (sector) {
    groups.push({ key: 'kr-sector', label: sector.theme, holdingLabel: holding(sector.theme), theme: sector.theme, members: sector.members })
  }

  groups.push(
    {
      key: 'us-equity', label: '미국 주식(환노출)', holdingLabel: holding('미국 주식'), theme: null,
      members: candidates.filter(c =>
        (c.rep.market === 'KR' && c.foreignUnderlying && !NON_EQUITY.has(c.category) && /미국/.test(c.defName)) ||
        (c.rep.market === 'US' && US_BROAD_INDEX.has(c.rep.ticker))),
    },
    {
      key: 'bonds', label: '채권', holdingLabel: holding('채권'), theme: null,
      members: candidates.filter(c => c.category === '채권' && !CASH_LIKE_NAME.test(c.defName) && !CASH_LIKE_NAME.test(c.rep.name)),
    },
    {
      key: 'commodities', label: '금·원자재', holdingLabel: holding('금·원자재'), theme: null,
      members: candidates.filter(c => c.category === '대안' && (COMMODITY_NAME.test(c.defName) || COMMODITY_NAME.test(c.rep.name))),
    },
  )

  const slots: AssetClassSlot[] = []
  for (const g of groups) {
    const reps = pickReps(g.members)
    if (reps.length === 0) continue
    slots.push({
      key: g.key, label: g.label, holdingLabel: g.holdingLabel, theme: g.theme, reps, movePct: movePctOf(reps),
      memberTickers: g.members.map(m => m.rep.ticker),
    })
  }
  // 중요도(|movePct|) 내림차순. 같은 값이면 위 정의 순서 유지(Array.prototype.sort는 안정 정렬).
  return slots.sort((a, b) => Math.abs(b.movePct) - Math.abs(a.movePct))
}

// 레버리지·인버스 주의(tacticalWarning)는 전술형 ETF |등락|이 이 값 이상인 날에만 쓴다.
export const TACTICAL_WARNING_MIN_ABS_PCT = 10

// 전술형(레버리지·인버스) 중 |등락| 최대 종목이 기준 이상이면 그 시세, 아니면 null.
// 프롬프트(작성/생략 지시)와 검증(조건 밖이면 자동 생략)이 같은 판단을 쓴다.
export function findTacticalAlert(quotes: EtfQuote[], minAbsPct = TACTICAL_WARNING_MIN_ABS_PCT): EtfQuote | null {
  let best: EtfQuote | null = null
  for (const q of quotes) {
    const pct = q.changePercent
    if (pct === null || pct === undefined || !Number.isFinite(pct) || !isTacticalEtf(q)) continue
    if (!best || Math.abs(pct) > Math.abs(best.changePercent as number)) best = q
  }
  return best && Math.abs(best.changePercent as number) >= minAbsPct ? best : null
}

// 링크 미리보기 카드의 "○○를 갖고 있다면" 자산군: 국내 슬롯 중 |movePct| 최대, 없으면 첫 슬롯.
export function pickFeaturedSlot(slots: AssetClassSlot[]): AssetClassSlot | null {
  let best: AssetClassSlot | null = null
  for (const s of slots) {
    if (!s.key.startsWith('kr-')) continue
    if (!best || Math.abs(s.movePct) > Math.abs(best.movePct)) best = s
  }
  return best ?? slots[0] ?? null
}

// 미리보기 카드 자산군: card.key 슬롯, 없거나 슬롯 밖이면 주제 슬롯(pickFeaturedSlot).
// 카드 PNG(run-etf)·페이지 모자이크(renderer)·카드 문구 게이트(report-quality)가 같은 슬롯을 쓰도록 한곳에 둔다.
export function cardSlot(slots: AssetClassSlot[], cardKey: string | null | undefined): AssetClassSlot | null {
  return slots.find(s => s.key === cardKey) ?? pickFeaturedSlot(slots)
}
