// 링크 미리보기 데이터 카드(1080×1350) 공용 모듈 — spec 2026-10-17 §4.
// Market 카드: 최근 20거래일 코스피 스트라이프. ETF 카드: 분석 ETF 모자이크(Korea | USA).
// 숫자는 카드에 넣지 않는다(날짜 라벨 제외) — 색의 짙기로만 크기를 보여 준다.
// 좌표는 브레인스토밍 시안(cards-final.html, 1080×1350 절대 좌표)을 SVG로 옮긴 값이다.

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { loadBrandLogoDataUri } from './brand-logo'
import { koreanWeekday } from '../market-calendar'
import { getEtfByTicker } from '../etf/universe'
import { isTacticalEtf } from '../etf/story-characters'
import type { EtfQuote } from '../etf/types'
import { CARD_WIDTH, CARD_HEIGHT } from './card-size'

export interface StripeSession { date: string; pct: number }          // date YYYY-MM-DD(KST 거래일)
export interface MosaicTile { ticker: string; market: 'KR' | 'US'; category: string; pct: number; featured: boolean }
export interface MarketCardInput { date: string; headline: string; line: string; sessions: StripeSession[] }
export interface EtfCardInput { date: string; headline: string; holdingLabel: string; line: string; tiles: MosaicTile[] }

// 카드 크기는 import 없는 card-size.ts에 둔다(Next 페이지가 sharp 없이 og:image 크기를 쓰도록).
const CARD_W = CARD_WIDTH
const CARD_H = CARD_HEIGHT
const FONT_FAMILY = "Pretendard, 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif"
const FONT_ATTR = `font-family="${FONT_FAMILY}"`
const MIN_FONT_PX = 40   // spec §4: 카드 글자 최소 크기

// ── 색 ──────────────────────────────────────────────────────────────
const NEUTRAL = '#E7EAEE'
const UP_MID = '#EF6F65'
const UP_DEEP = '#A50E0E'
const DOWN_MID = '#5B8DEF'
const DOWN_DEEP = '#0B3A8C'

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

// a→b 선형 보간(t 0~1), 대문자 #RRGGBB
function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  const out = pa.map((x, i) => Math.round(x + (pb[i] - x) * t))
  return '#' + out.map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('')
}

/**
 * 등락률(%) → 연속 색. 상승 빨강·하락 파랑, 보합(|r|<0.1) 회색.
 * |r|=5%에서 최대 농도(감마 0.8). t<0.5는 보합→중간, 이후 중간→최대.
 */
export function diverging(pct: number): string {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.1) return NEUTRAL
  const t = Math.pow(Math.min(Math.abs(pct) / 5, 1), 0.8)
  const [mid, deep] = pct > 0 ? [UP_MID, UP_DEEP] : [DOWN_MID, DOWN_DEEP]
  return t < 0.5 ? mix(NEUTRAL, mid, t / 0.5) : mix(mid, deep, (t - 0.5) / 0.5)
}

// ── 공통 유틸 ─────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// CSS 줄 상자(높이 lh) 안의 첫 baseline. Pretendard hhea: ascent 0.952em · descent 0.241em.
const ASCENT_EM = 1950 / 2048
const DESCENT_EM = 494 / 2048
function baselineInBox(top: number, size: number, lineHeight: number): number {
  return top + lineHeight / 2 + (ASCENT_EM - DESCENT_EM) / 2 * size
}

/** 'YYYY-MM-DD' → '10.16 금' */
export function cardDateLabel(date: string): string {
  return `${date.slice(5, 7)}.${date.slice(8, 10)} ${koreanWeekday(date)}`
}

// ── 스트라이프(Market) ──────────────────────────────────────────────────
/**
 * 거래일 하루 = 세로 줄 하나(틈 없이 전폭). 반환은 <g> 조각 — 호출 쪽 <svg> 안에 (0,0) 기준으로 놓는다.
 * marker면 마지막 줄 중앙 아래에 ▼(36×20, 마지막 줄 색)를 height 아래쪽으로 그린다.
 */
