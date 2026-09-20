// scripts/probe-krx-publish.ts
// KRX OpenAPI가 전일 ETF 일별매매정보를 몇 시에 게시하는지 관측한다 (읽기 전용).
// 파일을 쓰지 않고 로그만 남긴다. 결과는 `gh run view --log`로 읽는다.
// 관측이 끝나면(3~5거래일) 이 스크립트와 워크플로의 krx-probe job을 제거한다.
import { fetchWithTimeout } from "../lib/etf/fetcher";
import { expectedKrxBasDd, probeDeadlinePassed } from "../lib/etf/krx-session";
import { getMarketCalendarInfo } from "../lib/market-calendar";

const URL = "https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd";
const INTERVAL_MS = 5 * 60 * 1000;

function kstNow(): { date: string; hhmm: string; hhmmss: string } {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // "2026-09-21 07:52:03"
  return { date: s.slice(0, 10), hhmm: s.slice(11, 16), hhmmss: s.slice(11, 19) };
}

async function main() {
  const authKey = process.env.KRX_AUTH_KEY;
  if (!authKey) {
    console.log("[krx-probe] KRX_AUTH_KEY 없음 — 관측 건너뜀");
    return;
  }
  const { date } = kstNow();
  if (getMarketCalendarInfo(date).krStatus !== "open") {
    console.log(`[krx-probe] ${date} 한국 휴장 — 관측 건너뜀`);
    return;
  }
  const basDd = expectedKrxBasDd(date);
  console.log(`[krx-probe] 시작 KST ${kstNow().hhmmss} — 기대 기준일 ${basDd}`);

  for (;;) {
    const now = kstNow();
    // fetchJson 은 HTTP 오류·타임아웃을 null 로 뭉개므로 쓰지 않는다 — 키 만료나 KRX 장애가
    // "미게시"로 찍히면 게시 시각 관측 자체가 틀어진다. 조회 실패는 따로 기록한다.
    let rows: { BAS_DD: string }[] = [];
    let failure: string | null = null;
    try {
      const res = await fetchWithTimeout(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", AUTH_KEY: authKey },
        body: JSON.stringify({ basDd }),
      });
      if (!res.ok) failure = `HTTP ${res.status}`;
      else rows = ((await res.json()) as { OutBlock_1?: { BAS_DD: string }[] })?.OutBlock_1 ?? [];
    } catch (e) {
      failure = (e as Error).message;
    }
    if (failure) {
      console.log(`[krx-probe] 조회 실패 KST ${now.hhmmss} 요청=${basDd} — ${failure}`);
    }
    if (rows.length > 0) {
      const rowDates = [...new Set(rows.map((r) => r.BAS_DD))].join(",");
      console.log(`[krx-probe] 게시 확인 KST ${now.hhmmss} 요청=${basDd} 응답 BAS_DD=${rowDates} ${rows.length}건`);
      return;
    }
    if (!failure) console.log(`[krx-probe] 미게시 KST ${now.hhmmss} 요청=${basDd}`);
    if (probeDeadlinePassed(now.hhmm)) {
      console.log(`[krx-probe] 09:10 KST까지 게시 확인 못 함 — 관측 종료`);
      return;
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

// 관측 실패가 빨간 배지를 만들지 않게 항상 exit 0.
main().catch((e) => console.log("[krx-probe] 오류(무시):", (e as Error).message));
