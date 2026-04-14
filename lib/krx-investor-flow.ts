/**
 * KRX 투자자별 매매동향 수집기
 * OTP 방식: generateOTP → getJsonData
 * 타임아웃 15초 (KRX 서버 응답이 느림)
 */

import type { InvestorFlow } from "./types";

const KRX_OTP_URL = "http://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd";
const KRX_DATA_URL = "http://data.krx.co.kr/comm/fileDn/download_csv/download.cmd";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Referer: "http://data.krx.co.kr/contents/MDC/MDI/mdiIO/index.do",
};

export async function collectInvestorFlow(): Promise<InvestorFlow | null> {
  const apiKey = process.env.KRX_API_KEY;

  // 오늘 날짜 (KST)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const trdDd = `${kst.getFullYear()}${String(kst.getMonth() + 1).padStart(2, "0")}${String(kst.getDate()).padStart(2, "0")}`;

  try {
    // API 키가 있으면 Open API 사용
    if (apiKey) {
      return await collectViaOpenApi(apiKey, trdDd);
    }

    // API 키 없으면 OTP 방식
    return await collectViaOtp(trdDd);
  } catch (err) {
    console.log(`  ⚠️ KRX 투자자 매매동향 수집 실패: ${(err as Error).message}`);
    return null;
  }
}

async function collectViaOpenApi(apiKey: string, trdDd: string): Promise<InvestorFlow | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `http://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${trdDd}&AUTH_KEY=${apiKey}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.OutBlock_1 || data.OutBlock_1.length === 0) {
      // 당일 데이터 없으면 전일 시도
      return null;
    }

    // OutBlock_1에서 투자자별 합계 추출
    let foreign = { buy: 0, sell: 0, net: 0 };
    let institution = { buy: 0, sell: 0, net: 0 };
    let individual = { buy: 0, sell: 0, net: 0 };

    for (const row of data.OutBlock_1) {
      const invstTpNm = row.INVST_TP_NM || "";
      const buyAmt = parseInt(row.ASK_TRDVAL || "0", 10);
      const sellAmt = parseInt(row.BID_TRDVAL || "0", 10);

      if (invstTpNm.includes("외국인")) {
        foreign = { buy: buyAmt, sell: sellAmt, net: sellAmt - buyAmt };
      } else if (invstTpNm.includes("기관")) {
        institution = { buy: buyAmt, sell: sellAmt, net: sellAmt - buyAmt };
      } else if (invstTpNm.includes("개인")) {
        individual = { buy: buyAmt, sell: sellAmt, net: sellAmt - buyAmt };
      }
    }

    return { date: trdDd, foreign, institution, individual };
  } finally {
    clearTimeout(timer);
  }
}

async function collectViaOtp(trdDd: string): Promise<InvestorFlow | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    // Step 1: OTP 생성
    const otpParams = new URLSearchParams({
      locale: "ko_KR",
      mktId: "STK",
      trdDd,
      money: "1",
      csvxls_is498: "false",
      name: "fileDown",
      url: "dbms/MDC/STAT/standard/MDCSTAT02203",
    });

    const otpRes = await fetch(KRX_OTP_URL, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: otpParams,
      signal: controller.signal,
    });

    if (!otpRes.ok) throw new Error(`OTP HTTP ${otpRes.status}`);
    const otp = await otpRes.text();

    if (!otp || otp.includes("<html")) {
      throw new Error("OTP 응답이 HTML — KRX 차단 가능성");
    }

    // Step 2: 데이터 조회
    const dataParams = new URLSearchParams({ code: otp });
    const dataRes = await fetch(KRX_DATA_URL, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: dataParams,
      signal: controller.signal,
    });

    if (!dataRes.ok) throw new Error(`Data HTTP ${dataRes.status}`);
    const csvText = await dataRes.text();

    return parseCsvInvestorFlow(csvText, trdDd);
  } finally {
    clearTimeout(timer);
  }
}

function parseCsvInvestorFlow(csv: string, date: string): InvestorFlow | null {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;

  let foreign = { buy: 0, sell: 0, net: 0 };
  let institution = { buy: 0, sell: 0, net: 0 };
  let individual = { buy: 0, sell: 0, net: 0 };

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.replace(/"/g, "").trim());
    const name = cols[0] || "";
    const buy = parseInt((cols[1] || "0").replace(/,/g, ""), 10) || 0;
    const sell = parseInt((cols[2] || "0").replace(/,/g, ""), 10) || 0;
    const net = parseInt((cols[3] || "0").replace(/,/g, ""), 10) || 0;

    if (name.includes("외국인")) {
      foreign = { buy, sell, net };
    } else if (name.includes("기관")) {
      institution = { buy, sell, net };
    } else if (name.includes("개인")) {
      individual = { buy, sell, net };
    }
  }

  return { date, foreign, institution, individual };
}