export function renderStripesSvg(
  sessions: StripeSession[],
  width: number,
  height: number,
  opts?: { marker?: boolean },
): string {
  if (sessions.length === 0) {
    return `<g data-role="stripes"><rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="${NEUTRAL}"/></g>`
  }
  const n = sessions.length
  const w = width / n
  const rects = sessions.map((s, i) => {
    const x = i * w
    // 마지막 줄만 폭을 보정해 정확히 width에서 끝낸다(반올림 오차로 생기는 틈·넘침 방지).
    const rw = i === n - 1 ? width - x : w
    return `<rect data-session="${escapeXml(s.date)}" x="${num(x)}" y="0" width="${num(rw)}" height="${num(height)}" fill="${diverging(s.pct)}"/>`
  })
  let marker = ''
  if (opts?.marker) {
    const last = sessions[n - 1]
    const cx = (n - 1) * w + (width - (n - 1) * w) / 2
    marker = `<path data-marker="today" d="M${num(cx - 18)} ${num(height)} L${num(cx + 18)} ${num(height)} L${num(cx)} ${num(height + 20)} Z" fill="${diverging(last.pct)}"/>`
  }
  // 줄 경계가 소수 좌표여도 이음매(헤어라인)가 생기지 않도록 줄 묶음만 crispEdges.
  return `<g data-role="stripes"><g shape-rendering="crispEdges">${rects.join('')}</g>${marker}</g>`
}

// ── 모자이크(ETF) ───────────────────────────────────────────────────────
const CATEGORY_ORDER: Record<string, number> = { 지수: 0, 해외지수: 1, 섹터: 2, 테마: 3, 팩터: 4, 채권: 5, 대안: 6 }
const MAX_TILES_PER_MARKET = 50

/**
 * 모자이크에 올릴 타일: 결측·레버리지·인버스 제외, 시장별로 [자산군 순서, 등락률 오름차순] 정렬(최대 50).
 * 결과는 KR 전체 → US 전체 순. featuredTickers에 든 ETF는 featured(검은 테두리) —
 * 호출 쪽은 카드 자산군 슬롯의 구성원(AssetClassSlot.memberTickers)을 넘긴다(Ruling 21: 테마 문자열이 아니라 슬롯 구성원).
 */
export function buildMosaicTiles(
  quotes: Array<{ ticker: string; name: string; market: 'KR' | 'US'; changePercent: number | null }>,
  featuredTickers: ReadonlySet<string> | null,
): MosaicTile[] {
  const tiles: MosaicTile[] = []
  for (const market of ['KR', 'US'] as const) {
    const side = quotes
      .filter(q => q.market === market)
      .filter(q => typeof q.changePercent === 'number' && Number.isFinite(q.changePercent))
      .filter(q => !isTacticalEtf({ ticker: q.ticker, name: q.name } as EtfQuote))
      .map((q): MosaicTile => {
        const def = getEtfByTicker(q.ticker)
        return {
          ticker: q.ticker,
          market,
          category: def?.category ?? '기타',
          pct: q.changePercent as number,
          featured: featuredTickers?.has(q.ticker) ?? false,
        }
      })
      .sort((a, b) => ((CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)) || (a.pct - b.pct))
    tiles.push(...side.slice(0, MAX_TILES_PER_MARKET))
  }
  return tiles
}

const TILE_W = 40.3
const TILE_H = 78
const TILE_GAP = 7
const TILE_COLS = 10
const TILE_TOP = 128
const FEATURE_RING = 5

function renderMosaicSide(tiles: MosaicTile[], x0: number): string {
  const normal: string[] = []
  const featured: string[] = []
  tiles.slice(0, MAX_TILES_PER_MARKET).forEach((t, i) => {
    const x = x0 + (i % TILE_COLS) * (TILE_W + TILE_GAP)
    const y = TILE_TOP + Math.floor(i / TILE_COLS) * (TILE_H + TILE_GAP)
    const fill = diverging(t.pct)
    if (t.featured) {
      // 시안의 box-shadow(타일 바깥 5px 링)와 같게: 중심선이 반 두께만큼 바깥에 오도록 키워서 그린다.
      const h = FEATURE_RING / 2
      featured.push(
        `<rect data-featured="1" data-ticker="${escapeXml(t.ticker)}" x="${num(x - h)}" y="${num(y - h)}" width="${num(TILE_W + FEATURE_RING)}" height="${num(TILE_H + FEATURE_RING)}" rx="${6 + h}" fill="${fill}" stroke="#111827" stroke-width="${FEATURE_RING}"/>`,
      )
    } else {
      normal.push(`<rect x="${num(x)}" y="${num(y)}" width="${TILE_W}" height="${TILE_H}" rx="6" fill="${fill}"/>`)
    }
  })
  // 강조 타일은 이웃 타일 위에 그려 링이 가려지지 않게 한다.
  return normal.join('') + featured.join('')
}

