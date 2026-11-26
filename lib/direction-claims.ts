// lib/direction-claims.ts
//
// 본문의 "자산 + 방향어" 주장을 입력 데이터의 부호와 대조한다(2026-11-27, 11-19~26 주간 점검 대책 3).
//   11-20 ETF "금 현물 강세"(GLD -1.76%) · 11-26 ETF "10년물 4.85%를 유지"(-5.6bp) · 11-26 ETF "금 현물도 강세를 이어갔는데"
// 오탐이 재생성으로 이어지므로 보수적으로 판정한다(10~11월 리포트 80건 역검증으로 다듬음):
//   - 방향어가 그 자산의 술어일 때만 — 이름과 방향어 사이에는 조사·수치·'현물/선물'·'소폭' 같은 말만 허용
//     ("다우존스는 유가 하락 수혜…"처럼 다른 대상의 방향어는 잡지 않는다)
//   - 조건·전망·의문·여부 문장, 오늘·지난주·기간 비교(1년 전 대비·3개월 새) 문장은 건너뜀
//   - 입력 등락이 작으면(기본 |0.3|% 미만) 방향을 다투지 않는다
//   - '높은 수준을 유지'는 수준 서술이라 방향 주장으로 보지 않는다

export interface DirectionAsset {
  label: string;
  /** 문장 속 자산 이름(g 플래그 없이). */
  pattern: RegExp;
  /** 입력의 하루 변화 — 지수·원자재는 %, 금리는 %p. null 이면 대조하지 않는다. */
  change: number | null;
  /** 방향을 다툴 최소 변화(같은 단위). */
  minAbs: number;
  /** 변화 단위 표기(금리는 bp). */
  unit?: "pct" | "bp";
}

const UP = /^(?:올랐|오른|오르며|오르면서|올라|상승|강세|반등|급등|뛰었|뛰며|뛰어|치솟|오름세)/;
const DOWN = /^(?:내렸|내린|내리며|내려|하락|약세|밀렸|밀리며|밀려|급락|떨어|빠졌|빠지며|내림세)/;

// 이름과 방향어 사이에 올 수 있는 말(조사·수치·수식). 이것 말고 다른 단어가 끼면 방향어의 주어가 다를 수 있어 판단하지 않는다.
const GAP_TOKEN = String.raw`(?:현물|선물|가격|값|지수|금리|수익률|국채|종가|도|은|는|이|가|을|를|의|와|과|로|으로|나|이나|도|만|약|소폭|크게|큰\s?폭으로|전일\s?대비|간밤|다시|함께|나란히|동반|일제히|각각|넘게|가량|[-+−]?[\d,.]+\s?(?:%p?|달러|포인트|bp|원)?(?:로|나|이나|가량|넘게|대|까지|선)?)`;
const GAP = new RegExp(String.raw`^(?:\s|${GAP_TOKEN})*`);

// 이 문장들은 '어제 하루'의 방향 주장이 아니다.
const SKIP_SENTENCE =
  /(면\s|라면|다면|이면|할지|일지|는지|을지|수 있|전망|예상|가능성|우려|기대|관건|변수|지켜볼|확인할|확인한 뒤|판단|해석|이릅|여부|볼 만|\?|오늘|이번 주|한 주|주간|지난주|지난 |전날|그저께|이틀|사흘|연속|누적|연초|올해|한 달|개월|년 전|전 대비|같은 기간|새 |최근|며칠|일째|동안|계산|직전 거래일)/;

function sentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, "")
    .split(/(?<=[.!?。])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 자산 이름 바로 뒤(허용된 사이말 다음)에 오는 방향어. 없으면 null. */
export function directionAfter(rest: string): "up" | "down" | null {
  const gap = rest.match(GAP)?.[0] ?? "";
  const head = rest.slice(gap.length);
  const dir = UP.test(head) ? "up" : DOWN.test(head) ? "down" : null;
  // "밀렸던 자리"처럼 지난 일을 가리키는 관형형은 어제 하루의 주장이 아니다(11-11 실례).
  if (dir && /^[가-힣]{1,3}던/.test(head)) return null;
  return dir;
}

export function findDirectionClaimMismatches(text: string, assets: DirectionAsset[]): string[] {
  const hits: string[] = [];
  for (const s of sentences(text)) {
    if (SKIP_SENTENCE.test(s)) continue;
    for (const a of assets) {
      if (a.change === null || !Number.isFinite(a.change) || Math.abs(a.change) < a.minAbs) continue;
      // 한 문장에 같은 자산이 여러 번 나오면 모두 본다(11-20 "금값(…)은 견조하나 … 금 현물 강세").
      const re = new RegExp(a.pattern.source, a.pattern.flags.includes("g") ? a.pattern.flags : a.pattern.flags + "g");
      for (const m of s.matchAll(re)) {
        const dir = directionAfter(s.slice((m.index ?? 0) + m[0].length));
        if (dir === "up" && a.change < 0) hits.push(`${a.label} 상승 서술인데 입력 ${fmt(a)}: ${s.slice(0, 70)}`);
        if (dir === "down" && a.change > 0) hits.push(`${a.label} 하락 서술인데 입력 ${fmt(a)}: ${s.slice(0, 70)}`);
        if (dir) break;
      }
    }
  }
  return hits;
}

function fmt(a: DirectionAsset): string {
  return a.unit === "bp" ? `${a.change! >= 0 ? "+" : ""}${(a.change! * 100).toFixed(1)}bp` : `${a.change! >= 0 ? "+" : ""}${a.change!.toFixed(2)}%`;
}

// ── 자산 이름 패턴 ─────────────────────────────────────────
// '금'은 금리·금요일·자금·금융·금통위와 겹친다 — 뒤에 조사·값·현물·선물·가격이 올 때만.
export const GOLD = /(?<![가-힣])금(?=값|\s?현물|\s?선물|\s?가격|이\s|은\s|을\s|과\s|도\s|·)|국제 금값/;
export const SILVER = /(?<![가-힣])은(?=값|\s?현물|\s?선물|\s?가격)/;
export const WTI = /WTI|서부텍사스산|국제 유가|(?<![가-힣])유가/;
export const BRENT = /브렌트/;
// 국고채 10년물과 섞이지 않게 미국 표시가 있을 때만.
export const US10Y = /(?:미|미국)\s?(?:국채\s?)?10년물(?:\s?국채)?(?:\s?금리|\s?수익률)?|미 국채 10년/;
export const USDKRW = /원\/달러 환율|원·달러 환율|달러\/원 환율|원\/달러|원·달러|달러-원 환율/;

const INDEX_PATTERNS: Record<string, RegExp> = {
  코스피: /(?<![가-힣A-Za-z])코스피(?!\s?200)/,
  코스닥: /(?<![가-힣A-Za-z])코스닥(?!\s?150)/,
  "S&P 500": /S&P\s?500/,
  나스닥: /(?<![가-힣A-Za-z])나스닥(?!\s?100)/,
  다우존스: /(?<![가-힣])다우(?:존스|지수)?/,
  "필라델피아 반도체지수": /필라델피아\s?반도체(?:지수)?/,
  "닛케이 225": /닛케이/,
  항셍: /항셍/,
  상해종합: /상해종합|상하이종합/,
};

/** 마켓 리포트 입력(MarketDataCollection)에서 대조할 자산 목록. */
export function marketDirectionAssets(data: {
  koreaStocks: { nameKo: string; changePercent: number | null }[];
  usStocks: { nameKo: string; changePercent: number | null }[];
  japanStocks: { nameKo: string; changePercent: number | null }[];
  chinaStocks: { nameKo: string; changePercent: number | null }[];
  commodities: { symbol: string; changePercent: number | null }[];
  bonds: { symbol: string; change: number | null }[];
  forex: { symbol: string; changePercent: number | null }[];
}): DirectionAsset[] {
  const out: DirectionAsset[] = [];
  for (const i of [...data.koreaStocks, ...data.usStocks, ...data.japanStocks, ...data.chinaStocks]) {
    const pattern = INDEX_PATTERNS[i.nameKo];
    if (pattern) out.push({ label: i.nameKo, pattern, change: i.changePercent, minAbs: 0.3 });
  }
  const c = (sym: string) => data.commodities.find((x) => x.symbol === sym)?.changePercent ?? null;
  out.push({ label: "금", pattern: GOLD, change: c("GC=F"), minAbs: 0.3 });
  out.push({ label: "은", pattern: SILVER, change: c("SI=F"), minAbs: 0.5 });
  out.push({ label: "WTI", pattern: WTI, change: c("CL=F"), minAbs: 0.5 });
  out.push({ label: "브렌트유", pattern: BRENT, change: c("BZ=F"), minAbs: 0.5 });
  const tnx = data.bonds.find((b) => b.symbol === "^TNX")?.change ?? null;
  out.push({ label: "미 10년물 금리", pattern: US10Y, change: tnx, minAbs: 0.03, unit: "bp" });
  const krw = data.forex.find((f) => f.symbol === "KRW=X")?.changePercent ?? null;
  out.push({ label: "원/달러 환율", pattern: USDKRW, change: krw, minAbs: 0.2 });
  return out;
}

/**
 * ETF 리포트 입력에서 대조할 자산 목록. 금·은·원유는 원자재 가격 대신 미국 ETF(GLD·SLV·USO) 간밤 등락으로 방향을 본다
 * (거시 블록은 가격 수준만 있다). 국내 ETF 문장은 국내 세션이라 이 대조에서 빼도록 호출자가 문장을 거르지 않고,
 * 패턴이 '금 ETF'·'골드' 같은 상품명을 잡지 않게 했다.
 */
export function etfDirectionAssets(
  indices: { nameKo: string; changePercent: number | null }[] | undefined,
  quotes: { ticker: string; changePercent: number | null }[],
  usdKrwChangePercent: number | null,
): DirectionAsset[] {
  const alias: Record<string, string> = { "S&P500": "S&P 500", 다우: "다우존스" };
  const out: DirectionAsset[] = [];
  for (const i of indices ?? []) {
    const pattern = INDEX_PATTERNS[alias[i.nameKo] ?? i.nameKo];
    if (pattern) out.push({ label: i.nameKo, pattern, change: i.changePercent, minAbs: 0.3 });
  }
  const q = (t: string) => quotes.find((x) => x.ticker === t)?.changePercent ?? null;
  const notEtf = (re: RegExp) => new RegExp(`(?:${re.source})(?!\\s?(?:ETF|광산|채굴))`);
  out.push({ label: "금(GLD)", pattern: notEtf(GOLD), change: q("GLD"), minAbs: 0.3 });
  out.push({ label: "은(SLV)", pattern: notEtf(SILVER), change: q("SLV"), minAbs: 0.5 });
  out.push({ label: "원유(USO)", pattern: notEtf(WTI), change: q("USO"), minAbs: 0.5 });
  out.push({ label: "원/달러 환율", pattern: USDKRW, change: usdKrwChangePercent, minAbs: 0.2 });
  return out;
}
