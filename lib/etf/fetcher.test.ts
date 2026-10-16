import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetchWithTimeout, fetchJson, fetchText } from './fetcher'

// 로컬 서버(127.0.0.1)만 사용 — 외부 네트워크 호출 없음.
// /slow-*: 헤더와 본문 일부는 즉시, 나머지 본문은 BODY_DELAY_MS 뒤에 보낸다.
const BODY_DELAY_MS = 1000
const TIMEOUT_MS = 100
// 본문 지연보다 충분히 이르게 끝나야 "본문 읽기까지 타임아웃이 걸렸다"고 본다
const MUST_FINISH_WITHIN_MS = 700

const pendingTimers = new Set<NodeJS.Timeout>()
let server: http.Server
let baseUrl = ''

before(async () => {
  server = http.createServer((req, res) => {
    const isJson = req.url?.endsWith('-json')
    const contentType = isJson ? 'application/json' : 'text/plain; charset=utf-8'
    if (req.url?.startsWith('/slow-')) {
      res.writeHead(200, { 'content-type': contentType })
      res.write(isJson ? '{"ok":' : 'partial ')
      const timer = setTimeout(() => {
        pendingTimers.delete(timer)
        res.end(isJson ? 'true}' : 'body')
      }, BODY_DELAY_MS)
      pendingTimers.add(timer)
      return
    }
    if (req.url?.startsWith('/fast-')) {
      res.writeHead(200, { 'content-type': contentType })
      res.end(isJson ? '{"ok":true}' : 'fast body')
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  for (const timer of pendingTimers) clearTimeout(timer)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

test('fetchWithTimeout: 헤더 수신 뒤 본문이 늦으면 본문 읽기도 타임아웃으로 중단된다', async () => {
  const started = Date.now()
  const res = await fetchWithTimeout(`${baseUrl}/slow-json`, {}, TIMEOUT_MS)
  assert.equal(res.status, 200, '헤더는 정상 수신')
  await assert.rejects(res.json())
  assert.ok(Date.now() - started < MUST_FINISH_WITHIN_MS, `본문 지연(${BODY_DELAY_MS}ms)까지 기다리지 않아야 함`)
})

test('fetchJson: 본문 지연이 타임아웃을 넘으면 null (본문 지연만큼 기다리지 않음)', async (t) => {
  t.mock.method(console, 'error', () => {})
  const started = Date.now()
  const data = await fetchJson<{ ok: boolean }>(`${baseUrl}/slow-json`, {}, TIMEOUT_MS)
  assert.equal(data, null)
  assert.ok(Date.now() - started < MUST_FINISH_WITHIN_MS, `본문 지연(${BODY_DELAY_MS}ms)까지 기다리지 않아야 함`)
})

test('fetchText: 본문 지연이 타임아웃을 넘으면 null (본문 지연만큼 기다리지 않음)', async (t) => {
  t.mock.method(console, 'error', () => {})
  const started = Date.now()
  const text = await fetchText(`${baseUrl}/slow-text`, {}, TIMEOUT_MS)
  assert.equal(text, null)
  assert.ok(Date.now() - started < MUST_FINISH_WITHIN_MS, `본문 지연(${BODY_DELAY_MS}ms)까지 기다리지 않아야 함`)
})

test('빠른 응답은 그대로 성공: fetchJson은 파싱 객체, fetchText는 본문 문자열', async () => {
  assert.deepEqual(await fetchJson<{ ok: boolean }>(`${baseUrl}/fast-json`, {}, 2000), { ok: true })
  assert.equal(await fetchText(`${baseUrl}/fast-text`, {}, 2000), 'fast body')
  const res = await fetchWithTimeout(`${baseUrl}/fast-json`, {}, 2000)
  assert.deepEqual(await res.json(), { ok: true })
})
