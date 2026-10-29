import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionVolumeFromBars, needsSessionVolume } from './etf-data'

// KST 15:30 = UTC 06:30. Yahoo 일봉 date는 그날 장 시작 시각이지만 KST 날짜만 맞으면 된다.
const bar = (kstDate: string, volume: number | null, close = 100) => ({ date: new Date(`${kstDate}T00:00:00Z`), close, volume })

test('직전 한국 거래일 일봉의 거래량을 고른다 — 오늘 장중 일봉(부분 거래량)은 건너뛴다', () => {
  const bars = [bar('2026-10-26', 30_000_000), bar('2026-10-27', 25_000_000), bar('2026-10-28', 28_000_000), bar('2026-10-29', 885_029)]
  assert.equal(sessionVolumeFromBars(bars, '2026-10-28', 100), 28_000_000)
})

test('휴장 뒤(한글날 10-09) 직전 거래일이 하루 전이 아니어도 그 날짜의 일봉을 고른다', () => {
  const bars = [bar('2026-10-07', 21_000_000), bar('2026-10-08', 32_000_000), bar('2026-10-12', 1_000)]
  assert.equal(sessionVolumeFromBars(bars, '2026-10-08', 100), 32_000_000)
})

test('그 날짜 일봉이 없거나 거래량이 0·null이면 null — 다른 날 값으로 대신하지 않는다', () => {
  assert.equal(sessionVolumeFromBars([bar('2026-10-27', 25_000_000)], '2026-10-28', 100), null)
  assert.equal(sessionVolumeFromBars([bar('2026-10-28', 0)], '2026-10-28', 100), null)
  assert.equal(sessionVolumeFromBars([bar('2026-10-28', null)], '2026-10-28', 100), null)
  assert.equal(sessionVolumeFromBars([], '2026-10-28', 100), null)
})

test('가격이 그 세션 종가와 어긋나면(오늘 장중 가격 + 0 거래량 등) null — 다른 날 거래량을 섞지 않는다', () => {
  const bars = [bar('2026-10-28', 28_000_000, 95_650)]
  assert.equal(sessionVolumeFromBars(bars, '2026-10-28', 95_650), 28_000_000)
  assert.equal(sessionVolumeFromBars(bars, '2026-10-28', 95_700), 28_000_000) // 0.5% 이내 반올림 차
  assert.equal(sessionVolumeFromBars(bars, '2026-10-28', 92_000), null) // 장중 가격
  assert.equal(sessionVolumeFromBars(bars, '2026-10-28', null), null)
  assert.equal(sessionVolumeFromBars([bar('2026-10-28', 28_000_000, null as unknown as number)], '2026-10-28', 95_650), null)
})

test('일봉 보충은 국내 ETF이고 거래량이 0·null·비정상일 때만 — 미국 ETF·정상 거래량은 그대로', () => {
  assert.equal(needsSessionVolume('KR', 0), true)
  assert.equal(needsSessionVolume('KR', null), true)
  assert.equal(needsSessionVolume('KR', Number.NaN), true)
  assert.equal(needsSessionVolume('KR', 885_029), false)
  assert.equal(needsSessionVolume('US', 0), false)
})
