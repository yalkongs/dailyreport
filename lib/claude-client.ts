import Anthropic from "@anthropic-ai/sdk";
import type {
  MarketDataCollection,
  NarrativeAngle,
  NarrativeLogEntry,
  SidewaysAnalysis,
  ContextData,
  ReportContent,
} from "./types";
import { renderReport } from "./report-renderer";

const client = new Anthropic();

// --- 반복 방지 컨텍스트 ---
export interface AntiRepetitionContext {
  angle: NarrativeAngle;
  recentLog: NarrativeLogEntry[];
  sideways: SidewaysAnalysis;
  deepDiveTopic: string | null;
  // Phase 1 (2026-05-19): 시장 분위기별 가변 포맷 모드.
  // 비어있으면 normal 동작 (기존 동작과 동일).
  marketMode?: import("./market-mode").MarketModeAnalysis;
  // Phase B (2026-05-22): 시장 캘린더 정보 — 한국/미국 단독 휴장 시 Claude
  // 프롬프트에서 활용. 양국 휴장은 파이프라인이 이미 short-circuit 하므로
  // 여기로 흘러오지 않음. 비어있으면 모든 시장 정상 가정 (기존 동작).
  calendarInfo?: import("./market-calendar").MarketCalendarInfo;
}

function buildSystemPrompt(): string {
  return `당신은 'iM AI Analyst'입니다. iM뱅크 고객을 위한 일일 글로벌 금융 시장 웹진의 콘텐츠를 작성합니다.

## 핵심 정체성

금융 데이터를 해석하여 일반인이 이해할 수 있는 이야기로 풀어주는 **해설자**입니다.
독자는 금융 전문가가 아닌 일반 직장인, 자영업자, 사회 초년생입니다.

## 출력 형식

**반드시 JSON만 출력하십시오.** HTML, 마크다운, 설명 텍스트 없이 순수 JSON 객체만 반환하십시오.
JSON 내의 텍스트에서 강조가 필요한 수치는 <strong> 태그로 감쌀 수 있습니다.
그 외의 HTML 태그나 마크다운 문법은 사용하지 마십시오.

## 문체 규칙 — 이것이 가장 중요합니다

### 지켜야 할 것
- **격식 있는 해설체** 사용: "~입니다", "~합니다", "~셈입니다"
- **짧은 문장**으로 끊어 쓸 것. 한 문장에 하나의 정보만 담을 것.
- **숫자를 먼저, 맥락을 바로 뒤에** 배치할 것.
- 전문 용어는 풀어서 설명하되, 원어를 괄호 안에 병기할 것.
- 핵심 수치는 <strong> 태그로 강조할 것.

### 절대 하지 말 것
- ❌ 구어체 금지: "~거든요", "~했어요", "~잖아요", "~하죠" 사용 금지
- ❌ AI가 쓴 티가 나는 뻔한 비유 금지: "혈관", "폭풍전야", "양날의 검", "나비효과", "뇌관", "불씨", "신호탄" 등
- ❌ 감정 조장 금지: "공포", "폭락", "대혼란", "충격" 같은 선정적 표현 금지
- ❌ 근거 없는 추론 금지: 데이터에서 직접 도출할 수 없는 예측이나 인과관계를 만들어내지 말 것
- ❌ 문장을 장식적으로 부풀리지 말 것. 정보가 없는 문장은 쓰지 말 것.
- ❌ 이모지 사용 금지: 제목이나 본문에 이모지를 넣지 마십시오.

### ⛔ 허위 정보 생성 금지 — 이 규칙은 다른 모든 지시보다 우선합니다
- ❌ **가상 인물/인터뷰 생성 절대 금지**: "경기도 일산의 한 택배 기사" 등 실존하지 않는 인물의 발언이나 사례를 만들어내지 말 것.
- ❌ **제공되지 않은 숫자 날조 금지**: 과거 비교가 필요하면 반드시 historicalComparison 필드의 수치만 사용할 것. 해당 데이터가 없으면 과거 비교를 생략할 것.
- ❌ **가상 통계/설문 결과 금지**: "최근 설문에 따르면" 등 출처 없는 통계를 만들어내지 말 것.

### 좋은 글 vs 나쁜 글 예시

**❌ 나쁜 글:**
"WTI 원유가 7.7% 상승했습니다. 이는 에너지 시장의 불확실성을 반영하며, 글로벌 경제에 상당한 파장을 미칠 것으로 예상됩니다."

**✅ 좋은 글:**
"WTI 원유가 하루 만에 7.7% 상승했습니다. 배럴당 104달러. 작년 이맘때 70달러대였던 것을 감안하면, 반년 사이 50% 가까이 오른 셈입니다. 문제는 시점입니다. 각국 중앙은행이 금리 인하를 준비하던 바로 그 순간, 원유가 인플레이션의 변수를 다시 꺼내든 것입니다."

## 구조적 원칙

1. **하나의 큰 줄거리**: 오늘 시장 전체를 관통하는 핵심 스토리를 먼저 잡을 것.
2. **시장별 칸막이 금지**: 하나의 이야기 흐름 안에서 각 시장을 자연스럽게 엮을 것.
3. **인과관계 체인**: 사건 → 원인 → 파급 → 한국 영향 순서로 서술할 것.
4. **맥락 제공**: historicalComparison 데이터로 현재 수치의 위치를 보여줄 것. 포함되지 않은 과거 수치는 절대 사용 금지.
5. **방향성 제시, 추천 금지**: 특정 종목 매수·매도 추천은 절대 금지.

## ⛔ 트리비얼 연결 금지 목록

다음 연결은 그 자체만으로는 사용 금지. 한 단계 더 깊이 들어가야 합니다:
- 고유가 → 주유비 (대신: 산업 체인 추적)
- 고환율 → 해외직구/여행비 (대신: 환율의 양면성)
- 금리 인상 → 대출이자 (대신: 구조적 효과)
- 달러 강세 → 원화 약세 (대신: 구체적 수혜자/피해자)`;
}

