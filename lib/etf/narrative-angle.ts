// lib/etf/narrative-angle.ts
//
// Plan B (2026-04-28): Market 리포트의 narrativeAngle 패턴을 ETF 에 이식.
//
// analysisLens 가 "데이터를 어느 각도로 보는가" 를 결정한다면, narrativeAngle
// 은 "이야기를 어느 관점으로 풀어내는가" 를 결정한다. 같은 데이터·같은 렌즈
// 라도 매일 다른 서사 관점이 적용되면 본문이 단편 나열에서 한 호흡의
// 이야기로 바뀐다.

export const ETF_NARRATIVE_ANGLES = [
  '글로벌→국내_전이',      // 해외 신호가 국내 ETF 거래로 어떻게 옮겨가는지 추적
  '환율_양면성',            // 같은 환율이 보유분과 신규 편입에 다르게 작용하는 구조
  '섹터_분리_관찰',         // 같은 날에도 섹터별로 방향이 갈리는 그림 정리
  '안전자산_위험자산',      // 채권·금·배당 vs 성장·반도체·고베타 ETF 사이의 무게중심
  '구조_vs_일시',           // 오늘의 변화가 일일 노이즈인지 구조적 흐름인지 구분
  '확인_지표_체인',         // "선행 신호 → 확인 지표 → 실행 시점" 체인을 따라가기
  '시간대별_관전',          // 개장 30분 / 점심 / 장 마감 흐름이 다르게 읽히는 이유
  '어제와_오늘_대비',       // 전일 국내 마감과 간밤 해외 흐름이 만드는 갭
] as const

export type EtfNarrativeAngle = (typeof ETF_NARRATIVE_ANGLES)[number]

const ANGLE_DESCRIPTIONS: Record<EtfNarrativeAngle, string> = {
  '글로벌→국내_전이':
    '간밤 해외 ETF의 움직임이 오늘 국내 ETF 거래대금과 NAV에 어떻게 옮겨붙는지를 따라간다. 전이가 일어나는 통로(섹터·환율·금리)를 명시하라.',
  '환율_양면성':
    'USD/KRW 한 숫자가 환노출 ETF의 보유 평가에는 보탬이지만 신규 편입 비용에는 부담이라는 두 얼굴을 동시에 풀어낸다. 같은 변수의 양면을 분리해서 본다.',
  '섹터_분리_관찰':
    '같은 날 섹터들이 왜 다른 방향으로 갈렸는지를 핵심 질문으로 잡는다. 강세·약세 섹터의 공통점과 차이점을 찾고, 그 분리가 ETF 군별 무게에 어떻게 반영되는지 풀어낸다.',
  '안전자산_위험자산':
    '채권·금·배당 같은 방어 ETF와 반도체·고성장·인버스 같은 공격 ETF 사이의 무게중심을 본다. 어느 쪽으로 자금이 기울고 있는지를 데이터에서 읽는다.',
  '구조_vs_일시':
    '오늘 두드러진 움직임이 단발 노이즈인지 며칠째 이어지는 구조적 흐름인지 구분한다. 같은 신호가 며칠 누적됐는지를 따져 보는 관점으로 쓴다.',
  '확인_지표_체인':
    '선행 신호 → 그것을 확인할 거시·환율·국내 ETF 지표 → 실행을 결정하는 시점 — 세 마디로 이어진 체인을 그린다. 독자가 09:00 부터 15:30 까지 무엇을 어떤 순서로 볼지 그려준다.',
  '시간대별_관전':
    '개장 30분 / 점심 전후 / 장 마감 — 시간대별로 ETF 흐름이 다르게 읽히는 이유를 설명한다. 시간이 라는 변수를 살린다.',
  '어제와_오늘_대비':
    '전일 한국 시장 마감과 간밤 해외 흐름 사이의 갭에 초점을 맞춘다. 한국 독자가 잠든 사이 무엇이 바뀌었고, 그 갭이 오늘 첫 30분에 어떻게 메워질지 본다.',
}

export function describeAngle(angle: EtfNarrativeAngle): string {
  return ANGLE_DESCRIPTIONS[angle]
}

/**
 * 최근 5일에 사용하지 않은 앵글 중 하나를 무작위 선택.
 * (analysisLens 와 같은 패턴 — 직접적인 반복 회피)
 */
export function selectNarrativeAngle(recent: string[]): EtfNarrativeAngle {
  const recent5 = recent.slice(-5)
  const available = ETF_NARRATIVE_ANGLES.filter(a => !recent5.includes(a))
  const pool = available.length > 0 ? available : [...ETF_NARRATIVE_ANGLES]
  return pool[Math.floor(Math.random() * pool.length)]
}
