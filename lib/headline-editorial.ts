// lib/headline-editorial.ts
//
// 제목 편집 기준 단일 소스(2026-10-27, docs/superpowers/specs/2026-10-27-headline-editorial-design.md) — Market·ETF 공통.
// 형태 분류·끝 어절·어휘 겹침·최근 형태 통계·후보 점수·측정 지표·평가 기준(rubric)을 한곳에 둔다.
// 측정 스크립트(scripts/headline-quality.ts)·예시 순환(voice-exemplars)·후보 점수(headline-selection)가 같은 함수를 써서
// 운영이 감점하는 것과 측정이 재는 것이 어긋나지 않게 한다.

export type HeadlineForm =
  | "A하는 사이 B"
  | "~한 날/밤"
  | "예고형(답한다·변수·시험대·숙제)"
  | "말줄임 이음(…)"
  | "쉼표 두 토막"
  | "단문";

// 기준선(2026-10-27)과 같은 정규식·순서 — 바꾸면 기준선과 비교할 수 없다(headline-editorial.test.ts 회귀 검사).
const FORM_RULES: ReadonlyArray<readonly [Exclude<HeadlineForm, "단문">, RegExp]> = [
  ["A하는 사이 B", /사이[,，]?\s|사이$/],
  ["~한 날/밤", /(?:날|밤|하루)[,，]|(?:날|밤)$/],
  ["예고형(답한다·변수·시험대·숙제)", /답한다|답할|시험대|변수|숙제|가늠자/],
  ["말줄임 이음(…)", /…|\.\.\./],
  ["쉼표 두 토막", /[,，]/],
];

// 측정용 — 사물(자산·지수)을 사람처럼 움직이는 동사. 금지 목록이 아니라 빈도를 보려는 것이다(차단에 쓰지 않는다).
const PERSONIFIED = /달렸|달리는|받쳤|떠받|버텼|버티|눌렀|짓눌|이끌었|끌어올|끌어내|앞서갔|앞서|뒤처졌|무너졌|무너지|주저앉|답한다|내밀|심다|흔들리|직격|발목/;

export function headlineForm(h: string): HeadlineForm {
  for (const [name, re] of FORM_RULES) if (re.test(h)) return name;
  return "단문";
}

export type EndingType = "동사·형용사(~다)" | "명사형" | "기타";

export function headlineEnding(h: string): { word: string; type: EndingType } {
  const w = (h.trim().match(/(\S+)$/)?.[1] ?? "").replace(/[.!?…]+$/, "");
  if (/다$/.test(w)) return { word: w, type: "동사·형용사(~다)" };
  if (/[가-힣]$/.test(w)) return { word: w, type: "명사형" };
  return { word: w, type: "기타" };
}