function buildAntiRepetitionBlock(ctx: AntiRepetitionContext): string {
  let block = `\n## 내러티브 반복 방지\n`;

  block += `\n### 오늘의 관점: "${ctx.angle.name}"
${ctx.angle.promptGuide}\n`;

  if (ctx.recentLog.length > 0) {
    block += `\n### 최근 리포트에서 사용된 요소 (반복 금지)\n`;

    const usedHeadlines = ctx.recentLog.map((e) => e.headline).filter(Boolean);
    if (usedHeadlines.length > 0) {
      block += `- 헤드라인: ${usedHeadlines.join(" / ")}\n`;
    }

    const usedTopics = ctx.recentLog.map((e) => e.bigStoryTopic).filter(Boolean);
    if (usedTopics.length > 0) {
      block += `- 메인 주제: ${usedTopics.join(" / ")}\n`;
    }

    const usedWallet = [...new Set(ctx.recentLog.flatMap((e) => e.walletTopics))];
    if (usedWallet.length > 0) {
      block += `- 영향 분석 토픽: ${usedWallet.join(", ")}\n`;
    }

    const usedMetaphors = [...new Set(ctx.recentLog.flatMap((e) => e.metaphors))];
    if (usedMetaphors.length > 0) {
      block += `- 비유/은유: ${usedMetaphors.join(", ")}\n`;
    }

    block += `\n위 요소와 동일하거나 유사한 표현은 사용하지 마십시오.\n`;
  }

  return block;
}

function buildSidewaysBlock(ctx: AntiRepetitionContext): string {
  if (!ctx.sideways.isSideways || !ctx.deepDiveTopic) return "";

  return `
## 횡보 시장 — 딥다이브 모드

오늘은 주요 지표의 변동이 미미합니다 (평균 |변동률|: ${ctx.sideways.avgAbsChange.toFixed(2)}%).
bigStory 섹션을 일일 해설 대신 **딥다이브 에세이**로 전환하십시오.

**딥다이브 주제: "${ctx.deepDiveTopic}"**

이 주제를 paragraph 블록 10개 이상으로 풀어주십시오.
`;
}

