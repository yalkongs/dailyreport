// lib/voice-exemplars.ts
// 목표 보이스 예시(exemplar) 단일 소스 — Market·ETF 공유.
// banned-metaphors.ts 가 "피할 것(죽은 비유)"의 소스라면, 이 파일은 "지향할 것"의
// 소스다. 규칙(금지 리스트)을 취향(예시+원칙)으로 대체하기 위한 모듈.

import { headlineForm, recentFormStats, type HeadlineForm } from "./headline-editorial";

export interface VoiceExemplar {
  /** 본보기 문장 (자사 실제 출력 큐레이션, 사용자 보강 대상) */
  text: string;
  /** 왜 좋은가 — 모델이 결을 학습하도록 붙이는 주석 */
  note: string;
}

export type VoiceTarget = "market" | "etf";

// 2026-10-27 제목 편집 기준(스펙 §2): 고정 예시 10개 중 9개가 "A, B" 두 토막이라 모델이 같은 틀을 반복했다.
// 리포트별 풀에 문형(style)을 붙여 두고, 날마다 문형이 다른 4개를 날짜 시드로 골라 사용자 프롬프트의 제목 규칙 칸에 넣는다.
// form(측정 분류)은 headlineForm(text)로 계산한다 — 따로 적지 않아 어긋날 일이 없다.
export type HeadlineStyle =
  | "단문 사실형" | "원인형" | "배경·동시형" | "대비형" | "수치 강조형" | "명사형 종결" | "예고형" | "말줄임 이음" | "쉼표 두 토막";

export interface HeadlineExemplar extends VoiceExemplar {
  style: HeadlineStyle;
}

export const MARKET_HEADLINE_POOL: HeadlineExemplar[] = [
  // 2026-07-02 큐레이션 — 노트 유지
  { text: "금리 올린 연준, 달러만 웃었다", style: "쉼표 두 토막", note: "주어(연준·달러)를 앞세우고 '달러만 웃었다'로 자연스러운 의인화. 종속절('~한 밤,') 없이 압축." },
  { text: "반도체 빈자리, 통신·금융이 메웠다", style: "쉼표 두 토막", note: "'빈자리/메우다' 이미지를 한 호흡에. 기사체 종결, 한국 신문 제목 결." },
  { text: "SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다", style: "말줄임 이음", note: "핵심 사건을 앞세우고 '엇갈렸다'로 종목 움직임을 자연스러운 한 단어에(번역투 '두 방향으로 갈라놓았다' 아님)." },
  { text: "삼성·SK, 코스피 급락에도 충청 392조 투자", style: "배경·동시형", note: "은유 없이 사실 대비(급락↔투자)만으로 후크. 모든 제목에 비유가 필요한 건 아니다." },
  // 2026-10-27 추가 — 기준선 평가의 대안·자연스러운 제목에서
  { text: "SK하이닉스 6% 급락", style: "단문 사실형", note: "주어와 움직임만. 가장 짧은 신문 제목." },
  { text: "연준 금리 인상에 달러 강세", style: "원인형", note: "원인이 입력(연준 결정)으로 확인될 때만 '…에'. 줄임말 없이 무엇이 올랐는지 분명히." },
  { text: "CPI 예상 상회에 나스닥 1.9% 하락", style: "원인형", note: "발표 사실과 지수 움직임을 쉼표 없이 한 호흡에." },
  { text: "삼성전자 깜짝 실적에 반도체주 강세", style: "원인형", note: "원인(실적 발표)이 입력 기사로 확인될 때만 쓰는 결." },
  { text: "미 기술주 약세 여파 속 코스피 3.5% 하락", style: "배경·동시형", note: "'~ 속'으로 배경을 깔고 핵심 사실로 끝맺음. 인과를 단정하지 않는다." },
  { text: "외국인 매도 속 코스피 2% 하락", style: "배경·동시형", note: "가장 짧은 배경형. 수급 수치가 입력에 있을 때." },
  { text: "삼성전자 호실적에도 코스피 하락", style: "배경·동시형", note: "'~에도'로 기대와 다른 결과를 대비. 단정 없이 사실 둘." },
  { text: "S&P500 오르고 코스피는 하락", style: "대비형", note: "두 시장의 엇갈림을 동사 대구로. 시장 이름을 모두 밝힌다." },
  { text: "나스닥 반등…코스피는 전날 먼저 상승", style: "대비형", note: "'이미 앞서갔다' 대신 언제 무엇이 올랐는지 그대로." },
  { text: "코스피 349포인트 급락", style: "수치 강조형", note: "숫자 자체가 뉴스인 날. 군더더기 없이 규모만." },
  { text: "원·달러 환율 하루 새 20원 급락", style: "수치 강조형", note: "환율 숫자로 방향을 분명히 — 원화 강세·약세를 숫자로 보여 준다." },
  { text: "미 국채 10년물 금리 5.24%…코스피 191포인트 하락", style: "말줄임 이음", note: "어느 국채 금리인지 밝히고 두 사실을 말줄임표로 잇는다." },
  { text: "트럼프 수입차 관세 50% 예고…현대차 기대 흔들", style: "말줄임 이음", note: "사건(관세 예고)과 영향을 잇되 영향은 단정하지 않는 말로." },
  { text: "금통위 앞둔 코스피 숨 고르기", style: "명사형 종결", note: "관용 은유 '숨 고르기'를 명사형으로. 일정이 핵심인 날." },
  { text: "코스피 5.5% 급락, 6,000선 턱밑까지", style: "쉼표 두 토막", note: "쉼표는 숫자와 위치처럼 두 사실을 나눌 때만." },
  { text: "코스피 3.3% 반등, 오늘 오전 10시 기준금리 결정", style: "예고형", note: "어제 사실 + 오늘 일정. '금통위가 답한다' 같은 의인화 없이 시각을 밝힌다." },
  { text: "다음 변수는 SK하이닉스 3분기 실적", style: "예고형", note: "잠잠한 날의 절제된 사실형. 무엇을 볼지 한 가지만." },
];

