import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findSessionOrderViolations, findCardSessionOrderViolations } from './session-order-check'
import { buildSessionTimeline } from '../session-timeline'

const T1123 = buildSessionTimeline('2026-11-23') // 국내 11/20(금), 간밤 미국 11/20(금)
const SOX_1120 = [{ symbol: '^SOX', nameKo: '필라델피아 반도체지수', price: 1, changePercent: -10.73, asOf: '2026-11-20' }]

test('타임라인: 국내 전일 세션·직전 미국 장·간밤 미국 장(미국 휴장 반영)', () => {
  assert.deepEqual(buildSessionTimeline('2026-11-26'), { reportDate: '2026-11-26', krSession: '2026-11-25', priorUsSession: '2026-11-24', overnightUsSession: '2026-11-25', overnightAfterKr: true })
  const t = buildSessionTimeline('2026-11-27') // 11/26 추수감사절
  assert.equal(t.overnightUsSession, '2026-11-25')
  assert.equal(t.overnightAfterKr, false)
})

test('문장: 간밤 지수 수치로 국내 ETF 전일 등락을 설명하면 위반(11-23 실문장)', () => {
  const s = 'AI 쇼크가 지난 금요일 필라델피아 반도체지수를 10.73% 끌어내렸고, 국내 반도체 ETF도 그 충격을 고스란히 받았습니다.'
  assert.equal(findSessionOrderViolations(s, T1123, SOX_1120).length, 1)
})

test('문장: 오늘 개장 신호로 쓰면 통과 · 미국 휴장일엔 검사 안 함', () => {
  const ok = '간밤 필라델피아 반도체지수 10.73% 급락의 여파가 오늘 국내 반도체 ETF 개장에 부담입니다.'
  assert.deepEqual(findSessionOrderViolations(ok, T1123, SOX_1120), [])
  const bad = '간밤 나스닥 하락의 여파로 국내 반도체 ETF가 밀렸습니다.'
  assert.equal(findSessionOrderViolations(bad, T1123, []).length, 1)
  assert.deepEqual(findSessionOrderViolations(bad, buildSessionTimeline('2026-11-27'), []), [])
})

test('카드: 국내 상장 ETF 카드의 이유 칸에 간밤 미국 장(11-24 실문장) → 위반, 세션을 갈라 쓴 대비는 통과', () => {
  const slots = [
    { key: 'kr-semi-it', label: '국내 반도체·IT', reps: [{ market: 'KR' as const }, { market: 'KR' as const }] },
    { key: 'us-equity', label: '미국 주식', reps: [{ market: 'KR' as const }, { market: 'US' as const }] },
  ]
  const t = buildSessionTimeline('2026-11-24')
  const bad = [{ key: 'kr-semi-it', reason: '젠슨 황 CEO 복귀 소식으로 간밤 미 증시에서 엔비디아 주가가 약 33% 급등했습니다.' }]
  assert.equal(findCardSessionOrderViolations(bad, slots, t).length, 1)
  const split = [{ key: 'kr-semi-it', reason: '전일 국내 반도체 ETF가 4~6%대 오른 가운데, 간밤 필라델피아 반도체지수는 2.4% 하락해 방향이 엇갈렸습니다.' }]
  assert.deepEqual(findCardSessionOrderViolations(split, slots, t), [])
  const mixed = [{ key: 'us-equity', reason: '간밤 나스닥이 0.62% 하락했습니다.' }]
  assert.deepEqual(findCardSessionOrderViolations(mixed, slots, t), [])
})