function buildContextBlock(context: ContextData | null): string {
  if (!context) return "";

  let block = `\n## 컨텍스트 데이터 (맥락 제공용)\n`;
  block += `아래 데이터는 시장 분석의 맥락을 제공합니다. 리포트 본문에 자연스럽게 녹여 활용하십시오.\n`;

  if (context.news.length > 0) {
    block += `\n### 주요 뉴스 헤드라인 (최신순, 발행 경과 시간 포함)\n`;
    for (const n of context.news) {
      const ago = typeof n.publishedHoursAgo === "number"
        ? `${Math.round(n.publishedHoursAgo)}h전`
        : "시각미상";
      block += `- [${n.category}|${ago}] ${n.title} (${n.source})\n`;
    }
    block += `위 헤드라인 중 발행 경과 시간이 짧은(최근) 한국 시장 관련 뉴스를 우선 반영하십시오. `;
    block += `특히 시총 상위 기업(삼성전자 등) 이벤트나 수급 변화는 오늘 국내 장 방향의 핵심 변수일 수 있습니다. `;
    block += `단, 제목만 제공되므로 기사 본문 내용을 단정하지 말고 "~로 알려졌다" 수준으로만 인용하십시오.\n`;
  }

  if (context.economicCalendar.length > 0) {
    block += `\n### 경제 캘린더 (오늘~내일)\n`;
    for (const e of context.economicCalendar) {
      const vals = [e.actual && `실제: ${e.actual}`, e.forecast && `예상: ${e.forecast}`, e.previous && `이전: ${e.previous}`].filter(Boolean).join(", ");
      block += `- [${e.country}] ${e.event} (중요도: ${e.importance}/5)${vals ? ` — ${vals}` : ""}\n`;
    }
  }

  if (context.fredIndicators.length > 0) {
    block += `\n### 미국 경제지표 (FRED)\n`;
    for (const f of context.fredIndicators) {
      block += `- ${f.name}: ${f.value}${f.unit === "%" ? "%" : ""} (${f.date} 기준)\n`;
    }
  }

  if (context.sentiment.vix || context.sentiment.fearGreed) {
    block += `\n### 시장 심리\n`;
    if (context.sentiment.vix) {
      const v = context.sentiment.vix;
      block += `- VIX(공포지수): ${v.value.toFixed(2)} (${v.changePercent >= 0 ? "+" : ""}${v.changePercent.toFixed(2)}%)\n`;
    }
    if (context.sentiment.fearGreed) {
      const fg = context.sentiment.fearGreed;
      block += `- CNN Fear & Greed Index: ${fg.value} (${fg.label})\n`;
    }
  }

  // NOTE: KRX OpenAPI는 투자자별 매매동향 데이터를 제공하지 않음.
  // lib/krx-investor-flow.ts 는 deprecated stub이며 항상 null 반환.
  // 과거 이 블록은 매번 허위 수치로 채워져 Claude가 'compass.국내 투자자
  // 수급 동향' 섹션에 존재하지 않는 근거로 서술을 만들던 원인이었음.
  // 프롬프트에서 블록 제거 + compass 슬롯 재설계로 대응 (본 파일 하단).

  if (context.koreanBonds.length > 0) {
    block += `\n### 한국 국채 수익률\n`;
    for (const b of context.koreanBonds) {
      block += `- ${b.name}: ${b.yield.toFixed(3)}% (${b.change >= 0 ? "+" : ""}${b.change.toFixed(3)}%p)\n`;
    }
  }

  if (context.historicalComparison.length > 0) {
    block += `\n### 과거 비교 데이터 (historicalComparison)\n`;
    block += `⚠️ 과거 수치를 인용할 때는 반드시 이 데이터만 사용하십시오.\n`;
    for (const h of context.historicalComparison) {
      const parts = [`현재: ${h.current}`];
      if (h.oneWeekAgo != null) parts.push(`1주전: ${h.oneWeekAgo}`);
      if (h.oneMonthAgo != null) parts.push(`1개월전: ${h.oneMonthAgo}`);
      if (h.threeMonthsAgo != null) parts.push(`3개월전: ${h.threeMonthsAgo}`);
      if (h.oneYearAgo != null) parts.push(`1년전: ${h.oneYearAgo}`);
      block += `- ${h.nameKo}: ${parts.join(" / ")}\n`;
    }
  }

  return block;
}