export const ETF_HEADLINE_POOL: HeadlineExemplar[] = [
  // 2026-09-30 사용자가 실제 발송본에서 고른 6개 — 노트 유지
  { text: "원화, 하루 만에 20원 되찾다", style: "쉼표 두 토막", note: "주어 + 기사체 현재형. 가장 짧은 신문 제목 결." },
  { text: "금 급락·반도체 하락, 방어 우위 국면 진입", style: "명사형 종결", note: "사실을 나열하고 서술성 명사('진입')로 끝맺음. 티커 없이 한국어 명칭." },
  { text: "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화", style: "말줄임 이음", note: "사실…의미를 말줄임표로 잇고 '본격화'로 끝맺음." },
  { text: "반도체 직격, 방어주가 버텼다", style: "쉼표 두 토막", note: "명사구 + 짧은 주술로 대비를 압축." },
  { text: "미 국채 5% 벽, 원화가 먼저 무너졌다", style: "쉼표 두 토막", note: "분기점 숫자를 은유('벽') 속에 녹임 — strong 근거일 때의 결." },
  { text: "무디스 성장률 3.5% 상향, 반도체가 국내 주도", style: "명사형 종결", note: "출처 있는 사건을 앞세우고 서술성 명사('주도')로 끝맺음." },
  // 2026-10-27 추가
  { text: "미 반도체 ETF 4.5% 급락", style: "단문 사실형", note: "어느 시장의 무엇이 얼마나 — 셋만으로 한 줄." },
  { text: "국내 반도체 ETF 4%대 급등", style: "수치 강조형", note: "규모가 뉴스인 날. '국내'로 시장을 밝힌다." },
  { text: "미 장기채 ETF 2% 상승", style: "수치 강조형", note: "티커(TLT) 대신 한국어 명칭." },
  { text: "삼성전자 깜짝 실적에 국내 반도체 ETF 강세", style: "원인형", note: "원인(실적 발표)이 입력 기사로 확인될 때만 '…에'." },
  { text: "미 수출규제 우려 속 2차전지·반도체 ETF 동반 급락", style: "배경·동시형", note: "'규제가 눌렀다' 대신 '~ 우려 속'으로 동시에 일어난 일로만." },
  { text: "미 반도체 ETF 4.5% 급락 속 국내 방어주 선방", style: "배경·동시형", note: "'홀로 버텼다'의 과장 없이 '선방'." },
  { text: "대미투자 발표 앞두고 반도체 ETF 강세", style: "배경·동시형", note: "'앞서 달렸다' 같은 직역투 대신 시점과 사실." },
  { text: "국내 증시 숨 고르기 속 배당 ETF 선방", style: "배경·동시형", note: "관용 은유 '숨 고르기'와 시장 표시('국내 증시')." },
  { text: "방산 ETF 5% 하락…미 반도체는 강세", style: "대비형", note: "'~사이, ~가 달렸다' 대신 두 사실을 말줄임표로 대비." },
  { text: "미 바이오·반도체 오르고 유틸리티·부동산은 약세", style: "대비형", note: "해외 섹터에 '미'를 붙여 국내와 헷갈리지 않게." },
  { text: "국내 헬스케어 ETF 강세, 미 반도체 급락과 대조", style: "쉼표 두 토막", note: "쉼표 뒤를 명사형('대조')으로 닫아 산문 술어를 피함." },
  { text: "코스피 3.81% 급락, 반도체가 하락 주도", style: "명사형 종결", note: "'낙폭을 이끌었다' 같은 연어 대신 '하락 주도'." },
  { text: "금 ETF 3% 급락…원자재 약세 확산", style: "말줄임 이음", note: "사실…흐름. 흐름은 입력에서 다른 원자재도 내렸을 때만." },
  { text: "국내 반도체 ETF 급등, 다음 변수는 금통위", style: "예고형", note: "어제 사실 + 오늘 볼 것. '금통위가 답한다' 같은 의인화 없이." },
];

