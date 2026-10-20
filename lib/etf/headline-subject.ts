// lib/etf/headline-subject.ts
//
// Ruling 35 (2026-10-20): "오늘의 주제 자산군" 하나를 코드가 정하고, 제목(cover.headline)·미리보기 카드·페이지 모자이크가
// 모두 그 자산군을 다루게 한다. 주제 슬롯 = cardSlot(slots, card.key) — card.key는 프롬프트에서 주제 슬롯
// (pickFeaturedSlot: 국내 kr-* 슬롯 중 |등락| 최대)으로 고정되고, 마지막 시도에선 Ruling 10이 그 값으로 교정한다.
//
// 10/20 사고: 제목 "바이오·반도체 오르고 유틸리티·부동산 밀렸다"(미국 섹터 이야기인데 '미국'이 없음)와 카드
// "2차전지를 갖고 있다면"(KODEX 2차전지산업 +8.20%, 국내 최대 움직임)이 서로 다른 이야기를 했다. 카드 자산군은 코드가
// 정했지만 제목 주제는 모델이 자유롭게 골랐고, 둘이 같은지 아무도 보지 않았다.
//
// 이 모듈: 프롬프트에 줄 주제 이름·같은 뜻 단어(subjectNameOf·subjectAliasesOf)와, 제목이 그 자산군을 다루는지 보는
// 순수 함수(headlineCoversSlot). 프롬프트에 보여 주는 단어는 검사도 전부 인정한다(headline-subject.test.ts).
//
// 판정: 슬롯별 단어 패턴 중 하나라도 제목에 있으면 다룬 것. 국내 자산군(kr-*)은 그 단어 바로 앞(· 목록 포함)에
// 해외 시장 표시(미·미국·美·중국·일본·유럽·글로벌 등)가 붙은 경우를 국내 주제로 치지 않는다 — "미 반도체"는 국내
// 반도체가 아니다(프롬프트의 '시장 특정' 규칙: 해외 섹터에는 시장을 붙인다 → 시장 표시 없는 섹터 이름은 국내).
// 알려진 한계: 시장 표시 없이 해외 섹터를 쓴 제목(10/20처럼)은 같은 이름의 국내 주제로 읽힌다 — 프롬프트가 막는다.

import type { AssetClassKey, AssetClassSlot } from './asset-classes'

export type SubjectSlot = Pick<AssetClassSlot, 'key' | 'theme'>

interface SubjectDef {
  name: string
  aliases: string[] // 프롬프트에 보여 주는 같은 뜻 단어(검사도 모두 인정)
  patterns: RegExp[] // 검사 패턴(aliases보다 넓을 수 있다)
}

// 영문 약어는 앞뒤가 영문이 아닐 때만(ITX·SMS·EAI 같은 단어 안의 글자를 잡지 않게). 대소문자 구분.
const token = (word: string) => new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'g')
const literal = (word: string) => new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')

// 금(gold): '금' 단독(앞뒤가 한글이 아님 — 지금·현금·자금·금리·금융·금통위·금요일·금액을 빼고), 조사가 붙은 '금이·금은·금과·금도·금을'
// (뒤에 공백), 금값·금광주·금 가격·금 현물·금 선물·금 ETF.
const GOLD = [
  /(?<![가-힣])금(?![가-힣])/g,
  /(?<![가-힣])금(?=[이은과도을]\s)/g,
  /(?<![가-힣])금(?:값|광)/g,
  /(?<![가-힣])금\s?(?:가격|현물|선물|ETF)/g,
]
// 은(silver): 은값·은 가격·은 선물·은 ETF, '은' 단독(앞이 한글·영문·숫자가 아니고 뒤가 한글이 아님 — 조사 '은'은 앞 글자에 붙는다).
const SILVER = [
  /(?<![가-힣])은(?:값|\s?(?:가격|선물|ETF))/g,
  /(?<![가-힣A-Za-z0-9])은(?![가-힣])/g,
]

const FIXED: Record<Exclude<AssetClassKey, 'kr-sector'>, SubjectDef> = {
  'kr-large': {
    name: '국내 대형주',
    aliases: ['코스피', '대형주', '국내 증시'],
    // '국내' 단독은 넣지 않는다 — "국내는 헬스케어·방산이 받쳤다"는 대형주 이야기가 아니다.
    patterns: [/코스피|KOSPI/g, /대형주/g, /(?:국내|한국)\s*(?:증시|주식)/g],
  },
  'kr-semi': {
    name: '국내 반도체',
    aliases: ['반도체', 'IT', 'AI', 'HBM', '하이닉스', '삼성전자', '소프트웨어'],
    patterns: [/반도체/g, token('IT'), token('AI'), token('HBM'), /하이닉스/g, /삼성전자/g, /소프트웨어/g, /메모리/g, /D램|디램/g],
  },
  'us-equity': {
    name: '미국 주식',
    aliases: ['미 증시', '나스닥', 'S&P500', '다우', '미 기술주'],
    // '미' 단독은 미국 주식이 아니다 — 주식·업종 단어가 붙어야 한다(미 금리·미 국채는 아님).
    patterns: [
      /(?<![가-힣])(?:미국|미|美)\s*(?:증시|주식|주가|기술주|빅테크|대형주|소형주|성장주|반도체|테크|바이오)/g,
      /나스닥/g, /S&P/g, /(?<![가-힣])다우/g, /뉴욕\s*증시/g, /(?<![가-힣\d])월가|월스트리트/g, /러셀/g,
    ],
  },
  bonds: {
    name: '채권',
    aliases: ['국채', '국고채', '장기채', '미 장기채', '10년물'],
    // '금리' 단독은 넣지 않는다 — 여러 자산의 배경 변수다("금리 5%대에 반도체가 버텼다"는 반도체 이야기).
    patterns: [/채권/g, /국채|국고채/g, /장기채|단기채|회사채/g, /하이일드/g, /\d+\s?년물/g, /장기\s*금리/g],
  },
  commodities: {
    name: '금·원자재',
    aliases: ['금값', '금 가격', '유가', '원유', 'WTI', '은값', '구리'],
    patterns: [
      ...GOLD, ...SILVER,
      /원자재/g, /골드/g, /귀금속/g,
      // 유가: '유가증권(시장)'은 코스피, '이유가·보유가'는 다른 말 — 앞이 한글이면 '국제'만 허용.
      /(?:(?<![가-힣])|(?<=국제))유가(?!증권)/g,
      /(?<![\d,])원유/g, token('WTI'), /브렌트/g, /(?<![가-힣])구리/g, /천연가스/g,
    ],
  },
}