function buildReportPrompt(data: MarketDataCollection, ctx: AntiRepetitionContext, context: ContextData | null = null): string {
  const antiRepetition = buildAntiRepetitionBlock(ctx);
  const sidewaysBlock = buildSidewaysBlock(ctx);
  const contextBlock = buildContextBlock(context);

  // Phase 1: 시장 분위기 모드별 분량·구성 가이드.
  const modeBlock = ctx.marketMode
    ? `\n## 🎨 오늘의 리포트 모드: **${ctx.marketMode.mode}**\n${ctx.marketMode.reason}\n\n${require("./market-mode").describeModeForPrompt(ctx.marketMode.mode)}\n`
    : "";

  // Phase F1 (2026-05-24): 한국 매크로 캘린더 (주 1회 web_search 갱신 캐시).
  // 캐시 없거나 이벤트 0건이면 빈 문자열 → 프롬프트 변화 없음 (graceful fallback).
  const krMacroBlock = (() => {
    const { getUpcomingKrMacroEvents, formatKrMacroEventLine } = require("./kr-macro-calendar");
    const events = getUpcomingKrMacroEvents(data.date, 7);
    if (!events || events.length === 0) return "";
    const lines = events.map((e: import("./kr-macro-calendar").KrMacroEvent) =>
      `  - ${formatKrMacroEventLine(e, data.date)}${e.description ? `\n      └ ${e.description}` : ""}`
    ).join("\n");
    return `\n## 🇰🇷 한국 주요 매크로 일정 (오늘~7일)
${lines}

위 일정은 web_search 기반 자동 수집 캐시이며 일부는 패턴 추정입니다. 각 항목의 description 에 출처·확실성 표기가 있습니다.
- **오늘 발표 예정인 지표가 있으면** 본문 또는 watchPoints 에서 명시적으로 언급하십시오.
- 한국은행 금통위·CPI 같은 ★★★★★ 이벤트는 본문 narrative 의 forward catalyst 로 부각.
- 추정 일정(description 에 "추정" 표기) 은 "예정" 또는 "관례상 N월 N일 전후" 같은 완곡한 표현 사용.
`;
  })();

  // Phase C (2026-05-22): 단독 휴장 시 캘린더 컨텍스트 블록.
  // 양국 모두 정상이거나 calendarInfo 가 없으면 빈 문자열.
  const calendarBlock = (() => {
    const info = ctx.calendarInfo;
    if (!info || (!info.isKrClosedOnly && !info.isUsClosedOnly)) return "";
    if (info.isKrClosedOnly) {
      return `\n## 🏖️ 시장 캘린더 — 한국 휴장
- **오늘 한국 시장: 휴장 (${info.krHolidayName ?? "주말"})**
- 한국 직전 영업일: ${info.krPrevTradingDay} / 다음 영업일: ${info.krNextTradingDay}
- 미국 시장: 정상 (간밤 마감 데이터)

**리포트 작성 시 반드시 반영하십시오**:
1. 코스피·코스닥·원/달러 등 **한국 데이터는 직전 영업일(${info.krPrevTradingDay}) 종가**입니다. "오늘 코스피는 X로 마감했다" 같은 서술 금지. "직전 영업일(${info.krPrevTradingDay}) 마감 기준" 또는 "휴장 전 마지막 거래일" 명시.
2. 헤드라인은 미국 중심 또는 휴장 자체를 명시. (예: "한국 휴장 속, 미 증시는 X")
3. 한국 시장 관련 뉴스가 있어도 "오늘 장에서" 라고 쓰지 말 것.
4. "다음 영업일(${info.krNextTradingDay})에 무엇을 살펴야 하는지" 를 한 단락 이상 포함.
`;
    }
    // isUsClosedOnly
    return `\n## 🏖️ 시장 캘린더 — 미국 휴장
- **간밤 미국 시장: 휴장 (${info.usHolidayName ?? "주말"})**
- 미국 직전 영업일: ${info.usPrevTradingDay} / 다음 영업일: ${info.usNextTradingDay}
- 한국 시장: 정상 (오늘 개장)

**리포트 작성 시 반드시 반영하십시오**:
1. SPY·QQQ·VIX·미 10Y 등 **미국 데이터는 직전 영업일(${info.usPrevTradingDay}) 종가**입니다. "간밤 S&P500은 X로 마감" 같은 단정 금지. "직전 영업일 종가" 또는 "${info.usHolidayName ?? "휴장"} 으로 어제는 거래 없음" 명시.
2. 헤드라인은 한국 중심으로. (예: "미 증시 휴장, 한국만의 흐름은 X")
3. "간밤 해외 동향" 표현보다 "직전 거래일 마감 기준" 같은 정확한 표현 사용.
4. 한국 시장 자체의 동인(외국인·기관 수급, 환율, 종목 뉴스)에 비중을 더 두십시오.
`;
  })();

  return `아래 시장 데이터를 바탕으로 리포트 콘텐츠를 JSON 형식으로 생성하십시오.

## ⚠️ 분량 요구사항 — **위 모드 가이드가 있으면 그것을 우선**
- (기본/normal 모드 기준) bigStory.content: paragraph 블록 최소 12개 이상, pullQuote 2~3개, dataCard 2~3개
- watchPoints: 3~4개
- compass: 3개 소주제 (자산군별 온도계, 예금 vs 투자, 수급 동향)
- soWhat: 5~6개
- calendar: 경제 캘린더 데이터가 있으면 주요 일정 포함
증권사 데일리 브리핑 수준의 깊이와 분량을 목표로 하십시오.
${modeBlock}
${calendarBlock}
${krMacroBlock}
## 날짜: ${data.date} (${data.dayOfWeek}요일)
## 수집 시각: ${data.collectedAt}
${antiRepetition}
${sidewaysBlock}
${contextBlock}
## 시장 데이터
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

## JSON 출력 스키마

아래 구조의 JSON 객체를 반환하십시오. 이 외의 텍스트는 절대 포함하지 마십시오.

\`\`\`typescript
{
  "cover": {
    "headline": string,   // 오늘 시장을 관통하는 핵심 한 줄 (15~25자)
    "subline": string     // 헤드라인을 보충하는 1~2문장
  },
  "bigStory": {
    "content": Array<
      | { "type": "paragraph", "text": string }       // 본문 문단. <strong> 태그 사용 가능
      | { "type": "pullQuote", "text": string }        // 핵심 인사이트 인용
      | { "type": "dataCard", "title": string, "rows": Array<{ "label": string, "value": string }> }
    >
  },
  "watchPoints": [
    {
      "badge": string,       // "오전", "오후", "이번 주" 등 시간대
      "title": string,       // 제목 (이모지 금지)
      "description": string  // 2~3문장 설명
    }
  ],
  "compass": [
    {
      "label": string,     // "자산군별 온도계" / "예금·적금 vs 투자" / 세 번째 슬롯은 아래 compass 작성 규칙의 [A]/[B]/[C] 메뉴에서 선택한 label
      "title": string,     // 소제목
      "items": [            // 자산군별 온도계용
        {
          "asset": string,         // "주식", "채권", "금·귀금속" 등
          "body": string,          // 분석 텍스트 (<strong> 사용 가능)
          "gaugePercent": number,  // 매력도 0~100 (0=매우 부정, 100=매우 긍정)
          "gaugeType": "cautious" | "neutral" | "positive" | "strong"
        }
      ],
      "paragraphs": [string]   // items가 없는 서브섹션용 본문 문단
    }
  ],
  "soWhat": [
    {
      "title": string,   // 제목 한 줄
      "body": string     // 3~5문장 (<strong> 사용 가능)
    }
  ],
  "calendar": [
    {
      "date": string,       // "4/15" 등
      "country": string,    // "미국", "중국", "한국" 등
      "event": string,      // 이벤트명
      "importance": number  // 1~5
    }
  ],
  "closingMessage": string  // 마무리 한 문장
}
\`\`\`

### bigStory 작성 규칙

이 섹션이 리포트의 본체입니다. 충분히 길게 쓰십시오.

**반드시 포함할 내용 (하나의 이야기 흐름으로):**
- 오늘 시장의 핵심 사건: 원인, 배경, 규모 (paragraph 3~4개)
- 미국 시장 반응: 주요 지수별 차이와 그 이유 (paragraph 2~3개)
- 유럽·아시아 시장의 연쇄 반응 (paragraph 2~3개)
- 환율·채권·원자재 시장의 연결 (paragraph 2~3개)
- 한국 시장에 미치는 구체적 의미 (paragraph 2~3개)
- pullQuote 2~3개를 흐름 중간에 배치
- dataCard 2~3개를 적절한 위치에 삽입

시장별 소제목으로 분리하지 마십시오. 하나의 글에 녹여내십시오.

### compass 작성 규칙

3개 소주제를 반드시 포함:
1. **자산군별 온도계**: items 배열에 주식/채권/금/달러/암호화폐 등 5~6개. gaugePercent는 VIX, 금리, 환율 데이터를 근거로 산출.
2. **예금·적금 vs 투자**: paragraphs 배열 사용. 기준금리, CPI, 실질금리 비교.
3. **[오늘의 맥락]** — 아래 3개 메뉴 중 오늘 데이터에 가장 부합하는 **1개**를 선택해 1개 compass 섹션으로 작성하십시오. 선택한 항목의 label 문자열을 그대로 사용합니다.

   **[A] label="내 지갑과 이 뉴스"**
   - 오늘의 금리·환율·물가 변화가 가계 재무(예적금 수익률, 대출이자, 환전비용, 장바구니 물가, 연금·국민연금)에 미치는 구체적 맥락을 paragraphs 2~3문단으로.
   - 선택 기준: USD/KRW, 미 10Y, 한은 기준금리, CPI 등 거시 지표의 변동률이 유의미하거나 금리·환율 관련 정책 뉴스가 있을 때.
   - soWhat 섹션은 '오늘 뉴스의 개별 산업·기업 영향'이므로 이 compass 섹션은 '가계 재무 맥락 (거시→개인 재무)' 로 역할 분리.

   **[B] label="오늘의 글로벌 연결"**
   - 미·유럽·아시아 시장의 연쇄 반응 구조와 그것이 한국 시장에 미치는 2차·3차 파급. paragraphs 2~3문단.
   - 선택 기준: 해외(미국·중국·유럽)에서 발생한 사건이 글로벌 리플을 일으킨 날, bigStory에서 다 담지 못한 추가 연결고리가 있을 때.
   - bigStory와 중복 금지. bigStory가 사건의 '무엇'을 다뤘다면 여기서는 '어떻게 퍼지나·어디로 갈 것인가' 만.

   **[C] label="오늘의 업종 온도"**
   - 한국 시장 섹터별 상대 강도 (반도체·자동차·에너지·금융·바이오 등). items 배열 사용 가능 (asset=섹터명, gaugePercent 0~100, gaugeType, body 짧은 설명) 또는 paragraphs 2~3문단.
   - 선택 기준: 섹터 로테이션·특정 업종 급등락·업종별 수급 집중이 관측되는 날.

   **선택 규칙 (위 3개 중 하나만)**:
   - 오늘 제공된 데이터에서 **가장 두드러진 신호**가 있는 주제를 우선 선택.
   - 어느 신호도 확실치 않으면 **[A]를 기본값**으로 선택 (거시 지표만 있어도 가계 맥락은 항상 쓸 수 있음).
   - **제공된 실제 수치만 인용하십시오**. 외국인 순매수 금액·세대별 매매 비중 등 입력에 없는 수치는 절대 추측해 넣지 마십시오.
   - 선택한 label을 compass 배열의 3번째 객체 label 필드에 그대로 사용.

### soWhat 작성 규칙
- 최소 5~6개
- 산업/기업 영향, 개인 자산 영향, 정책 영향, 향후 이벤트 등 다양한 영역 커버
- 오늘의 관점("${ctx.angle.name}")을 반영

**JSON만 출력하십시오. \`\`\`json 마크다운 펜스도 사용하지 마십시오.**`;
}