export const HEADLINE_EXEMPLARS_PER_DAY = 4;

function seedOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rnd = mulberry32(seedOf(seed));
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 오늘 보여 줄 제목 예시 4개(스펙 §2). recent: 같은 리포트의 최근 제목(최신순, 오늘 제외).
 * 직전 제목의 형태와 최근 3번 이상 쓴 형태는 빼고, 문형(style)이 서로 다르게 날짜 시드로 고른다.
 * 남는 예시의 문형이 4종보다 적으면 '우세' 제외부터, 그다음 '직전' 제외를 푼다(4개가 서로 다른 문형이어야 하므로 개수가 아니라 문형 수로 본다).
 * 같은 입력이면 같은 결과(dry-run 재현).
 */
export function pickHeadlineExemplars(target: VoiceTarget, recent: readonly string[], date: string): HeadlineExemplar[] {
  const pool = target === "etf" ? ETF_HEADLINE_POOL : MARKET_HEADLINE_POOL;
  const n = HEADLINE_EXEMPLARS_PER_DAY;
  const stats = recentFormStats(recent);
  const tries: Array<Array<HeadlineForm | null>> = [[stats.previous, stats.dominant], [stats.previous], []];
  let allowed: HeadlineExemplar[] = pool;
  for (const excluded of tries) {
    allowed = pool.filter((e) => !excluded.includes(headlineForm(e.text)));
    if (new Set(allowed.map((e) => e.style)).size >= n) break;
  }
  const shuffled = seededShuffle(allowed, `${target}:${date}`);
  const picked: HeadlineExemplar[] = [];
  for (const e of shuffled) if (picked.length < n && !picked.some((p) => p.style === e.style)) picked.push(e);
  for (const e of shuffled) if (picked.length < n && !picked.includes(e)) picked.push(e);
  return picked;
}

/** 사용자 프롬프트의 제목 규칙 칸에 넣는 오늘의 예시 블록. */
export function renderHeadlineExemplars(picked: readonly HeadlineExemplar[]): string {
  return `[오늘 참고할 제목 예시 — 문형이 서로 다른 ${picked.length}개, 날마다 바뀝니다. 문장을 베끼지 말고 결만 참고하십시오]
${picked.map((e) => `  · "${e.text}" (${e.style}) — ${e.note}`).join("\n")}`;
}

