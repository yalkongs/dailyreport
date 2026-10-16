// lib/etf/fx-direction.test.ts
// C02 (2026-10-16 감사): 환노출 ETF의 환율 효과 방향. 원/달러 상승(원화 약세)은 환노출 해외 ETF의
// 원화 환산 성과에 플러스다. "원화 약세가 수익을 깎는다"는 고정 문구가 렌더러·전략·앵글에 박혀 있었다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describeAngle } from './narrative-angle'
import { buildMacroBlock } from './claude-client'
import { findFxDirectionErrors } from './report-quality'
import type { MacroContext } from './types'

const WRONG_DIRECTION = /원화\s*약세[^'`\n.]{0,25}(부담|깎|손실|상쇄)|환율이\s*깎/

// claude-client.ts는 금지 서술을 예로 들어야 하므로 제외 — 모델 출력은 findFxDirectionErrors가 검증한다.
for (const file of ['renderer.ts', 'morning-strategy.ts', 'narrative-angle.ts']) {
  test(`소스 스캔: ${file}에 '원화 약세 = 손실' 고정 문구가 없다`, () => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.doesNotMatch(src, WRONG_DIRECTION)
  })
}

test('환율_양면성 앵글: 변화 방향의 환산 효과와 진입 수준의 위험을 구분해 설명한다', () => {
  const d = describeAngle('환율_양면성')
  assert.match(d, /원화 약세/)
  assert.match(d, /환산[^.]{0,10}(이익|플러스)/)
  assert.match(d, /원화 강세/)
  assert.match(d, /상반된 효과/) // 기존 프롬프트 테스트 계약 유지
  assert.match(d, /\(H\)|환헤지/)
})

const MACRO: MacroContext = { usdKrw: 1475.4, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null }

test('거시 블록: USD/KRW 전일 대비 변화와 원화 방향을 함께 준다', () => {
  assert.match(buildMacroBlock({ ...MACRO, usdKrwChangePercent: 0.42 }, []), /USD\/KRW: 1,475 \(전일 대비 \+0\.42% · 원화 약세\)/)
  assert.match(buildMacroBlock({ ...MACRO, usdKrwChangePercent: -0.3 }, []), /\(전일 대비 -0\.30% · 원화 강세\)/)
  assert.match(buildMacroBlock(MACRO, []), /USD\/KRW: 1,475\n/)
})

test('검증: 원화 약세를 환노출 손실로 쓰면 잡는다', () => {
  assert.ok(findFxDirectionErrors('원화 약세가 재개되면 환노출 해외 ETF에서 환율 손실이 지수 수익을 상쇄할 수 있습니다.').length > 0)
  assert.ok(findFxDirectionErrors('나스닥이 오른 폭과 원/달러 환율이 깎아낸 폭을 따로 봅니다.').length > 0)
})

test('검증: 방향이 맞는 서술과 진입 수준 위험 서술은 통과한다', () => {
  assert.deepEqual(findFxDirectionErrors('원화 약세는 환노출 해외 ETF의 원화 환산 성과에 보탬이 됩니다.'), [])
  assert.deepEqual(findFxDirectionErrors('환율이 높은 지금 새로 담으면 이후 원화 강세 때 환산 손실을 볼 수 있습니다.'), [])
  assert.deepEqual(findFxDirectionErrors('원화 약세 구간에서 담은 몫은 원화가 강세로 돌아서면 환손실이 납니다.'), [])
})
