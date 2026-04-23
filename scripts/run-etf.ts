// scripts/run-etf.ts — ETF morning pipeline (absorbed from etfreport).
//
// Runs after the market report pipeline in the daily GitHub Actions
// workflow. Fully independent: ETF failure does not affect the already-
// sent market report, and vice versa.

import * as fs from 'fs'
import * as path from 'path'
import { collectAllEtfData } from '../lib/etf/etf-data'
import { collectMacroContext } from '../lib/etf/market-context'
import { collectNews } from '../lib/etf/news'
import { detectAnomalies } from '../lib/etf/analyzer'
import {
  generateMorningReport,
  generateMorningReportRaw,
  validateMorningReport,
} from '../lib/etf/claude-client'
import { selectAnalysisLens } from '../lib/etf/analysis-lens'
import { renderMorningHtml, saveReport, saveReportPreviewImage } from '../lib/etf/renderer'
// NOTE: Only the error-notification path is imported. The success-path
// Telegram send was moved to the GitHub Actions workflow so that the
// message is dispatched AFTER git push + Vercel redeploy — otherwise
// the link preview would scrape a 404 and Telegram caches that as
// "no preview card" for the URL.
import { sendError } from '../lib/etf/telegram'
import {
  validateData,
  updateReportsIndex,
  loadJson,
  saveJson,
} from '../lib/etf/pipeline-utils'
import type { CollectedData, ReportMeta, MacroContext, AnomalyType } from '../lib/etf/types'

const LENS_LOG_PATH = 'data/etf-lens-log.json'

