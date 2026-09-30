// lib/etf/claude-client.prompt.test.ts
// 묶음 3(2026-09-30): 조립된 ETF 프롬프트가 통합 제목 정책을 담고, 제거한 옛 지시가 없는지.
// 픽스처의 최근 헤드라인·뉴스는 금지 문구가 없는 값으로만 채운다(입력 인용 구간 오탐 방지).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_PROMPT, buildMorningPrompt } from './claude-client'
import { getMarketCalendarInfo } from '../market-calendar'
import type { CollectedData, MacroContext } from './types'

interface Opts { angle?: string; mode?: 'event' | 'quiet' | 'normal'; tier?: 'strong' | 'thin' | 'hollow' }
function makeData(date: string, recentHeadlines: string[], o: Opts = {}): CollectedData {
  return {
    reportType: 'morning',
    date,
    quotes: [],
    flows: [],
    investorFlows: [],
    macro: { usdKrw: null, dxy: null, vix: null, moveIndex: null, us10y: null, fearGreed: null, wti: null, gold: null } as MacroContext,
    news: [],
    analysisLens: '변동성국면',
    recentHeadlines,
    narrativeAngle: o.angle ?? '글로벌→국내_전이',
    calendarInfo: getMarketCalendarInfo(date),
    failedSources: [],
    ...(o.mode ? { etfMode: { mode: o.mode, reason: '테스트', metrics: { soxxChange: null, spyChange: null, kospiProxy: null, vix: null, anomalyCount: 0 } } as any } : {}),
    ...(o.tier ? { etfEvidence: { tier: o.tier, newsCount: 0, freshCount: 0, topCatalystScore: 0, topCatalyst: null, anomalyCount: 0, failedSources: [], reason: '테스트' } } : {}),
  }
}

const REMOVED = [
  '앵커(수치·티커) **하나**를 앞세우되',
  '반드시 명사구',
  '홀로 하락',
  '반도체 6% 붕괴',
  '옮겨붙',
  '두 얼굴',
  '불씨가 옮겨가는',
  '헤드라인은 "주말 뒤 시작"',
  '헤드라인은 "한 주를 닫는"',
]

test('ETF 사용자 프롬프트(월요일·최근 헤드라인 있음): 새 제목 정책 포함, 옛 지시 없음', () => {
  const p = buildMorningPrompt(makeData('2026-09-28', ['원자재 강세 속 금융주 선방']))
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
  assert.match(p, /등락률·티커를 제목 맨 앞 앵커로 두지 마십시오/)
  assert.match(p, /시간명사 종결/)
  assert.match(p, /tier 는 강도만 정합니다/)
  assert.match(p, /\[최근 ETF 리포트 헤드라인/)
  for (const s of REMOVED) assert.ok(!p.includes(s), s)
})

test('ETF 사용자 프롬프트(금요일): 요일 리듬에 헤드라인 지시 없음', () => {
  const p = buildMorningPrompt(makeData('2026-09-18', []))
  assert.match(p, /금요일 회수/)
  for (const s of REMOVED) assert.ok(!p.includes(s), s)
})

test('최근 헤드라인이 없어도 제목 정책은 온전하다(깨진 블록 참조 없음)', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.doesNotMatch(p, /\[최근 ETF 리포트 헤드라인 — 절대/)
  assert.match(p, /\[cover\.headline 작성 규칙\]/)
  assert.match(p, /최근 ETF 리포트 헤드라인\]에 이미 등장했으면/) // 조건부 참조 문구는 "있을 때" 규칙으로 유지
})

test('ETF 시스템 프롬프트: ETF 예시 세트 + 본문 규칙의 제목 예외 표기', () => {
  assert.ok(SYSTEM_PROMPT.includes('원화, 하루 만에 20원 되찾다'))
  assert.ok(!SYSTEM_PROMPT.includes('금리 올린 연준, 달러만 웃었다'))
  assert.match(SYSTEM_PROMPT, /격식체 사용 \("~입니다", "~습니다"\) \(cover\.headline 제외/)
  assert.match(SYSTEM_PROMPT, /도치를 허용합니다\. \(cover\.headline 제외/)
})

test('국내 ETF 6자리 코드 규칙에 제목 예외 표기', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', []))
  assert.match(p, /"종목명 \(6자리 코드\)"로 표기하십시오\. \(cover\.headline 제외 — \[cover\.headline 작성 규칙\] 참조\)/)
})

test('환율 앵글: "두 얼굴" 대신 "상반된 효과"', () => {
  const p = buildMorningPrompt(makeData('2026-09-30', [], { angle: '환율_양면성' }))
  assert.match(p, /오늘의 서사 앵글: 환율_양면성/)
  assert.match(p, /상반된 효과/)
  assert.ok(!p.includes('두 얼굴'))
})

test('이벤트·잠잠 모드와 명시 tier에서도 옛 지시·깨진 참조가 없다', () => {
  for (const mode of ['event', 'quiet', 'normal'] as const) {
    for (const tier of ['strong', 'thin', 'hollow'] as const) {
      const p = buildMorningPrompt(makeData('2026-09-30', ['원자재 강세 속 금융주 선방'], { mode, tier }))
      assert.match(p, new RegExp(`근거 상태 — tier: ${tier}`))
      assert.ok(!p.includes('[제목 작성 규칙]'), `${mode}/${tier} 깨진 참조`)
      for (const s of REMOVED) assert.ok(!p.includes(s), `${mode}/${tier}: ${s}`)
    }
  }
})
