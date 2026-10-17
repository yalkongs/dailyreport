import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { saveMarketPreviewImage, marketPreviewFilename } from './market/preview'

// saveMarketPreviewImage 는 process.cwd()/public/reports 에 쓴다 — 임시 작업 디렉터리로 옮겨 실제 public/ 은 건드리지 않는다.
// 카드의 로고도 cwd 기준(public/im-bank-logo.png)으로 읽으므로 임시 디렉터리에 복사해 둔다.
function inTempCwd<T>(fn: () => Promise<T>): Promise<{ root: string; value: T }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-preview-'))
  const prev = process.cwd()
  fs.mkdirSync(path.join(root, 'public'), { recursive: true })
  fs.copyFileSync(path.join(prev, 'public', 'im-bank-logo.png'), path.join(root, 'public', 'im-bank-logo.png'))
  process.chdir(root)
  return fn().then(
    (value) => { process.chdir(prev); return { root, value } },
    (err) => { process.chdir(prev); throw err },
  )
}

test('Market 미리보기: 데이터 카드 PNG(1080×1350)를 public/reports/<date>-preview.png 로 저장', async () => {
  const sessions = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, pct: (i - 10) / 2 }))
  const { root, value } = await inTempCwd(() =>
    saveMarketPreviewImage('2026-10-16', { headline: '코스피 급락 다음 날, 미 증시는 숨 고르기', line: '해외 충격보다 국내 수급 부담이 더 컸습니다', sessions }))
  // process.cwd() 는 실제 경로(macOS /var → /private/var)를 돌려주므로 realpath 로 맞춘다
  assert.equal(value, path.join(fs.realpathSync(root), 'public', 'reports', marketPreviewFilename('2026-10-16')))
  const meta = await sharp(value).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1080, 1350])
})

test('Market 미리보기: 코스피 일봉이 비어도 저장되고, 날짜 형식이 틀리면 거부', async () => {
  const { value } = await inTempCwd(() => saveMarketPreviewImage('2026-10-16', { headline: '제목', line: '한 줄', sessions: [] }))
  assert.equal(fs.existsSync(value), true)
  await assert.rejects(saveMarketPreviewImage('../etc', { headline: 'h', line: 'l', sessions: [] }), /invalid date format/)
})