/** 모자이크 띠(<g> 조각, (0,0) 기준). 면당 10열×5행. 배치 상수는 1080px 폭 기준. */
export function renderMosaicSvg(tiles: MosaicTile[], width: number, height: number): string {
  const kr = tiles.filter(t => t.market === 'KR')
  const us = tiles.filter(t => t.market === 'US')
  const label = (text: string, x: number) =>
    `<text x="${x}" y="88" ${FONT_ATTR} font-size="40" font-weight="700" fill="#4B5563">${text}</text>`
  return `<g data-role="mosaic">`
    + `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#F3F5F7"/>`
    + label('Korea', 72) + label('USA', 574)
    + renderMosaicSide(kr, 72) + renderMosaicSide(us, 574)
    + `</g>`
}

// ── 카드 공통 상수 ────────────────────────────────────────────────────
const LOGO_H = 84
const LOGO_CROP = { x: 65, y: 231, w: 871, h: 564 }   // 원본 1000×1000 안의 내용 영역
const CONTENT_X = 72
const CONTENT_W = CARD_W - CONTENT_X * 2             // 936

// ── 글자 폭 측정 ──────────────────────────────────────────────────────
// 폰트 파일 없이 줄바꿈을 계산하려고 Pretendard v1.3.9 OTF(hmtx)에서 잰 글자별 진행폭을 넣어 둔다.
// 제목은 ExtraBold(800), 한 줄·라벨은 Bold(700). 커닝은 무시(영향 미미). data-card.test.ts가 글꼴 파일과 대조한다.
export type FontWeight = 700 | 800

// ASCII 0x20~0x7E, 1000분의 1em 단위
const ASCII_ADV: Record<FontWeight, readonly number[]> = {
  800: [224, 323, 375, 633, 638, 992, 661, 196, 406, 406, 562, 662, 297, 454, 292, 384, 682, 479, 618, 646, 668, 638, 653, 584, 655, 653, 292, 292, 662, 662, 662, 558, 872, 742, 642, 734, 706, 596, 565, 741, 724, 273, 558, 677, 550, 893, 707, 762, 630, 763, 640, 638, 653, 703, 742, 1027, 710, 717, 655, 406, 384, 406, 476, 466, 479, 564, 618, 575, 618, 582, 378, 618, 612, 271, 271, 572, 271, 895, 610, 598, 617, 617, 403, 553, 381, 612, 574, 833, 563, 574, 561, 406, 372, 406, 662],
  700: [230, 307, 376, 624, 630, 960, 648, 197, 390, 390, 539, 653, 287, 449, 282, 371, 660, 469, 610, 639, 657, 627, 643, 575, 644, 643, 282, 282, 653, 653, 653, 538, 874, 718, 637, 724, 701, 589, 563, 732, 720, 266, 547, 663, 546, 883, 709, 753, 623, 754, 632, 630, 643, 704, 718, 999, 686, 695, 641, 390, 371, 390, 467, 456, 478, 558, 611, 563, 611, 574, 367, 608, 600, 257, 257, 558, 257, 879, 598, 590, 608, 608, 390, 539, 370, 597, 563, 819, 551, 563, 549, 390, 355, 390, 653],
}
// 한글 음절(AC00~D7A3)·호환 자모(3130~318F)는 모두 같은 폭, 전각 기호(FF00~FFEF)도 같은 폭
const HANGUL_ADV = 0.8643
const FULLWIDTH_ADV = 0.938
// 자주 쓰는 ASCII 밖 문장부호: [800, 700]
const OTHER_ADV: Record<string, readonly [number, number]> = {
  '·': [292, 282], '…': [876, 847], '‘': [277, 264], '’': [277, 264], '“': [501, 485], '”': [501, 485],
  '–': [482, 479], '—': [969, 966], '×': [662, 653], '→': [925, 922],
}
const UNKNOWN_ADV = 1.0   // 폰트에 없을 수 있는 글자(한자·이모지 등)는 1em으로 보수적으로

