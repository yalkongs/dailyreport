// lib/voice-exemplars.ts
// 목표 보이스 예시(exemplar) 단일 소스 — Market·ETF 공유.
// banned-metaphors.ts 가 "피할 것(죽은 비유)"의 소스라면, 이 파일은 "지향할 것"의
// 소스다. 규칙(금지 리스트)을 취향(예시+원칙)으로 대체하기 위한 모듈.

export interface VoiceExemplar {
  /** 본보기 문장 (자사 실제 출력 큐레이션, 사용자 보강 대상) */
  text: string;
  /** 왜 좋은가 — 모델이 결을 학습하도록 붙이는 주석 */
  note: string;
}

export const HEADLINE_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "연준이 금리를 올린 밤, 달러는 올랐고 나머지는 내려앉았다",
    note: "숫자 없이 사건의 인과·대비를 한 문장에. 문어체로 펀치.",
  },
  {
    text: "원유가 내려앉은 자리에 주가가 올라섰다",
    note: "두 자산의 교대를 '자리'라는 공간 이미지로. 간결·신선·정확.",
  },
  {
    text: "반도체가 빠진 자리, 금과 건설이 채운 하루",
    note: "'빠진 자리/채운' 대구. ETF인데도 데이터피드가 아님.",
  },
];

export const BODY_EXEMPLARS: VoiceExemplar[] = [
  {
    text: "주식과 채권이 같은 날 함께 내려앉은 밤이었습니다",
    note: "설명문이 아니라 장면. 이미지가 데이터에 진실함.",
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
];

/** 소프트 칼리브레이션 — '진부함이 무엇인지' 가르치는 짧은 예시 (하드 필터 아님) */
export const TIRED_METAPHOR_HINTS: string[] = [
  "파도", "항해", "롤러코스터", "폭풍", "폭풍전야", "양날의 검",
];

/** 양 프롬프트에 주입할 목표 보이스 블록 */
export function renderVoiceExemplars(): string {
  const hl = HEADLINE_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const body = BODY_EXEMPLARS.map((e) => `  · "${e.text}" — ${e.note}`).join("\n");
  const anti = ANTI_PATTERN_EXAMPLES.map((a) => `  · ${a}`).join("\n");
  return `## 목표 보이스 — 예시로 익히기 (규칙보다 이 결을 따르라)

데이터에 진실한 구체적 이미지 하나가 제 몫을 하면 환영한다. 매번 어느 날에나
붙일 수 있는 진부한 비유와 반복되는 구문 틀은 피하라(진부함이란 이런 것:
${TIRED_METAPHOR_HINTS.join(" · ")} 등). 문장·제목의 형태를 변주하라.

### 지향할 헤드라인 결
${hl}

### 지향할 본문 결
${body}

### 피할 형태 (구조·틀 클리셰)
${anti}`;
}