async function main() {
  // Use KST timezone to correctly label reports (06:30 KST = 21:30 UTC prev day).
  // ETF_REPORT_DATE (YYYY-MM-DD) overrides the auto-computed date — useful
  // for backfilling missing archive entries. Data collection still uses
  // the current market snapshot; the override only changes the label and
  // output filenames.
  const override = process.env.ETF_REPORT_DATE?.trim()
  if (override && !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    throw new Error(`ETF_REPORT_DATE must be YYYY-MM-DD, got "${override}"`)
  }
  const date = override || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  console.log(`\n=== ETF Morning Pipeline: ${date}${override ? ' (override)' : ''} ===\n`)

  // Step 0: 중복 실행 방지 가드 — 같은 날짜 ETF 리포트가 이미 있으면 종료
  // (GH Actions 크론 지연 + 수동 트리거 겹침 같은 상황에서 두 번째 실행을
  //  조용히 종료시켜 Telegram 재발송을 예방. 시장 스크립트의 Step 1a와 동일.)
  {
    const htmlPath = path.resolve(process.cwd(), 'public', 'etf-reports', `${date}.html`)
    const indexPath = path.resolve(process.cwd(), 'data', 'etf-reports-index.json')
    let todayEntry: { headline?: string; createdAt?: string } | undefined
    if (fs.existsSync(indexPath)) {
      const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as { reports: { date: string; headline?: string; createdAt?: string }[] }
      todayEntry = idx.reports.find(r => r.date === date)
    }
    if (fs.existsSync(htmlPath) && todayEntry) {
      if (process.env.FORCE_REGENERATE === 'true') {
        console.log(`⚠️ 오늘(${date}) ETF 리포트가 이미 존재하지만 FORCE_REGENERATE=true로 재생성합니다.`)
      } else {
        console.log(`✋ 오늘(${date}) ETF 리포트가 이미 존재합니다. 종료합니다.`)
        console.log(`   기존 파일: ${htmlPath}`)
        console.log(`   기존 헤드라인: "${todayEntry.headline ?? ''}"`)
        console.log(`   기존 생성 시각: ${todayEntry.createdAt ?? ''}`)
        console.log(`   강제 재생성이 필요하면 FORCE_REGENERATE=true 로 실행하세요.`)
        process.exit(0)
      }
    }
  }

  // Step 1: 데이터 수집 (병렬)
  console.log('[1/8] 데이터 수집 중...')
  const [etfData, macro, news] = await Promise.allSettled([
    collectAllEtfData(),
    collectMacroContext(),
    collectNews(),
  ])

  const { quotes, flows, investorFlows } = etfData.status === 'fulfilled'
    ? etfData.value : { quotes: [], flows: [], investorFlows: [] }

  // Step 2: 데이터 검증
  console.log('[2/8] 데이터 검증 중...')
  try {
    validateData(quotes)
  } catch (e) {
    await sendError('데이터 검증', e)
    process.exit(1)
  }

  // Step 3: 분석 렌즈 선택
  const recentLenses = loadJson<string[]>(LENS_LOG_PATH, [])
  const analysisLens = selectAnalysisLens(recentLenses, { flows })
  console.log(`[3/8] 분석 렌즈: ${analysisLens}`)

  // Step 4: 이상 탐지
  console.log('[4/8] 이상 탐지 중...')
  const anomalies = detectAnomalies(quotes, flows, investorFlows)
  console.log(`  → ${anomalies.length}건 탐지`)

  // Step 4a: 최근 헤드라인 로드 (반복 방지용)
  const etfIndex = loadJson<{ reports?: { date: string; headline?: string }[] }>(
    'data/etf-reports-index.json',
    { reports: [] },
  )
  const recentHeadlines = (etfIndex.reports ?? [])
    .filter(r => r.date !== date && r.headline)
    .slice(0, 7)
    .map(r => r.headline as string)

  const data: CollectedData = {
    reportType: 'morning',
    date,
    quotes,
    flows,
    investorFlows,
    macro: macro.status === 'fulfilled' ? macro.value : {} as MacroContext,
    news: news.status === 'fulfilled' ? news.value : [],
    analysisLens,
    recentHeadlines,
  }

  // Step 5: Claude 분석 (최대 2회 시도 + Tier 1 fallback)
  // P0 (2026-04-24): 기존 3회 재시도는 대증요법(패턴 좁히기)에 의존해 왔음.
  // 새 구조: 2회 검증 실패 시 narrativeNotes 를 drop한 Tier 1 수준 리포트로
  // fallback 검증 → 성공 시 발송, 실패 시에만 Telegram 에러. 새벽 침묵 리스크 ↓.
  console.log('[5/8] Claude 리포트 생성 중...')
  const MAX_CLAUDE_ATTEMPTS = 2
  let report: Awaited<ReturnType<typeof generateMorningReport>> | undefined
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_CLAUDE_ATTEMPTS; attempt++) {
    try {
      report = await generateMorningReport(data)
      if (attempt > 1) {
        console.log(`  ✓ ${attempt}회차에서 성공`)
      }
      break
    } catch (e) {
      lastError = e
      if (attempt < MAX_CLAUDE_ATTEMPTS) {
        console.warn(`[warn] Claude API ${attempt}/${MAX_CLAUDE_ATTEMPTS}회 실패, 재시도:`, (e as Error).message)
      } else {
        console.warn(`[warn] Claude API ${MAX_CLAUDE_ATTEMPTS}회 모두 실패. Tier 1 fallback 시도:`, (e as Error).message)
      }
    }
  }

  // P0 fallback: narrativeNotes 만 drop해서 Tier 1 하드코딩 본문으로 렌더링
  if (!report) {
    try {
      console.log('[5b/8] Tier 1 fallback — narrativeNotes drop 후 재검증')
      const raw = await generateMorningReportRaw(data)
      const stripped: typeof raw = { ...raw, narrativeNotes: undefined }
      validateMorningReport(stripped, data)
      report = stripped
      console.log('  ✓ Tier 1 fallback 성공 — narrativeNotes 없이 발송합니다')
    } catch (fallbackErr) {
      console.error('[error] Tier 1 fallback도 실패:', (fallbackErr as Error).message)
      await sendError('Claude API (fallback 실패)', lastError)
      process.exit(1)
    }
  }

  // Step 6: HTML 렌더링
  console.log('[6/8] HTML 렌더링 중...')
  const publicBaseUrl =
    process.env.ETF_PUBLIC_BASE_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    'https://dailyreport-eta.vercel.app'
  const html = renderMorningHtml(report, data, { publicBaseUrl })
  saveReport(html, date)
  await saveReportPreviewImage(date, report.cover.headline, report.cover.subline)

  // Step 7: 인덱스 업데이트
  console.log('[7/8] 인덱스 갱신 중...')
  const reportUrl = `${publicBaseUrl.replace(/\/$/, '')}/etf-reports/${date}`
  // 룰 종류별 카운트 집계 (Telegram 메시지에서 분리 표기용)
  const breakdown: Partial<Record<AnomalyType, number>> = {}
  for (const a of anomalies) {
    breakdown[a.type] = (breakdown[a.type] ?? 0) + 1
  }
  const meta: ReportMeta = {
    date,
    type: 'morning',
    headline: report.cover.headline,
    url: reportUrl,
    anomalyCount: anomalies.length,
    anomalyBreakdown: breakdown,
    createdAt: new Date().toISOString(),
  }
  updateReportsIndex(meta)
  saveJson(LENS_LOG_PATH, [...recentLenses, analysisLens].slice(-30))

  // Telegram send lives in .github/workflows/daily-report.yml (after
  // commit + push + Vercel redeploy). Running this script locally never
  // sends to Telegram, by design — even if tokens are present in env.
  console.log(`\n✅ ETF Morning 파일 생성 완료: ${reportUrl}\n`)
  console.log('(Telegram 발송은 워크플로의 별도 step에서 처리됨)')
}

main().catch(async (e) => {
  console.error('파이프라인 오류:', e)
  await sendError('ETF Pipeline', e)
  process.exit(1)
})
