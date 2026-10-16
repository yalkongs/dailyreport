// scripts/dev/fred-calendar-probe.ts — FRED 경제 캘린더 진단(조회 전용).
// 2026-10-16: 전체 releases/dates 호출이 GitHub 러너에서 30초에도 응답하지 않아 캘린더가 매일 비어 있었고,
// lib/economic-calendar.ts 의 릴리스 ID 절반이 다른 지표였다. 릴리스 ID별 이름·다음 발표일·응답 시간을 확인한다.
// 실행: FRED_API_KEY=... npx tsx scripts/dev/fred-calendar-probe.ts [release_id ...]
import { IMPORTANT_RELEASES } from '../../lib/economic-calendar'

const key = process.env.FRED_API_KEY
if (!key) {
  console.error('FRED_API_KEY 필요')
  process.exit(2)
}
const today = new Date().toISOString().slice(0, 10)
const ids = process.argv.slice(2).map(Number).filter(Boolean)

async function get(url: string, timeoutMs = 15000): Promise<{ ms: number; status: number | string; body: unknown }> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${url}&api_key=${key}&file_type=json`, { signal: AbortSignal.timeout(timeoutMs) })
    return { ms: Date.now() - t0, status: res.status, body: await res.json() }
  } catch (e) {
    return { ms: Date.now() - t0, status: (e as Error).name, body: null }
  }
}

async function main() {
  for (const id of ids.length > 0 ? ids : IMPORTANT_RELEASES.map(r => r.id)) {
    const rel = await get(`https://api.stlouisfed.org/fred/release?release_id=${id}`)
    const dates = await get(`https://api.stlouisfed.org/fred/release/dates?release_id=${id}&realtime_start=${today}&realtime_end=9999-12-31&include_release_dates_with_no_data=true&sort_order=asc&limit=3`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (rel.body as any)?.releases?.[0]?.name ?? '-'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ds = ((dates.body as any)?.release_dates ?? []).map((d: { date: string }) => d.date).join(',')
    console.log(`[${id}] ${name} | 다음 발표: ${ds || '-'} | ${dates.status} ${dates.ms}ms`)
  }
}
main()