/** 글자 하나의 진행폭(em). */
export function glyphAdvanceEm(ch: string, weight: FontWeight): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 0x20 && cp <= 0x7e) return ASCII_ADV[weight][cp - 0x20] / 1000
  if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3130 && cp <= 0x318f)) return HANGUL_ADV
  if (cp >= 0xff00 && cp <= 0xffef) return FULLWIDTH_ADV
  const other = OTHER_ADV[ch]
  if (other) return other[weight === 800 ? 0 : 1] / 1000
  return UNKNOWN_ADV
}

// 카드 글자 모양(렌더와 측정이 같은 값을 쓴다)
export type TextStyleName = 'title' | 'line' | 'label'
export const TEXT_STYLES: Record<TextStyleName, { weight: FontWeight; letterSpacing: number }> = {
  title: { weight: 800, letterSpacing: -2 },
  line: { weight: 700, letterSpacing: -1 },
  label: { weight: 700, letterSpacing: 0 },
}

/** 한 줄 글자의 화면 폭(px): 진행폭 합 + 자간(마지막 글자 뒤 제외). */
export function measureTextPx(text: string, size: number, style: TextStyleName = 'title'): number {
  const { weight, letterSpacing } = TEXT_STYLES[style]
  const chars = Array.from(text)
  if (chars.length === 0) return 0
  let em = 0
  for (const ch of chars) em += glyphAdvanceEm(ch, weight)
  return em * size + (chars.length - 1) * letterSpacing
}

