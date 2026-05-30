import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { appendEtfEvidenceLog, type EtfEvidenceLogEntry } from './etf-evidence-log'

function entry(date: string): EtfEvidenceLogEntry {
  return {
    date,
    tier: 'thin',
    mode: 'normal',
    newsCount: 5,
    freshCount: 3,
    topCatalystScore: 6,
    anomalyCount: 2,
    anomalyBreakdown: { premiumDiscount: 2 },
    failedSources: [],
  }
}
function tmpPath(): string {
  return path.join(os.tmpdir(), `etf-evidence-log-${Date.now()}-${Math.floor(process.uptime() * 1e9)}.json`)
}

test('파일 없을 때 첫 호출 → 엔트리 1개', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.equal(stored.length, 1)
    assert.equal(stored[0].date, '2026-05-30')
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('기존 엔트리 뒤에 append', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-28'), { path: p })
    appendEtfEvidenceLog(entry('2026-05-29'), { path: p })
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.deepEqual(stored.map(e => e.date), ['2026-05-28', '2026-05-29', '2026-05-30'])
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('retention 슬라이스 — 한도 초과 시 가장 오래된 것 제거', () => {
  const p = tmpPath()
  try {
    appendEtfEvidenceLog(entry('2026-05-28'), { path: p, retentionDays: 2 })
    appendEtfEvidenceLog(entry('2026-05-29'), { path: p, retentionDays: 2 })
    appendEtfEvidenceLog(entry('2026-05-30'), { path: p, retentionDays: 2 })
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.deepEqual(stored.map(e => e.date), ['2026-05-29', '2026-05-30'])
  } finally {
    fs.rmSync(p, { force: true })
  }
})

test('기본 retention 60 — 61건 입력 시 가장 오래된 1건이 잘림', () => {
  const p = tmpPath()
  try {
    for (let i = 1; i <= 61; i++) {
      appendEtfEvidenceLog(
        { ...entry('2026-05-30'), date: `day-${String(i).padStart(3, '0')}` },
        { path: p }, // retentionDays 생략 → 기본 60 사용
      )
    }
    const stored = JSON.parse(fs.readFileSync(p, 'utf-8')) as EtfEvidenceLogEntry[]
    assert.equal(stored.length, 60)
    assert.equal(stored[0].date, 'day-002') // 가장 오래된 day-001이 잘림
    assert.equal(stored[59].date, 'day-061')
  } finally {
    fs.rmSync(p, { force: true })
  }
})
