// lib/fetcher.ts
const DEFAULT_TIMEOUT = 10_000

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
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
