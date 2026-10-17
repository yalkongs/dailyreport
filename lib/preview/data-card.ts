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

export interface StripeSession { date: string; pct: number }          // date YYYY-MM-DD(KST 거래일)
export interface MosaicTile { ticker: string; market: 'KR' | 'US'; category: string; pct: number; featured: boolean }
export interface MarketCardInput { date: string; headline: string; line: string; sessions: StripeSession[] }
export interface EtfCardInput { date: string; headline: string; holdingLabel: string; line: string; tiles: MosaicTile[] }

const CARD_W = 1080
const CARD_H = 1350
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
 * 결과는 KR 전체 → US 전체 순. featuredTheme과 같은 theme의 ETF는 featured.
 */
export function buildMosaicTiles(
  quotes: Array<{ ticker: string; name: string; market: 'KR' | 'US'; changePercent: number | null }>,
  featuredTheme: string | null,
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
          featured: featuredTheme !== null && def?.theme === featuredTheme,
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

// ── 글자 맞춤 ─────────────────────────────────────────────────────────
// 폰트 파일 없이 쓰는 폭 추정(보수적): 한글·전각 1.0em, 영문·숫자·공백 0.55em, 구두점 0.35em.
const PUNCT = new Set([...`.,!?;:'"()[]{}·…‘’“”-–—~`])

function charEm(ch: string): number {
  if (PUNCT.has(ch)) return 0.35
  const c = ch.codePointAt(0) ?? 0
  if (c < 0x80) return 0.55
  return 1.0
}

function textEm(s: string): number {
  let w = 0
  for (const ch of s) w += charEm(ch)
  return w
}

function wrapLines(text: string, size: number, maxWidthPx: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  const fits = (s: string) => textEm(s) * size <= maxWidthPx
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
    // 단어 하나가 한 줄보다 길면 글자 단위로 쪼갠다.
    if (cur) {
      lines.push(cur)
      cur = ''
    }
    for (const ch of word) {
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

/**
 * sizes 순서대로 시도해 줄 수가 maxLines 이하인 첫 크기를 돌려준다.
 * 모두 넘치면 마지막(가장 작은) 크기로 줄바꿈하고 overflow:true — 글자를 잘라내지 않는다.
 */
export function fitText(
  text: string,
  sizes: number[],
  maxLines: number,
  maxWidthPx: number,
): { size: number; lines: string[]; overflow: boolean } {
  const list = sizes.length > 0 ? sizes : [MIN_FONT_PX]
  for (const size of list) {
    const lines = wrapLines(text, size, maxWidthPx)
    if (lines.length <= maxLines) return { size, lines, overflow: false }
  }
  const size = list[list.length - 1]
  return { size, lines: wrapLines(text, size, maxWidthPx), overflow: true }
}

// ── 카드 공통 ─────────────────────────────────────────────────────────
const LOGO_H = 84
const LOGO_CROP = { x: 65, y: 231, w: 871, h: 564 }   // 원본 1000×1000 안의 내용 영역
const CONTENT_X = 72
const CONTENT_W = CARD_W - CONTENT_X * 2             // 936

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
  weight: number,
  fill: string,
  letterSpacing: number,
): TextBlock {
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
  const stripes = renderStripesSvg(input.sessions, CARD_W, 560, { marker: true })
  const head = renderBrandRow(620, 'Daily Market', cardDateLabel(input.date))
  const title = fitText(input.headline, [94, 80, 72], 3, CONTENT_W)
  const titleBlock = renderTextBlock('headline', title.lines, title.size, 752, 1.2, 800, '#111827', -2)
  const sub = fitText(input.line, [58, 52, 48], 2, CONTENT_W)
  // 제목이 3줄이면 아래로 민다: 제목 블록 하단 + 60px 과 1042 중 큰 값.
  const subTop = Math.max(1042, titleBlock.bottom + 60)
  const subBlock = renderTextBlock('line', sub.lines, sub.size, subTop, 1.32, 700, '#0F5E55', -1)
  return wrapCard(stripes + head + titleBlock.svg + subBlock.svg)
}

export function renderEtfCardSvg(input: EtfCardInput): string {
  const mosaic = renderMosaicSvg(input.tiles, CARD_W, 600)
  const head = renderBrandRow(640, 'ETF Today', cardDateLabel(input.date))
  // 아래 라벨·한 줄이 카드 안에 들어가도록 88·80px은 2줄까지만, 3줄은 72px에서만 허용한다.
  const two = fitText(input.headline, [88, 80], 2, CONTENT_W)
  const title = two.overflow ? fitText(input.headline, [72], 3, CONTENT_W) : two
  const titleBlock = renderTextBlock('headline', title.lines, title.size, 767, 1.2, 800, '#111827', -2)
  // 3줄 제목이 라벨 자리(1032)를 침범하면 라벨·한 줄을 함께 아래로 민다(제목 하단과 최소 54px 간격).
  const labelTop = Math.max(1032, titleBlock.bottom + 54)
  const labelSize = 46
  const label = `<text data-role="holding-label" x="${CONTENT_X}" y="${num(labelTop + ASCENT_EM * labelSize)}" ${FONT_ATTR} font-size="${labelSize}" font-weight="700" fill="#0B6E61">${escapeXml(input.holdingLabel)}</text>`
  const sub = fitText(input.line, [58], 2, CONTENT_W)
  const subBlock = renderTextBlock('line', sub.lines, sub.size, labelTop + 70, 1.3, 700, '#111827', -1)
  return wrapCard(mosaic + head + titleBlock.svg + label + subBlock.svg)
}

/** SVG 카드를 PNG 파일로 저장하고 outPath를 돌려준다(상위 디렉터리 자동 생성). */
export async function saveCardPng(svg: string, outPath: string): Promise<string> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  return outPath
}