// ── 줄바꿈 ────────────────────────────────────────────────────────────
/** 탐욕 줄바꿈: 공백 단위, 단어가 한 줄보다 길면 글자 단위. */
function greedyLines(words: string[], size: number, style: TextStyleName, maxWidthPx: number): string[] {
  const lines: string[] = []
  let cur = ''
  const fits = (s: string) => measureTextPx(s, size, style) <= maxWidthPx
  for (const word of words) {
    if (cur && fits(`${cur} ${word}`)) {
      cur = `${cur} ${word}`
      continue
    }
    if (!cur && fits(word)) {
      cur = word
      continue
    }
    if (fits(word)) {
      lines.push(cur)
      cur = word
      continue
    }
    if (cur) {
      lines.push(cur)
      cur = ''
    }
    for (const ch of Array.from(word)) {
      if (cur && !fits(cur + ch)) {
        lines.push(cur)
        cur = ''
      }
      cur += ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

const MAX_BALANCE_WORDS = 40

/**
 * 줄 수를 늘리지 않고 균형을 맞춘다: 같은 줄 수(= 탐욕 결과)로 나누는 모든 방법 중
 * 가장 긴 줄이 가장 짧은 쪽을 고르되(0.25em 이내 차이는 같은 것으로 봄), 그중 쉼표 뒤에서 끊는 쪽을 우선한다.
 * 그래도 같으면 윗줄이 더 긴 쪽(시안의 끊기).
 */
function balanceLines(words: string[], lineCount: number, size: number, style: TextStyleName, maxWidthPx: number): string[] | null {
  const n = words.length
  if (lineCount < 2 || n > MAX_BALANCE_WORDS || n < lineCount) return null
  const memo = new Map<number, number>()
  const width = (i: number, j: number) => {
    const key = i * 100 + j
    let w = memo.get(key)
    if (w === undefined) {
      w = measureTextPx(words.slice(i, j).join(' '), size, style)
      memo.set(key, w)
    }
    return w
  }
  interface Candidate { cuts: number[]; longest: number; commas: number; first: number }
  const candidates: Candidate[] = []
  const walk = (start: number, linesLeft: number, cuts: number[], longest: number) => {
    if (linesLeft === 1) {
      const w = width(start, n)
      if (w <= maxWidthPx) {
        const commas = cuts.filter(c => /[,，、]$/.test(words[c - 1])).length
        candidates.push({ cuts, longest: Math.max(longest, w), commas, first: width(0, cuts[0]) })
      }
      return
    }
    for (let end = start + 1; end <= n - (linesLeft - 1); end++) {
      const w = width(start, end)
      if (w > maxWidthPx) break
      walk(end, linesLeft - 1, [...cuts, end], Math.max(longest, w))
    }
  }
  walk(0, lineCount, [], 0)
  if (candidates.length === 0) return null
  const best = Math.min(...candidates.map(c => c.longest))
  const pool = candidates.filter(c => c.longest <= best + size * 0.25)
  // 쉼표 뒤 끊기 우선 → 가장 긴 줄(1px 단위) 짧은 쪽 → 같으면 윗줄이 긴 쪽(시안의 끊기)
  pool.sort((a, b) => (b.commas - a.commas) || (Math.round(a.longest) - Math.round(b.longest)) || (b.first - a.first))
  const bounds = [0, ...pool[0].cuts, n]
  return bounds.slice(0, -1).map((s, i) => words.slice(s, bounds[i + 1]).join(' '))
}

export interface FitStep { size: number; maxLines: number }
interface FitResult { size: number; lines: string[]; overflow: boolean; maxLines: number }

/** 단계(크기·최대 줄 수)를 순서대로 시도해 처음 들어가는 단계로 줄바꿈한다. 모두 넘치면 마지막 단계 + overflow. */
function fitSteps(text: string, steps: readonly FitStep[], maxWidthPx: number, style: TextStyleName): FitResult {
  const list = steps.length > 0 ? steps : [{ size: MIN_FONT_PX, maxLines: 1 }]
  const words = text.trim().split(/\s+/).filter(Boolean)
  for (const step of list) {
    const greedy = greedyLines(words, step.size, style, maxWidthPx)
    if (greedy.length <= step.maxLines) {
      const lines = balanceLines(words, greedy.length, step.size, style, maxWidthPx) ?? greedy
      return { size: step.size, lines, overflow: false, maxLines: step.maxLines }
    }
  }
  const last = list[list.length - 1]
  return { size: last.size, lines: greedyLines(words, last.size, style, maxWidthPx), overflow: true, maxLines: last.maxLines }
}

/**
 * sizes 순서대로 시도해 줄 수가 maxLines 이하인 첫 크기를 돌려준다(줄 수는 늘리지 않고 균형 있게 끊음).
 * 모두 넘치면 마지막(가장 작은) 크기로 줄바꿈하고 overflow:true — 글자를 잘라내지 않는다.
 * 글자 폭은 Pretendard 실측(style: title=ExtraBold·자간 -2, line=Bold·자간 -1, label=Bold).
 */
export function fitText(
  text: string,
  sizes: number[],
  maxLines: number,
  maxWidthPx: number,
  style: TextStyleName = 'title',
): { size: number; lines: string[]; overflow: boolean } {
  const { size, lines, overflow } = fitSteps(text, sizes.map(size => ({ size, maxLines })), maxWidthPx, style)
  return { size, lines, overflow }
}

// ── 카드 글자 규칙(렌더러·검증기 공용) ─────────────────────────────────────
export const CARD_TEXT_RULES = {
  contentWidth: CONTENT_W,
  market: {
    title: [{ size: 94, maxLines: 3 }, { size: 80, maxLines: 3 }, { size: 72, maxLines: 3 }] as readonly FitStep[],
    line: [{ size: 58, maxLines: 2 }, { size: 52, maxLines: 2 }, { size: 48, maxLines: 2 }] as readonly FitStep[],
  },
  etf: {
    // 라벨·한 줄이 카드 안에 들어가도록 88·80px은 2줄까지만, 3줄은 72px에서만 허용한다.
    title: [{ size: 88, maxLines: 2 }, { size: 80, maxLines: 2 }, { size: 72, maxLines: 3 }] as readonly FitStep[],
    line: [{ size: 58, maxLines: 2 }] as readonly FitStep[],
    labelSize: 46,
  },
}

/**
 * 카드 문구가 규칙 안에 들어가는지 — 렌더러와 같은 규칙으로 판정한다(검증기가 발행 전에 호출).
 * ok=false면 렌더러는 마지막 줄을 '…'로 줄여 그리지만 문구를 다시 쓰는 편이 낫다.
 */
export function cardTextFits(
  kind: 'market' | 'etf',
  input: { headline: string; line: string; holdingLabel?: string },
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const rules = CARD_TEXT_RULES[kind]
  const check = (name: string, text: string, steps: readonly FitStep[], style: TextStyleName) => {
    if (!text.trim()) {
      reasons.push(`${name}이(가) 비어 있습니다`)
      return
    }
    const r = fitSteps(text, steps, CONTENT_W, style)
    if (r.overflow) reasons.push(`${name}이(가) ${r.size}px에서도 ${r.lines.length}줄이라 최대 ${r.maxLines}줄을 넘습니다`)
  }
  check('headline', input.headline, rules.title, 'title')
  check('line', input.line, rules.line, 'line')
  if (kind === 'etf') {
    const label = (input.holdingLabel ?? '').trim()
    if (!label) reasons.push('holdingLabel이(가) 비어 있습니다')
    else if (measureTextPx(label, CARD_TEXT_RULES.etf.labelSize, 'label') > CONTENT_W) {
      reasons.push(`holdingLabel이(가) ${CARD_TEXT_RULES.etf.labelSize}px 한 줄(${CONTENT_W}px)을 넘습니다`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

// ── 렌더용 맞춤: 어떤 경우에도 카드 밖으로 그리지 않는다 ─────────────────────
/** 한 줄을 maxWidthPx 안에 들어가게 뒤를 자르고 '…'을 붙인다. */
function ellipsize(line: string, size: number, style: TextStyleName, maxWidthPx: number): string {
  const chars = Array.from(line.replace(/[\s,.;:·]+$/, ''))
  while (chars.length > 0 && measureTextPx(chars.join('') + '…', size, style) > maxWidthPx) chars.pop()
  return chars.join('').trimEnd() + '…'
}

function fitForRender(what: string, text: string, steps: readonly FitStep[], style: TextStyleName): { size: number; lines: string[] } {
  const r = fitSteps(text, steps, CONTENT_W, style)
  if (!r.overflow) return { size: r.size, lines: r.lines }
  console.warn(`[data-card] ${what}이(가) ${r.size}px·${r.maxLines}줄에도 넘쳐 마지막 줄을 '…'로 줄입니다: ${text}`)
  const kept = r.lines.slice(0, r.maxLines)
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1], r.size, style, CONTENT_W)
  return { size: r.size, lines: kept }
}

/** 머리 줄: 정식 로고(원본 크롭) | 구분선 | 이름, 오른쪽 끝에 날짜. y는 줄 상단(높이 84). */
function renderBrandRow(y: number, name: string, dateLabel: string): string {
  const logoW = (LOGO_CROP.w * LOGO_H) / LOGO_CROP.h
  const sepX = CONTENT_X + logoW + 26
  const nameX = sepX + 3 + 26
  const midY = y + LOGO_H / 2
  return `<g data-role="brand-row">`
    // 이미지 변형 금지: 원본 그대로 두고 viewBox로 내용 영역만 잘라 보인다(비율 동일).
    + `<svg x="${CONTENT_X}" y="${y}" width="${num(logoW)}" height="${LOGO_H}" viewBox="${LOGO_CROP.x} ${LOGO_CROP.y} ${LOGO_CROP.w} ${LOGO_CROP.h}">`
    + `<image href="${loadBrandLogoDataUri()}" width="1000" height="1000"/></svg>`
    + `<rect x="${num(sepX)}" y="${num(midY - 28)}" width="3" height="56" fill="#D1D5DB"/>`
    + `<text data-role="brand-name" x="${num(nameX)}" y="${num(midY + (ASCENT_EM - DESCENT_EM) / 2 * 46)}" ${FONT_ATTR} font-size="46" font-weight="700" fill="#0B6E61" letter-spacing="-0.5">${escapeXml(name)}</text>`
    + `<text data-role="date" x="${CARD_W - CONTENT_X}" y="${num(midY + (ASCENT_EM - DESCENT_EM) / 2 * 44)}" text-anchor="end" ${FONT_ATTR} font-size="44" font-weight="600" fill="#6B7280">${escapeXml(dateLabel)}</text>`
    + `</g>`
}

interface TextBlock { svg: string; bottom: number }

/** 여러 줄 텍스트 블록. top = CSS 상자 상단, 반환 bottom = 마지막 줄 상자 하단. */
function renderTextBlock(
  role: string,
  lines: string[],
  size: number,
  top: number,
  lineHeight: number,
  style: TextStyleName,
  fill: string,
): TextBlock {
  const { weight, letterSpacing } = TEXT_STYLES[style]
  const lh = size * lineHeight
  const texts = lines.map((line, i) =>
    `<text x="${CONTENT_X}" y="${num(baselineInBox(top + i * lh, size, lh))}" ${FONT_ATTR} font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${letterSpacing}">${escapeXml(line)}</text>`)
  return { svg: `<g data-role="${role}">${texts.join('')}</g>`, bottom: top + lines.length * lh }
}

function wrapCard(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">`
    + `<defs><linearGradient id="mint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#00BFA5"/><stop offset="1" stop-color="#8BE08F"/></linearGradient></defs>`
    + `<rect width="${CARD_W}" height="${CARD_H}" fill="#FFFFFF"/>`
    + body
    // 위쪽 끝 민트 테두리는 맨 위 층에. 하단 띠는 없다.
    + `<rect data-role="top-border" x="0" y="0" width="${CARD_W}" height="12" fill="url(#mint)"/>`
    + `</svg>`
}

export function renderMarketCardSvg(input: MarketCardInput): string {
  const rules = CARD_TEXT_RULES.market
  const stripes = renderStripesSvg(input.sessions, CARD_W, 560, { marker: true })
  const head = renderBrandRow(620, 'Daily Market', cardDateLabel(input.date))
  const title = fitForRender('headline', input.headline, rules.title, 'title')
  const titleBlock = renderTextBlock('headline', title.lines, title.size, 752, 1.2, 'title', '#111827')
  const sub = fitForRender('line', input.line, rules.line, 'line')
  // 제목이 3줄이면 아래로 민다: 제목 블록 하단 + 60px 과 1042 중 큰 값.
  const subTop = Math.max(1042, titleBlock.bottom + 60)
  const subBlock = renderTextBlock('line', sub.lines, sub.size, subTop, 1.32, 'line', '#0F5E55')
  return wrapCard(stripes + head + titleBlock.svg + subBlock.svg)
}

export function renderEtfCardSvg(input: EtfCardInput): string {
  const rules = CARD_TEXT_RULES.etf
  const mosaic = renderMosaicSvg(input.tiles, CARD_W, 600)
  const head = renderBrandRow(640, 'ETF Today', cardDateLabel(input.date))
  const title = fitForRender('headline', input.headline, rules.title, 'title')
  const titleBlock = renderTextBlock('headline', title.lines, title.size, 767, 1.2, 'title', '#111827')
  // 3줄 제목이 라벨 자리(1032)를 침범하면 라벨·한 줄을 함께 아래로 민다(제목 하단과 최소 54px 간격).
  const labelTop = Math.max(1032, titleBlock.bottom + 54)
  const labelSize = rules.labelSize
  let labelText = input.holdingLabel
  if (measureTextPx(labelText, labelSize, 'label') > CONTENT_W) {
    console.warn(`[data-card] holdingLabel이(가) ${labelSize}px 한 줄을 넘어 '…'로 줄입니다: ${labelText}`)
    labelText = ellipsize(labelText, labelSize, 'label', CONTENT_W)
  }
  const label = `<text data-role="holding-label" x="${CONTENT_X}" y="${num(labelTop + ASCENT_EM * labelSize)}" ${FONT_ATTR} font-size="${labelSize}" font-weight="${TEXT_STYLES.label.weight}" fill="#0B6E61">${escapeXml(labelText)}</text>`
  const sub = fitForRender('line', input.line, rules.line, 'line')
  const subBlock = renderTextBlock('line', sub.lines, sub.size, labelTop + 70, 1.3, 'line', '#111827')
  return wrapCard(mosaic + head + titleBlock.svg + label + subBlock.svg)
}

/** SVG 카드를 PNG 파일로 저장하고 outPath를 돌려준다(상위 디렉터리 자동 생성). */
export async function saveCardPng(svg: string, outPath: string): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  return outPath
}
