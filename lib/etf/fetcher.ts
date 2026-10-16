// lib/fetcher.ts
const DEFAULT_TIMEOUT = 10_000

// timeoutMs는 헤더 수신뿐 아니라 본문 읽기(res.json()/res.text())까지 포함한 전체 상한.
// 예전엔 헤더가 오면 타이머를 해제해, 헤더 뒤 본문이 늦게 오는 응답을 끝없이 기다렸다(F07).
// AbortSignal.timeout은 응답 이후에도 신호가 살아 있어 본문 스트림까지 중단시키고,
// 타이머가 unref되어 있어 프로세스 종료를 붙잡지 않는다.
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, options, timeoutMs)
    if (!res.ok) {
      console.error(`[fetcher] HTTP ${res.status}: ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error(`[fetcher] 실패: ${url}`, e)
    return null
  }
}

export async function fetchText(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, options, timeoutMs)
    if (!res.ok) {
      console.error(`[fetcher] HTTP ${res.status}: ${url}`)
      return null
    }
    return await res.text()
  } catch (e) {
    console.error(`[fetcher] 실패: ${url}`, e)
    return null
  }
}