export const BODY_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "주식도 채권도 같은 날 나란히 밀렸습니다",
    note: "설명문이 아니라 장면이되 한국어 통상 표현으로. '나란히 밀렸다'가 대비를 자연스럽게(문어체 '내려앉은 밤이었습니다' 아님).",
  },
  {
    text: "괴리율 확대가 체결 비용을 조용히 갉아먹습니다",
    note: "전문 개념(괴리율·체결비용)에 '조용히 갉아먹는다' 동사 이미지. 정확+생생.",
  },
];

/** "이렇게는 쓰지 말 것" — 구조·형태 클리셰 반례 (단어가 아니라 틀) */
export const ANTI_PATTERN_EXAMPLES: string[] = [
  "'X가 그린 [지도/로드맵/고속도로]' 같은 반복되는 구문 틀",
  "'SOXX +1.44%, …'처럼 티커·숫자를 앞세운 데이터피드형 제목",
  "'~한/하는 밤·날·자리, [주절]'처럼 종속절을 앞세운 2절 문어체 틀 — 영어 피처기사 골격의 번역투다. 한국 제목은 주어·핵심 사실을 앞세워 압축한다 (예: '원유가 6% 뛰는 날, 코스피는 …' → 금지)",
  "'분기를 닫다(close a quarter)', '~을 갈라놓다', 돈이 '꽂히다' 류 억지·번역투 연어 — 한국어 통상 표현으로",
  "'N포인트를 잃었다/얻었다'는 영어 'lost/gained N points' 직역이다 — 한국어는 'N포인트 하락·상승', 'N포인트 빠졌다'로",
  "'[전일 사건] 다음 날, [주절]'·'~한 날의 다음'처럼 전일 사건을 '다음 날' 시점 설정으로 앞세우는 틀 — 어색한 번역투 명사화다. 오늘의 핵심 사실을 앞세우고 전일 맥락은 문장 안에서 '전일·간밤 …에 이어'로 처리하라 (예: '코스피 급락 다음 날, 미 증시는 엇갈렸다' → '미 증시 엇갈려…전일 코스피 급락 여진')",
];

// ETF 제목 형태(티커 앞세움·2절 틀·'다음 날' 틀)는 ETF 프롬프트의 [cover.headline 작성 규칙]이
// 직접 다룬다. 여기에는 표현 차원의 반례만 둔다(같은 말을 두 곳에 두지 않는다).
export const ETF_ANTI_PATTERN_EXAMPLES: string[] = [
  "'X가 그린 [지도/로드맵/고속도로]' 같은 반복되는 구문 틀",
  "'분기를 닫다(close a quarter)', '한 주를 닫다', '한 주를 가져갔다', '~을 갈라놓다', 돈이 '꽂히다' 류 억지·번역투 연어 — 한국어 통상 표현으로",
  "'N포인트를 잃었다/얻었다'는 영어 'lost/gained N points' 직역이다 — 한국어는 'N포인트 하락·상승', 'N포인트 빠졌다'로",
];

/** 소프트 칼리브레이션 — '진부함이 무엇인지' 가르치는 짧은 예시 (하드 필터 아님) */
export const TIRED_METAPHOR_HINTS: string[] = [
  "파도", "항해", "롤러코스터", "폭풍", "폭풍전야", "양날의 검",
];

/** 양 프롬프트(시스템)에 주입할 목표 보이스 블록 — 원칙·본문 예시·표현 반례. 제목 예시는 사용자 프롬프트의 순환 예시(2026-10-27). */
export function renderVoiceExemplars(target: VoiceTarget = "market"): string {
  const antis = target === "etf" ? ETF_ANTI_PATTERN_EXAMPLES : ANTI_PATTERN_EXAMPLES;
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = antis.map((a) => `  · ${a}`).join("\n");
  return `## 목표 보이스 — 예시로 익히기 (규칙보다 이 결을 따르라)

데이터에 진실한 구체적 이미지 하나가 제 몫을 하면 환영한다. 매번 어느 날에나
붙일 수 있는 진부한 비유와 반복되는 구문 틀은 피하라(진부함이란 이런 것:
${TIRED_METAPHOR_HINTS.join(" · ")} 등). 문장·제목의 형태를 변주하라.
제목은 사용자 메시지의 [제목 편집 기준]과 그날의 제목 예시를 따르라.

### 지향할 본문 결
${body}

### 피할 형태 (구조·틀 클리셰)
${anti}`;
}