export function headlineTokens(h: string): Set<string> {
  return new Set(h.replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((t) => t.length >= 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  return a.size + b.size - inter === 0 ? 0 : inter / (a.size + b.size - inter);
}

/** 인덱스·로그의 제목을 비교용 평문으로 — 태그를 벗기고 공백을 하나로. 문자열이 아니면 ''. */
export function cleanHeadline(h: unknown): string {
  return typeof h === "string" ? h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

export const RECENT_HEADLINE_WINDOW = 5;

/** 최신순 제목 목록에서 비교에 쓸 최근 n건(평문, 빈 값 제외). 오늘 날짜를 빼는 것은 호출자 몫. */
export function takeRecentHeadlines(headlines: readonly unknown[], n: number = RECENT_HEADLINE_WINDOW): string[] {
  return headlines.map(cleanHeadline).filter(Boolean).slice(0, n);
}

export const DOMINANT_FORM_MIN = 3;

export interface RecentFormStats {
  previous: HeadlineForm | null; // 직전(가장 최근) 제목의 형태
  dominant: HeadlineForm | null; // 최근 제목에서 DOMINANT_FORM_MIN번 이상 쓴 형태(여럿이면 가장 많은 것)
  counts: Map<HeadlineForm, number>;
}

/** recent: 최신순. */
export function recentFormStats(recent: readonly string[]): RecentFormStats {
  const counts = new Map<HeadlineForm, number>();
  for (const h of recent) {
    const f = headlineForm(h);
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let dominant: HeadlineForm | null = null;
  for (const [f, c] of counts) {
    if (c >= DOMINANT_FORM_MIN && (dominant === null || c > (counts.get(dominant) ?? 0))) dominant = f;
  }
  return { previous: recent.length > 0 ? headlineForm(recent[0]) : null, dominant, counts };
}

export const SCORE_PENALTY = { sameFormAsPrevious: 2, dominantForm: 1, repeatedEnding: 1, lexicalOverlap: 1 } as const;
export const LEXICAL_OVERLAP_MIN = 0.3;

/** 후보 제목의 최근 반복 감점(0이 가장 좋고 음수일수록 나쁘다). recent: 최신순 최근 제목. 같은 입력이면 같은 값. */
export function headlineScore(h: string, recent: readonly string[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const form = headlineForm(h);
  const stats = recentFormStats(recent);
  if (stats.previous === form) {
    score -= SCORE_PENALTY.sameFormAsPrevious;
    reasons.push(`직전 제목과 같은 형태(${form})`);
  }
  if (stats.dominant === form) {
    score -= SCORE_PENALTY.dominantForm;
    reasons.push(`최근 ${stats.counts.get(form)}번 쓴 형태(${form})`);
  }
  const ending = headlineEnding(h).word;
  if (ending && recent.some((r) => headlineEnding(r).word === ending)) {
    score -= SCORE_PENALTY.repeatedEnding;
    reasons.push(`최근 제목과 같은 끝 어절(${ending})`);
  }
  const t = headlineTokens(h);
  const overlap = recent.length > 0 ? Math.max(...recent.map((r) => jaccard(t, headlineTokens(r)))) : 0;
  if (overlap >= LEXICAL_OVERLAP_MIN) {
    score -= SCORE_PENALTY.lexicalOverlap;
    reasons.push(`최근 제목과 어휘 겹침 ${overlap.toFixed(2)}`);
  }
  return { score, reasons };
}

export interface HeadlineCodeMetrics {
  n: number;
  structures: Array<[string, number]>;
  endingTypes: Array<[string, number]>;
  topEndings: Array<[string, number]>;
  repeatEndingRate: number;
  sameStructurePrevRate: number;
  personifiedRate: number;
  commaRate: number;
  avgMaxOverlapPrev5: number;
}

/** 측정 지표 — headlines는 오래된 것부터(날짜 오름차순). 기준선(2026-10-27)과 같은 계산이다. */
export function headlineCodeMetrics(headlines: readonly string[]): HeadlineCodeMetrics {
  const structures = new Map<string, number>();
  const endings = new Map<string, number>();
  const endingTypes = new Map<string, number>();
  let repeatEnding = 0, sameStructurePrev = 0, personified = 0, overlapSum = 0, withComma = 0;
  headlines.forEach((h, i) => {
    const s = headlineForm(h);
    const e = headlineEnding(h);
    structures.set(s, (structures.get(s) ?? 0) + 1);
    endings.set(e.word, (endings.get(e.word) ?? 0) + 1);
    endingTypes.set(e.type, (endingTypes.get(e.type) ?? 0) + 1);
    if (PERSONIFIED.test(h)) personified++;
    if (/[,，]/.test(h)) withComma++;
    const prev5 = headlines.slice(Math.max(0, i - 5), i);
    if (prev5.some((p) => headlineEnding(p).word === e.word)) repeatEnding++;
    if (i > 0 && headlineForm(headlines[i - 1]) === s) sameStructurePrev++;
    const t = headlineTokens(h);
    overlapSum += prev5.length ? Math.max(...prev5.map((p) => jaccard(t, headlineTokens(p)))) : 0;
  });
  const n = headlines.length;
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    n,
    structures: sorted(structures),
    endingTypes: sorted(endingTypes),
    topEndings: sorted(endings).slice(0, 8),
    repeatEndingRate: repeatEnding / n,
    sameStructurePrevRate: sameStructurePrev / Math.max(1, n - 1),
    personifiedRate: personified / n,
    commaRate: withComma / n,
    avgMaxOverlapPrev5: overlapSum / n,
  };
}

// 평가 기준 — 기준선 측정(scripts/headline-quality.ts)과 운영 편집자(headline-selection.ts)가 같은 글을 쓴다.
export const HEADLINE_DESK = `당신은 한국 종합경제지(한국경제·매일경제·연합뉴스 경제부) 증권면 데스크입니다. 매일 아침 개인 투자자용 시황 리포트 제목을 검토합니다.`;

export const HEADLINE_RUBRIC = `- 자연스러움(1~5): 한국어 화자가 증권 기사 제목으로 읽을 때 자연스러운가. 감점 요인 — 영어 직역투(rally를 '달렸다'로 옮긴 듯한 표현), 대상 없는 어색한 의인화('채권이 받쳤다'처럼 무엇을 받쳤는지 없는 경우), 어울리지 않는 낱말 짝(연어), 과장. 한국 경제 기사에서 통용되는 관용적 은유(숨 고르기·훈풍·찬물·발목·급제동·떠받치다(지수를) 등)가 자연스럽게 쓰였으면 감점하지 않는다. 은유 자체는 나쁘지 않다.
- 명확성(1~5): 주식 경험이 조금 있는 개인 투자자가 무엇이 어느 방향으로 얼마나 움직였는지 한 번에 아는가.
- causalAssertion(true/false): 제목이 확인하기 어려운 인과(A가 B를 눌렀다·끌어올렸다 등)를 단정하는가.`;

const JUDGE_ISSUES = `- issues: 어색하거나 문제가 있는 표현만. type은 "직역투" | "어색한 의인화" | "어울리지 않는 연어" | "과장" | "근거 없는 인과 단정" | "상투적 틀" | "모호함" | "기타" 중 하나. phrase는 문제 구절, why는 한 문장 이유, suggestion은 같은 사실을 자연스럽게 쓴 대안 제목.`;

/** 측정 스크립트의 시스템 문구 — 기준선(2026-10-27)과 글자 하나까지 같아야 한다. */
export const HEADLINE_JUDGE_SYSTEM = `${HEADLINE_DESK}
기준:
${HEADLINE_RUBRIC}
${JUDGE_ISSUES}
문제가 없으면 issues는 빈 배열. 결과는 report 도구로 낸다.`;

export type HeadlineTarget = "market" | "etf";

/** 자연스러움 기준을 보여 주는 쌍 — 금지어가 아니다. 2026-10-27 기준선 평가의 대안 열에서 골랐다. */
export const NATURALNESS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["미 반도체가 달렸다", "미 반도체 ETF 강세"],
  ["원유·채권이 받쳤다", "원유·채권 ETF는 강세"],
  ["연준 인상에 달러 올랐다", "연준 금리 인상에 달러 강세"],
  ["재도전 앞에 서다", "7100선 재탈환 노린다"],
  ["금통위가 내일 답한다", "내일 금통위 기준금리 결정 주목"],
];

const FORM_REPERTOIRE: readonly string[] = [
  `단문 사실형 — "미 반도체 ETF 4.5% 급락"`,
  `원인형(입력 근거가 있을 때만) — "삼성전자 깜짝 실적에 국내 반도체 ETF 강세"`,
  `배경·동시형 — "미 수출규제 우려 속 2차전지 ETF 급락", "호실적에도 코스피 하락"`,
  `대비형 — "S&P500 오르고 코스피 내려"`,
  `수치 강조형 — "원·달러 환율 하루 새 20원 급락"`,
  `명사형 종결 — "금통위 앞둔 코스피 숨 고르기"`,
  `말줄임 이음 — "방산 ETF 5% 하락…미 반도체는 강세"`,
  `쉼표 두 토막 — "반도체 빈자리, 통신·금융이 메웠다"`,
  `예고형 — "다음 변수는 SK하이닉스 실적"`,
];

/** 두 리포트의 제목 규칙 칸 맨 앞에 넣는 공통 기준(스펙 §1). 순서가 곧 우선순위다. */
export function renderHeadlineStandard(): string {
  return `[제목 편집 기준 — Market·ETF 공통]
제목은 개장 전 개인 고객이 가장 먼저 읽는 한 줄입니다. 아래 순서로 판단하고, 앞의 기준이 뒤의 기준보다 우선합니다.

1. 명확성 — 제목만 읽어도 어느 시장의 무엇이 어느 방향으로 움직였는지 알아야 합니다. 주어는 실제로 움직인 자산·지수·종목입니다. 무엇을 가리키는지 흐린 줄임말은 풀어 씁니다(예: "연준 인상" → "연준 금리 인상").
2. 자연스러운 한국어 — 경제신문 증권면 제목에서 실제로 쓰는 어휘와 낱말 짝으로 씁니다. 비유는 한국어 제목에서 자연스럽게 읽히면 씁니다(숨 고르기·훈풍·찬물·발목 같은 관용 표현). 영어를 옮긴 듯한 표현, 무엇을 했는지 대상이 없는 의인화, 어울리지 않는 낱말 짝은 피합니다. 같은 사실이 이렇게 읽힙니다:
${NATURALNESS_PAIRS.map(([a, b]) => `   · "${a}" → "${b}"`).join("\n")}
3. 인과는 입력에 근거가 있을 때만 — "…에", "…로" 같은 인과 연결은 입력(수치·기사)이 그 원인을 뒷받침할 때만 씁니다. 근거가 없으면 두 사실을 나란히 놓습니다("A 급락, B는 강세", "A 속 B"). 조사만 바꾼다고 근거가 생기지 않습니다. 근거 상태(tier)별로: strong — 입력 근거가 있는 인과 표현까지 / thin — 인과를 단정하지 말고 나란히 / hollow — 절제된 사실만.
4. 변주 — 같은 형태를 연일 쓰지 않습니다. 쓸 수 있는 형태(할당량은 없습니다. 오늘 사실에 가장 잘 맞는 것을 고르되, 최근 제목에 많이 쓴 형태는 피합니다):
${FORM_REPERTOIRE.map((f) => `   · ${f}`).join("\n")}

후보 세 개: cover.headlineCandidates에 제목 후보 세 개를 { "headline", "subline" } 짝으로 씁니다.
- 세 후보는 모두 같은 오늘의 주제를 다루고, 형태는 서로 다르게 씁니다.
- subline은 그 제목이 뺀 사건명·수치를 받칩니다(후보마다 따로 씁니다).
- 코드가 정확성 검사를 통과한 후보를 추리고, 편집자가 자연스러움·명확성으로 하나를 고릅니다. 세 후보 모두 아래 제목 규칙을 지켜야 합니다.`;
}

/** 프롬프트에 넣는 최근 제목 줄(최신순, 〔형태〕) + 피할 형태 안내. recent가 비면 ''. */
export function renderRecentHeadlineLines(recent: readonly string[]): string {
  if (recent.length === 0) return "";
  const stats = recentFormStats(recent);
  const lines = recent.map((h) => `- ${h} 〔${headlineForm(h)}〕`);
  const avoid = [...new Set([stats.previous, stats.dominant].filter((f): f is HeadlineForm => f !== null))];
  const why = stats.dominant
    ? `직전 제목의 형태, 최근 ${recent.length}건 중 ${stats.counts.get(stats.dominant)}건이 쓴 형태`
    : "직전 제목의 형태";
  lines.push(`오늘 제목은 이 형태를 피하십시오: ${avoid.join(", ")} (${why}).`);
  return lines.join("\n");
}
