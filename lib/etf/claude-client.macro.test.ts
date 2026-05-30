import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMacroBlock } from './claude-client'
import type { MacroContext } from './types'

const emptyMacro: MacroContext = {
  usdKrw: null, dxy: null, vix: null, moveIndex: null,
  us10y: null, fearGreed: null, wti: null, gold: null,
}

test('failedSources에 macro 포함 → 경고 줄이 헤더 직후 등장', () => {
  const out = buildMacroBlock(emptyMacro, ['macro'])
  const lines = out.split('\n')
  assert.equal(lines[0], '[거시 지표]')
  assert.match(lines[1], /거시 데이터 수집 실패/)
  assert.match(lines[1], /신뢰할 수 없습니다/)
})

test('failedSources에 macro 없음(빈 배열) → 경고 없음', () => {
  const out = buildMacroBlock(emptyMacro, [])
  assert.equal(out.split('\n')[0], '[거시 지표]')
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('failedSources undefined → 경고 없음', () => {
  const out = buildMacroBlock(emptyMacro, undefined)
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('다른 키만 실패(news) → macro 경고 없음 (macro 키만 트리거)', () => {
  const out = buildMacroBlock(emptyMacro, ['news', 'krx-nav'])
  assert.doesNotMatch(out, /거시 데이터 수집 실패/)
})

test('지표 7줄(USD/KRW·VIX·MOVE·공포탐욕·US 10Y·WTI·Gold)이 항상 존재', () => {
  const out = buildMacroBlock(emptyMacro, [])
  assert.match(out, /USD\/KRW:/)
  assert.match(out, /VIX:/)
  assert.match(out, /MOVE:/)
  assert.match(out, /공포탐욕:/)
  assert.match(out, /US 10Y:/)
  assert.match(out, /WTI:/)
  assert.match(out, /Gold:/)
})
