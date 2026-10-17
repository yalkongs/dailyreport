import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { saveMarketPreviewImage, marketPreviewFilename } from './market/preview'

// saveMarketPreviewImage 는 process.cwd()/public/reports 에 쓴다 — 임시 작업 디렉터리로 옮겨 실제 public/ 은 건드리지 않는다.
// 카드의 로고도 cwd 기준(public/im-bank-logo.png)으로 읽으므로 임시 디렉터리에 복사해 둔다.
// 콜백이 끝나면(성공·실패 모두) 원래 cwd 로 돌아오고 임시 디렉터리를 지운다 — 결과 검증은 콜백 안에서 한다.
async function withTempCwd(fn: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-preview-'))
  const prev = process.cwd()
  try {
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.copyFileSync(path.join(prev, 'public', 'im-bank-logo.png'), path.join(root, 'public', 'im-bank-logo.png'))
    process.chdir(root)
    await fn(fs.realpathSync(root)) // process.cwd() 는 실제 경로(macOS /var → /private/var)를 돌려준다
  } finally {
    process.chdir(prev)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('Market 미리보기: 데이터 카드 PNG(1080×1350)를 public/reports/<date>-preview.png 로 저장', async () => {
  const sessions = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, pct: (i - 10) / 2 }))
  await withTempCwd(async (root) => {
    const out = await saveMarketPreviewImage('2026-10-16', { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', line: '해외 충격보다 국내 수급 부담이 더 컸습니다', sessions })
    assert.equal(out, path.join(root, 'public', 'reports', marketPreviewFilename('2026-10-16')))
    const meta = await sharp(out).metadata()
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1080, 1350])
  })
})

test('Market 미리보기: 코스피 일봉이 비어도 저장되고, 날짜 형식이 틀리면 거부', async () => {
  await withTempCwd(async () => {
    const out = await saveMarketPreviewImage('2026-10-16', { headline: '제목', line: '한 줄', sessions: [] })
    assert.equal(fs.existsSync(out), true)
    await assert.rejects(saveMarketPreviewImage('../etc', { headline: 'h', line: 'l', sessions: [] }), /invalid date format/)
  })
})

test('Market 미리보기 테스트는 임시 디렉터리를 남기지 않고 원래 작업 디렉터리로 돌아온다', async () => {
  const before = process.cwd()
  let used = ''
  await withTempCwd(async (root) => { used = root })
  assert.equal(process.cwd(), before)
  assert.equal(fs.existsSync(used), false)
})
