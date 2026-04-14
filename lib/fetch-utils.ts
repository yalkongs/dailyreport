/**
 * 공통 fetch 유틸리티 — AbortController 기반 타임아웃
 */

export async function fetchWithTimeout<T>(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    method?: string;
    body?: string | URLSearchParams;
  } = {}
): Promise<T> {
  const { timeoutMs = 10000, headers = {}, method = "GET", body } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body) {
      fetchOptions.body = body;
    }

    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextWithTimeout(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<string> {
  const { timeoutMs = 10000, headers = {} } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