export async function generateReport(
  data: MarketDataCollection,
  ctx?: AntiRepetitionContext,
  context?: ContextData | null
): Promise<{ html: string; content: ReportContent }> {
  const defaultCtx: AntiRepetitionContext = ctx || {
    angle: {
      id: "structural_lens",
      name: "구조적 렌즈",
      description: "",
      promptGuide: "오늘의 데이터를 구조적 관점에서 해석하십시오.",
    },
    recentLog: [],
    sideways: { isSideways: false, avgAbsChange: 0, deepDiveTopic: null },
    deepDiveTopic: null,
  };

  console.log(`🤖 Claude API로 리포트 콘텐츠(JSON) 생성 중... (앵글: ${defaultCtx.angle.name})`);

  const maxRetries = 3;
  let rawJson = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const stream = await client.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 64000,
        messages: [
          {
            role: "user",
            content: buildReportPrompt(data, defaultCtx, context ?? null),
          },
        ],
        system: buildSystemPrompt(),
      });

      const message = await stream.finalMessage();
      const textBlock = message.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude API 응답에 텍스트 블록이 없습니다");
      }
      rawJson = textBlock.text.trim();
      break;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 && attempt < maxRetries) {
        console.log(`⏳ API 과부하, ${attempt * 10}초 후 재시도 (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, attempt * 10000));
        continue;
      }
      throw err;
    }
  }
  if (!rawJson) throw new Error("Claude API 호출 실패");

  // JSON 파싱 — 마크다운 펜스 제거
  if (rawJson.startsWith("```json")) {
    rawJson = rawJson.slice(7);
  } else if (rawJson.startsWith("```")) {
    rawJson = rawJson.slice(3);
  }
  if (rawJson.endsWith("```")) {
    rawJson = rawJson.slice(0, -3);
  }
  rawJson = rawJson.trim();

  let content: ReportContent;
  try {
    content = JSON.parse(rawJson) as ReportContent;
  } catch (parseErr) {
    console.error("❌ JSON 파싱 실패. 원문 길이:", rawJson.length);
    console.error("❌ 처음 200자:", rawJson.substring(0, 200));
    throw new Error(`Claude JSON 파싱 실패: ${parseErr}`);
  }

  // JSON 콘텐츠 후처리: 금지 표현 검사
  const jsonStr = JSON.stringify(content);
  sanitizeBannedExpressions(jsonStr);

  console.log(`📄 JSON 파싱 성공 — bigStory: ${content.bigStory.content.length}블록, watchPoints: ${content.watchPoints.length}, compass: ${content.compass.length}, soWhat: ${content.soWhat.length}`);

  // gaugePercent 정규화: gaugeType 기반 고정값으로 매핑 (Claude 임의값 방지)
  for (const section of content.compass) {
    if (section.items) {
      for (const item of section.items) {
        item.gaugePercent = gaugeTypeToPercent(item.gaugeType);
      }
    }
  }

  // 캘린더: Claude 생성 대신 실제 경제 캘린더 데이터 사용 (날조 방지)
  if (context?.economicCalendar && context.economicCalendar.length > 0) {
    content.calendar = context.economicCalendar
      .filter((e) => e.importance >= 3)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 8)
      .map((e) => ({
        date: formatCalendarDate(e.date),
        country: e.country,
        event: e.event,
        importance: e.importance,
      }));
    console.log(`📅 캘린더: 실제 경제 데이터에서 ${content.calendar.length}건 사용 (Claude 생성 대체)`);
  }

  // 코드 템플릿으로 HTML 렌더링 (Phase 1: 모드 전달)
  const historicalData = context?.historicalComparison ?? [];
  const mode = (ctx ?? defaultCtx).marketMode?.mode;
  const html = renderReport(content, data, historicalData, mode);

  console.log(`✅ 리포트 렌더링 완료 (${html.length} bytes, 모드: ${mode ?? "n/a"})`);
  return { html, content };
}

