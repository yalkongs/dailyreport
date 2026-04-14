import type { NarrativeAngle, NarrativeLogEntry } from "./types";

export const NARRATIVE_ANGLES: NarrativeAngle[] = [
  {
    id: "supply_chain",
    name: "산업 체인 추적",
    description: "원자재→제조→소비자까지 가치사슬을 따라가며 서술",
    promptGuide: `오늘의 앵글: **산업 체인 추적**
하나의 시장 변화가 산업 체인을 따라 어떻게 전파되는지 추적하세요.
예: 유가 상승 → 나프타 가격 → 석유화학 기업 마진 → 플라스틱 원료 → 포장재 단가 → 배달 음식 가격
추상적 연결("물가가 오릅니다")이 아닌 구체적 체인을 보여주세요.`,
  },
  {
    id: "historical_deja_vu",
    name: "역사적 데자뷰",
    description: "과거 유사 상황과 비교하여 맥락 제공",
    promptGuide: `오늘의 앵글: **역사적 데자뷰**
오늘 시장과 가장 닮은 과거 시점을 찾아 비교하세요.
"이때와 닮았지만 다른 점 3가지"를 중심으로 서술하세요.
과거에 어떻게 전개됐는지가 오늘의 맥락을 더 풍부하게 만듭니다.`,
  },
  {
    id: "other_side",
    name: "반대편 풍경",
    description: "손해 보는 쪽 대신 득을 보는 쪽을 조명",
    promptGuide: `오늘의 앵글: **반대편 풍경**
모든 시장 변화에는 손해 보는 쪽과 득을 보는 쪽이 있습니다.
오늘은 "누가 웃고 있는가"를 중심으로 서술하세요.
고유가 → 정유/탐사 기업, 고환율 → 수출 대기업, 금리 인상 → 은행 예대마진 등
뻔한 피해 서사 대신 기회의 관점으로 같은 데이터를 재해석하세요.`,
  },
  {
    id: "generation_wallet",
    name: "세대별 지갑",
    description: "20대/40대/60대가 각각 체감하는 방식으로 서술",
    promptGuide: `오늘의 앵글: **세대별 지갑**
같은 시장 변화를 세 가지 다른 삶의 현장에서 보여주세요.
- 20~30대: 월급, 청약, 주식 입문, 해외여행, 학자금
- 40~50대: 주담대, 자녀 교육비, 연금, 중장기 투자
- 60대 이상: 은퇴 자금, 예금 이자, 건강보험료, 물가 체감
각 세대가 왜 같은 숫자를 다르게 느끼는지 보여주세요.`,
  },
  {
    id: "global_domino",
    name: "글로벌 도미노",
    description: "한 국가의 사건이 다른 나라로 전파되는 경로 추적",
    promptGuide: `오늘의 앵글: **글로벌 도미노**
하나의 사건이 국경을 넘어 전파되는 순서를 추적하세요.
시간순으로: "어제 밤 워싱턴에서 → 오늘 새벽 도쿄에서 → 오전 서울에서"
각 나라가 왜 다르게 반응하는지, 한국은 이 도미노의 어느 위치에 있는지 설명하세요.`,
  },
  {
    id: "hidden_variable",
    name: "숨은 변수",
    description: "헤드라인 뒤에 숨은 진짜 동인을 파헤침",
    promptGuide: `오늘의 앵글: **숨은 변수**
표면적 원인 뒤에 있는 진짜 요인을 파헤치세요.
"유가가 올랐습니다" 대신 "유가가 오른 '진짜' 이유는 OPEC 감산이 아니라 미국 전략비축유 재비축 수요"
헤드라인 너머를 보는 재미를 독자에게 선사하세요.`,
  },
  {
    id: "data_anatomy",
    name: "데이터 해부학",
    description: "하나의 숫자를 깊이 파고들어 여러 의미를 추출",
    promptGuide: `오늘의 앵글: **데이터 해부학**
오늘 가장 의미 있는 숫자 하나를 골라 깊이 파고드세요.
"원/달러 1,488원이 의미하는 5가지" 식으로 하나의 수치에서 여러 겹의 의미를 꺼내세요.
같은 숫자도 수출 기업, 수입 기업, 여행자, 유학생, 해외 주식 투자자에게 다른 의미입니다.`,
  },
  {
    id: "time_travel",
    name: "시간여행",
    description: "1년 전, 5년 전, 10년 전 오늘과 비교",
    promptGuide: `오늘의 앵글: **시간여행**
데이터에 포함된 historicalComparison 필드를 활용하여 과거와 비교하세요.
historicalComparison 데이터가 있으면 해당 수치만 사용하고, 없으면 과거 비교를 하지 마세요.
제공되지 않은 과거 수치를 절대로 만들어내지 마십시오.
시간 축을 넓히면 오늘의 숫자가 다르게 보입니다.`,
  },
  {
    id: "job_perspective",
    name: "직업별 풍경",
    description: "특정 직업군이 체감하는 시장 상황을 서술",
    promptGuide: `오늘의 앵글: **직업별 풍경**
오늘 시장 변화가 특정 직업군에 미치는 구체적 영향을 분석하세요.
예: 수출 중소기업의 환율 영향 계산, 카페 업종의 원두 원가 구조, 물류 업종의 유가 부담
가상의 인물이나 인터뷰를 만들지 마세요. "가령 수출 중소기업이라면~" 식의 가정법으로 서술하세요.
실제 데이터에서 도출 가능한 구체적 계산(환율 변동 시 원가 영향 등)을 보여주세요.`,
  },
  {
    id: "structural_lens",
    name: "구조적 렌즈",
    description: "일일 노이즈를 넘어 큰 구조적 흐름을 읽음",
    promptGuide: `오늘의 앵글: **구조적 렌즈**
오늘의 숫자에 집착하지 말고, 더 큰 구조적 변화를 읽으세요.
"오늘 0.3% 올랐다/내렸다"보다 "3개월째 이 레벨을 벗어나지 못하는 이유"가 더 중요합니다.
금리 사이클, 인구 변화, 기술 전환 등 장기 흐름 속에 오늘을 배치하세요.`,
  },
];

export function selectAngle(recentLog: NarrativeLogEntry[]): NarrativeAngle {
  const recentAngleIds = recentLog.slice(0, 5).map((e) => e.narrativeAngle);
  const available = NARRATIVE_ANGLES.filter(
    (a) => !recentAngleIds.includes(a.id)
  );

  // 사용 가능한 앵글이 없으면 (5일 넘게 모두 소진) 가장 오래된 것부터
  if (available.length === 0) {
    return NARRATIVE_ANGLES[
      Math.floor(Math.random() * NARRATIVE_ANGLES.length)
    ];
  }

  // 사용 가능한 앵글 중 랜덤 선택 (Claude에게 최종 선택을 맡기지 않고 시스템이 결정)
  return available[Math.floor(Math.random() * available.length)];
}
