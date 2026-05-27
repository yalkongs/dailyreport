// lib/catalyst-extractor.ts
//
// Phase F2 (2026-05-24): 다각화 뉴스에서 "오늘 시장을 움직일 forward
// catalyst" 자동 추출. Market·ETF 양쪽에서 재사용.
//
// 추출 휴리스틱: 신선도 + 시총 상위 기업명 + 시장 이벤트 키워드로 점수화.
// 점수 기준 상위 N개를 선별해 별도 프롬프트 블록으로 주입.
//
// 본 모듈은 외부 호출 없는 순수 함수. 기존 news 수집에 의존만 함.

export interface CatalystInput {
  title: string;
  source?: string;
  publishedHoursAgo?: number;
  url?: string;
}

export interface CatalystScored extends CatalystInput {
  score: number;
  signals: string[]; // 점수에 기여한 신호 목록 (debug·로깅용)
}

// 시총 상위 한국 기업 (점수 +3)
const TOP_KR_COMPANIES = [
  "삼성전자", "삼성", "SK하이닉스", "하이닉스", "현대차", "현대자동차",
  "기아", "LG에너지솔루션", "LG엔솔", "셀트리온", "NAVER", "네이버", "Kakao", "카카오",
  "POSCO", "포스코", "한화", "두산", "LG화학", "삼성바이오로직스", "삼성SDI",
  "현대모비스", "KB금융", "신한지주", "하나금융", "HD현대",
];

// 시장 이벤트 키워드 (점수 +2)
const EVENT_KEYWORDS = [
  "실적", "공시", "노사", "합의", "타결", "매각", "M&A", "인수", "합병",
  "계약", "수주", "소송", "분쟁", "리콜", "특검",
  "정책", "발표", "규제", "감세", "관세", "제재",
  "금리", "동결", "인상", "인하", "기준금리",
  "배당", "유상증자", "감자", "주총", "스플릿", "상장폐지",
  "어닝", "가이던스", "전망 상향", "전망 하향",
];

// 속보·긴급 키워드 (점수 +1)
const URGENCY_KEYWORDS = ["속보", "긴급", "단독", "주목"];

// 매크로/지정학 키워드 (점수 +1)
const MACRO_KEYWORDS = [
  "FOMC", "연준", "Fed", "한국은행", "BOK", "ECB",
  "CPI", "물가", "고용", "GDP", "PCE",
  "이란", "중동", "호르무즈", "OPEC", "지정학",
];

function countMatches(text: string, terms: string[]): { count: number; matched: string[] } {
  const matched: string[] = [];
  for (const t of terms) {
    if (text.includes(t)) matched.push(t);
  }
  return { count: matched.length, matched };
}

function recencyScore(hoursAgo: number | undefined): number {
  if (hoursAgo === undefined) return 0;
  if (hoursAgo < 2) return 5;
  if (hoursAgo < 4) return 4;
  if (hoursAgo < 8) return 3;
  if (hoursAgo < 12) return 2;
  if (hoursAgo < 24) return 1;
  return 0;
}

/**
 * 뉴스 1건의 catalyst 점수 계산.
 * 신선도(0~5) + 기업명(+3) + 이벤트(+2) + 속보/매크로(+1) 의 가산.
 */
export function scoreCatalyst(news: CatalystInput): CatalystScored {
  const t = news.title;
  const signals: string[] = [];

  const recency = recencyScore(news.publishedHoursAgo);
  if (recency > 0) signals.push(`신선도+${recency}`);

  const co = countMatches(t, TOP_KR_COMPANIES);
  const companyScore = co.count > 0 ? 3 : 0;
  if (companyScore > 0) signals.push(`기업명(${co.matched.slice(0, 2).join("·")})+3`);

  const ev = countMatches(t, EVENT_KEYWORDS);
  const eventScore = Math.min(ev.count, 2) * 2;
  if (eventScore > 0) signals.push(`이벤트(${ev.matched.slice(0, 2).join("·")})+${eventScore}`);

  const ur = countMatches(t, URGENCY_KEYWORDS);
  const urgencyScore = ur.count > 0 ? 1 : 0;
  if (urgencyScore > 0) signals.push(`속보+${urgencyScore}`);

  const ma = countMatches(t, MACRO_KEYWORDS);
  const macroScore = ma.count > 0 ? 1 : 0;
  if (macroScore > 0) signals.push(`매크로+${macroScore}`);

  const score = recency + companyScore + eventScore + urgencyScore + macroScore;
  return { ...news, score, signals };
}

/**
 * 뉴스 목록에서 상위 N개의 catalyst 선별.
 * threshold 미만 점수는 제외 (의미 없는 노이즈 차단).
 *
 * 2026-05-28 추가: recentHeadlines 가 주어지면, 그 안에 동일 기업명/이벤트
 * 키워드가 이미 등장한 catalyst 는 점수 -3 패널티. 같은 사건이 며칠 연속
 * 헤드라인을 차지하는 단조화 방지.
 */
export function extractTopCatalysts(
  news: CatalystInput[],
  options: { topN?: number; minScore?: number; recentHeadlines?: string[] } = {},
): CatalystScored[] {
  const { topN = 3, minScore = 4, recentHeadlines = [] } = options;

  // 최근 헤드라인에서 등장한 기업명·이벤트 키워드 집합
  const recentText = recentHeadlines.join(" ");
  const recentCompanies = TOP_KR_COMPANIES.filter((c) => recentText.includes(c));
  const recentEvents = EVENT_KEYWORDS.filter((e) => recentText.includes(e));

  return news
    .map((n) => {
      const c = scoreCatalyst(n);
      // 최근 헤드라인과 겹치는 기업·이벤트가 있으면 패널티
      const overlapCompany = recentCompanies.some((co) => n.title.includes(co));
      const overlapEvent = recentEvents.some((ev) => n.title.includes(ev));
      if (overlapCompany && overlapEvent) {
        return { ...c, score: c.score - 3, signals: [...c.signals, "최근반복-3"] };
      }
      if (overlapCompany) {
        return { ...c, score: c.score - 2, signals: [...c.signals, "최근기업-2"] };
      }
      return c;
    })
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * 프롬프트용 포맷.
 */
export function formatCatalystForPrompt(c: CatalystScored): string {
  const age = typeof c.publishedHoursAgo === "number"
    ? `${Math.round(c.publishedHoursAgo)}h전`
    : "시각미상";
  const src = c.source ? ` (${c.source})` : "";
  return `[점수 ${c.score}] [${age}] ${c.title}${src}`;
}