/** gaugeType → 고정 퍼센트 매핑 (Claude의 임의 수치 대신 일관된 시각화) */
function gaugeTypeToPercent(type: string): number {
  switch (type) {
    case "strong": return 85;
    case "positive": return 68;
    case "neutral": return 50;
    case "cautious": return 30;
    default: return 50;
  }
}

/** 경제 캘린더 날짜 포맷 (YYYY-MM-DD → M/D) */
function formatCalendarDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
  }
  return dateStr;
}

/** 금지된 표현을 감지하고 로그 (JSON에서는 제거하지 않고 경고만) */
function sanitizeBannedExpressions(text: string): void {
  const BANNED_METAPHORS = [
    "폭풍의 눈", "폭풍전야", "양날의 검", "나비효과", "뇌관", "불씨", "신호탄",
    "혈관", "안전자산으로의 피난", "블랙스완", "퍼펙트 스톰",
    "시한폭탄", "도화선", "화약고", "판도라의 상자", "좌표를 찍",
  ];

  const bannedFound: string[] = [];
  for (const metaphor of BANNED_METAPHORS) {
    if (text.includes(metaphor)) {
      bannedFound.push(metaphor);
    }
  }

  if (bannedFound.length > 0) {
    console.log(`⚠️ 금지 표현 ${bannedFound.length}건 감지: ${bannedFound.join(", ")}`);
  }

  // 가상 인물 패턴 검사
  const fakePersonPatterns = [
    /[가-힣]+[시도군구동읍면리]의\s한\s[가-힣]+/g,
  ];
  for (const pattern of fakePersonPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      console.log(`⚠️ 가상 인물 패턴 감지: ${matches.join(", ")}`);
    }
  }
}
