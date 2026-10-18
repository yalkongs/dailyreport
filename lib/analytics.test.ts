import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'

test('사이트 전체 레이아웃에 Web Analytics', () => {
  const s = fs.readFileSync('src/app/layout.tsx', 'utf8')
  assert.match(s, /from ['"]@vercel\/analytics\/next['"]/)
  assert.match(s, /<Analytics\s*\/>/)
  assert.ok(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies['@vercel/analytics'])
})