// 국내 섹터·테마(kr-sector) theme별 같은 뜻 단어(universe.ts의 국내 섹터·테마 theme 전부 — 반도체·AI·IT는 kr-semi).
// aliases는 프롬프트에 보여 주고 검사도 그대로 인정한다. extra는 검사에서만 더 인정하는 패턴.
const SECTOR: Record<string, { aliases: string[]; extra?: RegExp[] }> = {
  '2차전지': { aliases: ['이차전지', '배터리'], extra: [/2차\s+전지/g] },
  헬스케어: { aliases: ['바이오', '제약·바이오'], extra: [/제약(?=주|사|업|·|\s*바이오)|(?<=·)제약/g] },
  에너지화학: { aliases: ['에너지', '화학', '정유'] },
  미디어: { aliases: ['엔터', '콘텐츠'], extra: [/컨텐츠/g] },
  건설: { aliases: ['건설주'] },
  금융: { aliases: ['금융주', '은행', '증권', '보험'] },
  은행: { aliases: ['은행주', '금융주'] },
  자동차: { aliases: ['완성차', '현대차'] },
  방산: { aliases: ['방위산업', '방산주'], extra: [/방위/g, /우주/g] },
  철강: { aliases: ['소재', '철강소재'] },
  소비재: { aliases: ['유통', '소비주'], extra: [/내수주/g] },
  // TIGER 200 중공업의 큰 비중은 조선사 — '조선'도 인정. '기계적 반등'의 '기계'는 빼고.
  중공업: { aliases: ['조선'], extra: [/기계(?!적)/g] },
  조선: { aliases: ['조선주'] },
  게임: { aliases: ['게임주'] },
  로봇: { aliases: ['로보틱스'] },
  리츠: { aliases: ['부동산'] },
  원자력: { aliases: ['원전', 'SMR'] },
}

function sectorDef(theme: string): SubjectDef {
  const entry = SECTOR[theme]
  const aliases = entry?.aliases ?? []
  const words = [theme, ...aliases]
  return {
    name: theme,
    aliases,
    patterns: [
      ...words.map(w => (/^[A-Za-z]+$/.test(w) ? token(w) : literal(w))),
      ...(entry?.extra ?? []),
    ],
  }
}

function subjectDef(slot: SubjectSlot): SubjectDef | null {
  if (slot.key === 'kr-sector') return slot.theme ? sectorDef(slot.theme) : null
  return FIXED[slot.key] ?? null
}

/** 프롬프트·위반 메시지에 쓰는 주제 자산군 이름(국내 섹터는 theme). */
export function subjectNameOf(slot: SubjectSlot): string {
  return subjectDef(slot)?.name ?? slot.theme ?? slot.key
}

/** 프롬프트에 보여 주는 같은 뜻 단어(검사도 모두 인정). */
export function subjectAliasesOf(slot: SubjectSlot): string[] {
  return subjectDef(slot)?.aliases ?? []
}

// 해외 시장 표시: 단어 바로 앞(공백 0~1개, '의' 허용)에 붙은 시장 이름. '미'·'중'처럼 짧은 표시는 앞이 한글·영문이 아닐 때만
// ('재미'의 '미'를 잡지 않게). '중' 단독은 넣지 않는다("장 중 반도체").
const FOREIGN_MARKET_BEFORE =
  /(?:^|[^가-힣A-Za-z])(?:미국|미·중|미중|미|美|중국|中|일본|日|유럽|대만|홍콩|해외|글로벌|뉴욕|월가)(?:의)?\s*$/
// "미 바이오·반도체"의 '반도체'처럼 · 목록 안의 단어는 목록 앞의 시장 표시를 함께 받는다 — 목록 앞부분을 걷어 내고 본다.
const LIST_HEAD = /(?:[^\s·,]+·\s*)+$/

function isForeignQualified(text: string, index: number): boolean {
  return FOREIGN_MARKET_BEFORE.test(text.slice(0, index).replace(LIST_HEAD, ''))
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

/**
 * 제목이 주제 자산군을 다루는지(이름·같은 뜻 단어가 있는지). 강조 태그는 벗기고 본다. 문자열이 아니거나 비어 있으면 false.
 * 국내 자산군(kr-*)은 해외 시장 표시가 붙은 단어("미 반도체", "중국 배터리")를 세지 않는다.
 */
export function headlineCoversSlot(headline: string, slot: SubjectSlot): boolean {
  if (typeof headline !== 'string' || headline.trim().length === 0) return false
  const def = subjectDef(slot)
  if (!def) return false
  const text = stripTags(headline)
  const domestic = slot.key.startsWith('kr-')
  for (const pattern of def.patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
      if (!domestic || !isForeignQualified(text, match.index ?? 0)) return true
    }
  }
  return false
}
