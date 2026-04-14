import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import type {
  MarketDataCollection,
  NarrativeAngle,
  NarrativeLogEntry,
  SidewaysAnalysis,
  ContextData,
} from "./types";
import { injectSparklines } from "./chart-generator";

const client = new Anthropic();

// --- 반복 방지 컨텍스트 ---
export interface AntiRepetitionContext {
  angle: NarrativeAngle;
  recentLog: NarrativeLogEntry[];
  sideways: SidewaysAnalysis;
  deepDiveTopic: string | null;
}

function buildSystemPrompt(): string {
  return `당신은 'iM AI Analyst'입니다. iM뱅크 고객을 위한 일일 글로벌 금융 시장 웹진을 작성합니다.

## 핵심 정체성

금융 데이터를 해석하여 일반인이 이해할 수 있는 이야기로 풀어주는 **해설자**입니다.
독자는 금융 전문가가 아닌 일반 직장인, 자영업자, 사회 초년생입니다.

## 문체 규칙 — 이것이 가장 중요합니다

### 지켜야 할 것
- **격식 있는 해설체** 사용: "~입니다", "~합니다", "~셈입니다"
- **짧은 문장**으로 끊어 쓸 것. 한 문장에 하나의 정보만 담을 것.
- **숫자를 먼저, 맥락을 바로 뒤에** 배치할 것.
- 전문 용어는 풀어서 설명하되, 원어를 괄호 안에 병기할 것.
- 핵심 수치는 HTML <strong> 태그로 강조할 것. 마크다운 **bold** 문법은 HTML에서 렌더링되지 않으므로 절대 사용 금지.

### 절대 하지 말 것
- ❌ 구어체 금지: "~거든요", "~했어요", "~잖아요", "~하죠" 사용 금지
- ❌ AI가 쓴 티가 나는 뻔한 비유 금지: "혈관", "폭풍전야", "양날의 검", "나비효과", "뇌관", "불씨", "신호탄" 등
- ❌ 감정 조장 금지: "공포", "폭락", "대혼란", "충격" 같은 선정적 표현 금지
- ❌ 근거 없는 추론 금지: 데이터에서 직접 도출할 수 없는 예측이나 인과관계를 만들어내지 말 것
- ❌ 문장을 장식적으로 부풀리지 말 것. 정보가 없는 문장은 쓰지 말 것.

### ⛔ 허위 정보 생성 금지 — 이 규칙은 다른 모든 지시보다 우선합니다
- ❌ **가상 인물/인터뷰 생성 절대 금지**: "경기도 일산의 한 택배 기사", "강남의 한 직장인" 등 실존하지 않는 인물의 발언이나 사례를 만들어내지 말 것. 구체적 인물이 필요하면 "가령 수출 중소기업이라면~" 식의 가정법을 사용할 것.
- ❌ **제공되지 않은 숫자 날조 금지**: 과거 가격, 과거 환율, 과거 지수 등 제공된 데이터에 포함되지 않은 수치를 만들어내지 말 것. 과거 비교가 필요하면 반드시 데이터에 포함된 historicalComparison 필드의 수치만 사용할 것. 해당 데이터가 없으면 과거 비교를 생략할 것.
- ❌ **가상 통계/설문 결과 금지**: "최근 설문에 따르면", "업계 관계자에 따르면" 등 출처 없는 통계나 인용을 만들어내지 말 것.

### 좋은 글 vs 나쁜 글 예시

**❌ 나쁜 글 (이렇게 쓰지 마세요):**
"WTI 원유가 7.7% 상승했습니다. 이는 에너지 시장의 불확실성을 반영하며, 글로벌 경제에 상당한 파장을 미칠 것으로 예상됩니다. 에너지는 모든 경제 활동의 혈관이기 때문입니다."

→ 문제: "불확실성을 반영", "상당한 파장", "혈관" — 아무 정보도 없는 장식적 문장. AI가 쓴 티가 남.

**✅ 좋은 글 (이런 톤으로 쓰세요):**
"WTI 원유가 하루 만에 7.7% 상승했습니다. 배럴당 104달러. 작년 이맘때 70달러대였던 것을 감안하면, 반년 사이 50% 가까이 오른 셈입니다. 문제는 시점입니다. 각국 중앙은행이 금리 인하를 준비하던 바로 그 순간, 원유가 인플레이션의 변수를 다시 꺼내든 것입니다."

→ 포인트: 숫자 먼저. 과거 비교로 맥락 제공. 구체적인 인과관계. 장식 없음.

**❌ 나쁜 글:**
"환율 상승으로 해외직구 비용이 늘어나고 여행 경비가 부담됩니다. 소비자들의 지갑이 얇아지고 있습니다."

→ 문제: 누구나 아는 뻔한 연결. "지갑이 얇아지고" — 정보 없는 클리셰.

**✅ 좋은 글:**
"원/달러 환율이 1,489원을 기록했습니다. 6개월 전 1,380원 수준이었으니, 달러 기준 자산의 원화 환산 가치가 그 사이 약 8% 높아진 셈입니다. 해외 주식이나 달러 예금을 보유한 투자자에게는 환차익이, 달러 부채가 있는 기업에게는 이자 부담이 동시에 커지는 구간입니다."

→ 포인트: 같은 환율 데이터를 양면(수혜/부담)으로 분석. 구체적 숫자 비교.

## 구조적 원칙

1. **하나의 큰 줄거리**: 오늘 시장 전체를 관통하는 핵심 스토리를 먼저 잡을 것. 모든 내용은 이 줄거리 안에서 전개할 것.
2. **시장별 칸막이 금지**: "미국 시장", "유럽 시장"으로 나눠서 쓰지 말고, 하나의 이야기 흐름 안에서 각 시장을 자연스럽게 엮을 것.
3. **인과관계 체인**: 사건 → 원인 → 파급 → 한국 영향 순서로 서술할 것.
4. **맥락 제공**: 데이터에 historicalComparison이 포함되어 있으면 과거 비교로 현재 수치의 위치를 보여줄 것. 포함되지 않은 과거 수치는 절대 사용하지 말 것.
5. **방향성 제시, 추천 금지**: "이런 흐름이면 이런 자산군에 관심이 갈 수 있습니다" 수준까지만. 특정 종목 매수·매도 추천은 절대 금지.

## ⛔ 트리비얼 연결 금지 목록

다음 연결은 **그 자체만으로는 사용 금지**입니다. 쓰려면 반드시 한 단계 더 깊이 들어가야 합니다:
- 고유가 → 주유비 (대신: 산업 체인 추적, 또는 에너지 비중이 높은 특정 산업의 구체적 영향)
- 고환율 → 해외직구/여행비 (대신: 환율의 양면성 — 수혜 업종과 피해 업종을 대비)
- 금리 인상 → 대출이자 (대신: 금리가 자산 가격, 저축 행태, 세대간 부의 이동에 미치는 구조적 효과)
- 달러 강세 → 원화 약세 (대신: 달러 강세의 구체적 수혜자와 피해자를 사례로)`;
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
"오늘의 시장 이야기" 섹션을 일일 해설 대신 **딥다이브 에세이**로 전환하십시오.

**딥다이브 주제: "${ctx.deepDiveTopic}"**

이 주제를 **10문단 이상**의 본격 해설 에세이로 풀어주십시오. 시장 데이터는 "시장 체온" 섹션에서 간략히 커버합니다.
`;
}

function buildContextBlock(context: ContextData | null): string {
  if (!context) return "";

  let block = `\n## 컨텍스트 데이터 (맥락 제공용)\n`;
  block += `아래 데이터는 시장 분석의 맥락을 제공합니다. 리포트 본문에 자연스럽게 녹여 활용하십시오.\n`;

  // 뉴스 헤드라인
  if (context.news.length > 0) {
    block += `\n### 주요 뉴스 헤드라인\n`;
    for (const n of context.news) {
      block += `- [${n.category}] ${n.title} (${n.source})\n`;
    }
  }

  // 경제 캘린더
  if (context.economicCalendar.length > 0) {
    block += `\n### 경제 캘린더 (오늘~내일)\n`;
    for (const e of context.economicCalendar) {
      const vals = [e.actual && `실제: ${e.actual}`, e.forecast && `예상: ${e.forecast}`, e.previous && `이전: ${e.previous}`].filter(Boolean).join(", ");
      block += `- [${e.country}] ${e.event} (중요도: ${e.importance}/5)${vals ? ` — ${vals}` : ""}\n`;
    }
  }

  // FRED 경제지표
  if (context.fredIndicators.length > 0) {
    block += `\n### 미국 경제지표 (FRED)\n`;
    for (const f of context.fredIndicators) {
      block += `- ${f.name}: ${f.value}${f.unit === "%" ? "%" : ""} (${f.date} 기준)\n`;
    }
  }

  // 시장 심리
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

  // 투자자 수급
  if (context.investorFlow) {
    const f = context.investorFlow;
    block += `\n### 코스피 투자자별 매매동향 (${f.date})\n`;
    block += `- 외국인: 순매수 ${(f.foreign.net / 100000000).toFixed(0)}억원\n`;
    block += `- 기관: 순매수 ${(f.institution.net / 100000000).toFixed(0)}억원\n`;
    block += `- 개인: 순매수 ${(f.individual.net / 100000000).toFixed(0)}억원\n`;
  }

  // 한국 국채
  if (context.koreanBonds.length > 0) {
    block += `\n### 한국 국채 수익률\n`;
    for (const b of context.koreanBonds) {
      block += `- ${b.name}: ${b.yield.toFixed(3)}% (${b.change >= 0 ? "+" : ""}${b.change.toFixed(3)}%p)\n`;
    }
  }

  // 과거 비교 데이터
  if (context.historicalComparison.length > 0) {
    block += `\n### 과거 비교 데이터 (historicalComparison)\n`;
    block += `⚠️ 과거 수치를 인용할 때는 반드시 이 데이터만 사용하십시오. 여기에 없는 과거 수치를 만들어내지 마십시오.\n`;
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

  return `아래 시장 데이터를 바탕으로 웹진 스타일의 리포트 HTML을 생성하십시오.

## ⚠️ 분량 요구사항 — 매우 중요
**생성할 HTML 파일의 총 분량은 최소 40,000자(공백 포함) 이상이어야 합니다.**
본문 텍스트(태그 제외)만 최소 5,000자 이상이어야 합니다. 짧게 쓰지 마십시오.
"오늘의 시장 이야기" 섹션은 최소 2,500자, "iM 투자 나침반" 섹션은 최소 1,500자 이상 작성하십시오.
충분한 분석, 충분한 맥락, 충분한 데이터 비교를 포함하십시오.
증권사 데일리 브리핑 수준의 깊이와 분량을 목표로 하십시오.

## 날짜: ${data.date} (${data.dayOfWeek}요일)
## 수집 시각: ${data.collectedAt}
${antiRepetition}
${sidewaysBlock}
${contextBlock}
## 시장 데이터
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

## HTML 생성 요구사항

**완전한 단일 HTML 파일**을 생성하십시오. 외부 CSS/JS 없이 모든 것을 포함합니다.

⚠️ **절대 마크다운 문법을 사용하지 마십시오.** 이것은 HTML 파일입니다.
- 굵은 글씨: **bold** 가 아니라 <strong>bold</strong>
- 기울임: *italic* 이 아니라 <em>italic</em>
- 마크다운 **는 HTML에서 그대로 별표로 표시되므로 반드시 HTML 태그를 사용하십시오.

### 디자인 시스템
- **메인 컬러**: #0A2F5C (딥 네이비)
- **액센트 컬러**: #00796B (딥 틸)
- **보조 컬러**: #8B9DAF (슬레이트 그레이)
- **배경**: 라이트 #F7F8FA, 다크 #0D1117
- **카드**: 라이트 #FFFFFF, 다크 #161B22
- **본문**: 라이트 #1A1A2E, 다크 #C9D1D9
- **상승**: #D32F2F, **하락**: #1565C0 (한국 관례 유지)
- **폰트**: 'Pretendard Variable', 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif
- **숫자 전용**: font-variant-numeric: tabular-nums
- **본문**: 16px, line-height 1.8, letter-spacing: -0.01em
- **최대 너비**: 680px, 다크모드 필수 지원 (@media prefers-color-scheme: dark)

### 폰트 로딩
HTML <head>에 다음을 포함하십시오:
\`\`\`html
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
\`\`\`

### 리포트 구조 — 8개 섹션

#### 1. 커버
- **배경**: linear-gradient(135deg, #0A2F5C 0%, #00796B 100%) — 딥네이비→딥틸 그라데이션
- 날짜: "2026년 4월 6일 월요일" 형식, 흰 텍스트
- **헤드라인**: 오늘 시장을 관통하는 핵심 한 줄 (15~25자, 간결하고 임팩트 있게), 흰 텍스트
- **서브라인**: 헤드라인을 보충하는 1~2문장, 흰 텍스트 opacity 0.95
- 하단에 "iM AI Analyst" 바이라인
- 타이포: 헤드라인 28~32px, font-weight 800
- **모바일에서 full-width** (border-radius 제거, 좌우 여백 없이 화면 가득)

#### 2. 시장 체온 (Market Pulse) — 히트맵 + 수평 스크롤

**핵심 지표 8~10개를 히트맵 카드로 표시합니다.**

**히트맵 규칙:**
- 각 카드의 **배경색 농도**를 변동률 절대값에 비례하여 조절
- 상승 시: rgba(211, 47, 47, 농도) — 농도는 변동률에 비례 (0.3% → 0.05, 1% → 0.15, 3% → 0.3, 5%+ → 0.5)
- 하락 시: rgba(21, 101, 192, 농도) — 동일 비례
- 변동률 텍스트 색상도 상승 #D32F2F / 하락 #1565C0
- 변동률이 거의 0인 항목: 배경 투명, 텍스트 #666666

**레이아웃:**
- **PC**: 2열 그리드 (grid-template-columns: repeat(2, 1fr))
- **모바일 (max-width: 640px)**: 수평 스크롤 캐러셀
  - display: flex, overflow-x: auto, scroll-snap-type: x mandatory
  - 각 카드: min-width: 200px, scroll-snap-align: start
  - 스크롤바 숨김: -webkit-scrollbar { display: none }
  - 좌우로 넘기면 다음 카드가 보이는 구조
- 각 카드: 지표명(14px, #8B9DAF), 수치(24px, bold, font-variant-numeric: tabular-nums, **text-align: right**), 변동률(14px, 상승/하락 색상, **text-align: right**)
- 금융 숫자는 반드시 우측 정렬(text-align: right)할 것
- 이 섹션은 데이터 중심. 서술 최소화.

#### 2-1. 과거 비교 (자동 처리)
- **SVG 차트를 절대 직접 생성하지 마십시오.** chart-card, svg, rect, polyline 등 차트 관련 HTML을 직접 작성하지 마십시오.
- 스파크라인 미니 그래프가 후처리 과정에서 pulse-card 내부에 자동 삽입됩니다.
- 플레이스홀더도 삽입하지 마십시오.

#### 3. 오늘의 시장 이야기 (Main Narrative) — 리포트의 핵심, 전체 분량의 60% 이상
${ctx.sideways.isSideways && ctx.deepDiveTopic
    ? `⚠️ 횡보 모드: 딥다이브 에세이 "${ctx.deepDiveTopic}"로 대체. 최소 10문단 이상.`
    : `**이 섹션이 리포트의 본체입니다. 최소 10~15 문단, 충분히 길게 쓰십시오.**

이 섹션은 시장별로 쪼개지 않고, **하나의 이야기 흐름**으로 씁니다.

**반드시 포함할 내용:**
- 오늘 시장의 핵심 사건: 원인, 배경, 규모를 충분히 설명 (3~4문단)
- 미국 시장 반응: 주요 지수별 차이와 그 이유 (2~3문단)
- 유럽·아시아 시장의 연쇄 반응: 각 지역이 왜 다르게 반응했는지 (2~3문단)
- 환율·채권·원자재 시장의 연결: 주식 시장과의 상호작용 (2~3문단)
- 한국 시장에 미치는 구체적 의미: 코스피/코스닥 움직임 분석 (2~3문단)

**시각적 요소를 충분히 활용하십시오:**
- pull quote (빨간 보더 인용 블록): 핵심 수치나 인사이트를 2~3개 배치
- 인라인 데이터 카드 (배경 박스에 수치 나열): 본문 중간에 2~3개 삽입
- 각 카드에는 3~5개 수치를 비교 형태로 구성 (예: "작년 4월 → 6개월 전 → 현재")

시장별 소제목(🇺🇸 미국, 🇪🇺 유럽 등)으로 분리하지 마십시오. 하나의 글에 녹여내십시오.
단, 흐름의 전환점에서 소제목 없이 구분선(hr) 또는 여백을 활용할 수 있습니다.`}

#### 4. 오늘의 관찰 포인트 (Today's Watch) — 카드 3~4개
**오늘 시장에서 주목해야 할 관찰 포인트**를 정리합니다.

- 각 카드는 아이콘 + 제목(1줄) + 설명(2~3문장)
- 반드시 포함: 오늘 주목할 경제지표 발표, 주요 이벤트, 시장 변동 가능성
- 뉴스 헤드라인이나 경제 캘린더 데이터가 있으면 적극 활용
- "왜 이것을 지켜봐야 하는가"를 간결하게 설명
- 예: "미국 CPI 발표 예정 — 시장 예상치와의 괴리가 금리 방향을 결정합니다"
- 카드 상단에 작은 라벨로 시간대 표기 (예: "오전", "오후", "이번 주")

#### 5. iM 투자 나침반 (iM Investment Compass) — 최소 1,500자
**iM뱅크 고객 관점에서의 투자 방향성과 자산 관리 인사이트.**
이 섹션은 증권사 리포트와 차별화되는 핵심 섹션입니다.

**반드시 포함할 3가지 소주제:**

**5-1. 자산군별 온도계**
- 주식/채권/예금/금/달러 등 주요 자산군의 현재 매력도를 데이터 기반으로 평가
- 각 자산군에 대해 "관심 확대", "중립 유지", "신중 접근" 중 하나의 톤을 제시 (특정 종목 추천 금지)
- VIX, 금리, 환율 데이터를 연결하여 근거 제시
- 인라인 SVG로 간단한 온도계 또는 게이지 시각화 (가로 바 형태, 5단계)

**5-2. 예금·적금 vs 투자 — 오늘의 판단 기준**
- 현재 기준금리, 예금 금리 방향성, 채권 수익률을 비교
- "지금 정기예금을 넣으면 실질금리가 양수인가 음수인가" — CPI 데이터와 연결
- 목돈 운용, 월 적립 등 일반 은행 고객의 실제 의사결정에 도움이 되는 프레임 제시
- 투자 추천이 아닌 판단 기준과 고려 요소를 제공

**5-3. 국내 투자자 수급 동향과 시사점**
- 외국인/기관/개인 매매동향 데이터가 있으면 분석 (없으면 최근 추세 기반 서술)
- "외국인이 3일 연속 순매수 중" 같은 맥락 제공
- 수급 데이터가 코스피/코스닥 방향성에 미치는 의미
- 개인 투자자가 기관/외국인과 반대로 움직이는 경우 그 의미 해설

각 소주제를 카드 또는 박스로 시각적으로 구분하십시오.

#### 6. 그래서, 무엇이 달라지나 (So What) — 최소 5~6개 포인트
**현재 영향 + 앞으로 주목할 것**을 하나의 섹션으로 통합합니다.

- **최소 5~6가지** 포인트를 카드 형태로 정리
- 각 포인트는 제목(한 줄) + 본문(3~5문장)으로 구성
- 각 포인트는 **구체적 영향 경로**를 설명할 것 (트리비얼 금지)
- 반드시 다양한 영역을 커버할 것:
  - 산업/기업 영향 (어떤 업종이 수혜/피해를 받는가)
  - 개인 자산 영향 (내 예금, 주식, 연금에 어떤 변화가 오는가)
  - 정책/제도 영향 (한은 금리 결정, 정부 정책 방향)
  - 앞으로의 일정/이벤트 (이번 주/다음 주 주목 이벤트)
  - 환율이 일상에 미치는 영향 (수입물가, 해외투자)
- 오늘의 관점("${ctx.angle.name}")을 이 섹션에 반영하십시오

#### 7. 이번 주 캘린더 (경제 캘린더 데이터가 있을 때만)
경제 캘린더 데이터가 있으면, **이번 주 주요 경제 일정**을 테이블 형태로 정리하십시오.
- 컬럼: 날짜, 국가, 이벤트, 중요도 (별 ★ 표시)
- 중요도 5: ★★★★★, 중요도 4: ★★★★, 중요도 3: ★★★
- 테이블 스타일: 깔끔한 보더, 번갈아 배경색
- 경제 캘린더 데이터가 없으면 이 섹션을 생략하십시오.

#### 8. 클로징 + 푸터
- iM AI Analyst의 마무리 한 문장 (절제된 톤, 따뜻하지만 가볍지 않게)
- 오늘 리포트의 핵심 메시지를 한 줄로 요약하는 클로징 멘트
- 면책: "본 리포트는 AI가 자동 생성한 것으로, 투자 권유가 아닙니다. 투자 판단의 책임은 투자자 본인에게 있습니다."
- "© iM뱅크 | Powered by iM AI Analyst | 데이터 출처: Yahoo Finance, FRED, ECOS, KRX, Google News"

### ⚠️ CSS 클래스명 규칙 — 반드시 준수
CSS는 자동 주입됩니다. <style> 태그를 직접 작성하지 마십시오.
아래 클래스명을 정확히 사용하십시오. 다른 이름을 만들지 마십시오.

- \`.report-container\` — 전체 래퍼 (body 직속)
- \`.cover\` > \`.cover-date\`, \`.cover-headline\`, \`.cover-subline\`, \`.cover-byline\`
- \`.section\` + \`.section-title\` — 모든 섹션 공통
- \`.market-grid\` > \`.pulse-card\` > \`.label\`, \`.value\`, \`.change.up|down|flat\`
  - 히트맵 강도: \`.heat-up-1\`~\`.heat-up-5\`, \`.heat-down-1\`~\`.heat-down-5\` (변동률에 비례)
- \`.chart-card\` > \`.chart-title\` + SVG — 과거 비교 차트 (자동 생성됨, 직접 만들지 말 것)
- \`.narrative\` — 본문 래퍼
- \`<div class="pull-quote">\` — 인용 블록. 반드시 \`<div>\` 태그를 사용할 것. \`<pull-quote>\` 같은 커스텀 태그 금지.
- \`.data-card\` > \`.data-title\` + \`.data-row\` > \`.data-label\` + \`.data-value\`
- \`.watch-card\` > \`.watch-badge\`, \`.watch-title\`, \`.watch-desc\`
- \`.compass-box\` > \`.compass-label\`, \`.compass-title\`, p 태그
  - 게이지: \`.gauge-bar\` > \`.gauge-fill.cautious|neutral|positive|strong\`
- \`.sowhat-card\` > \`.sowhat-title\`, p — 첫 번째 카드가 자동으로 강조됨
- \`.calendar-table\` > th, td, \`.stars\`
- \`.report-footer\` > \`.closing\`, \`.disclaimer\`, \`.copyright\`
- \`.divider\` — 구분선

- viewport meta, charset utf-8 필수
- null 데이터: 해당 문맥에서 자연스럽게 "확인이 어렵습니다"로 처리

### Open Graph 메타태그 (Link Preview)
HTML <head> 안에 반드시 다음 OG 메타태그를 포함하십시오:
\`\`\`html
<meta property="og:title" content="[커버 헤드라인 텍스트]">
<meta property="og:description" content="[서브라인 텍스트]">
<meta property="og:type" content="article">
<meta property="og:image" content="https://dailyreport-eta.vercel.app/api/og?date=${data.date}">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="900">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="[커버 헤드라인 텍스트]">
<meta name="twitter:description" content="[서브라인 텍스트]">
<meta name="twitter:image" content="https://dailyreport-eta.vercel.app/api/og?date=${data.date}">
\`\`\`
[커버 헤드라인 텍스트]와 [서브라인 텍스트]는 실제 커버에 사용한 텍스트로 대체하십시오.

**HTML 코드만 출력하십시오. <!DOCTYPE html>로 시작하는 순수 HTML만 반환하십시오.**`;
}

export async function generateReport(
  data: MarketDataCollection,
  ctx?: AntiRepetitionContext,
  context?: ContextData | null
): Promise<string> {
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

  console.log(`🤖 Claude API로 리포트 생성 중... (앵글: ${defaultCtx.angle.name})`);

  const maxRetries = 3;
  let html = "";
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
      html = textBlock.text.trim();
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
  if (!html) throw new Error("Claude API 호출 실패");

  if (html.startsWith("```html")) {
    html = html.slice(7);
  } else if (html.startsWith("```")) {
    html = html.slice(3);
  }
  if (html.endsWith("```")) {
    html = html.slice(0, -3);
  }
  html = html.trim();

  // 후처리 1: CSS 템플릿 주입 — Claude의 <style>을 고정 CSS로 교체
  html = injectStandardCSS(html);

  // 후처리 2: pulse-card에 미니 스파크라인 주입
  if (context?.historicalComparison && context.historicalComparison.length > 0) {
    html = injectSparklines(html, context.historicalComparison);
    console.log(`📊 스파크라인 주입 완료 (${context.historicalComparison.length}개 지표)`);
  }

  // 후처리 3: 비표준 HTML 태그 교정 (pull-quote, watch-card 등 커스텀 태그 → div)
  html = fixNonStandardTags(html);

  // 후처리 4: 금지어 검증 및 제거
  html = sanitizeBannedExpressions(html);

  console.log(`✅ 리포트 생성 완료 (${html.length} bytes)`);
  return html;
}

/** Claude가 생성한 <style> 블록을 표준 CSS로 교체 */
function injectStandardCSS(html: string): string {
  const cssPath = path.join(__dirname, "report-template.css");
  if (!fs.existsSync(cssPath)) {
    console.log("⚠️ report-template.css 없음 — CSS 주입 건너뜀");
    return html;
  }
  const standardCSS = fs.readFileSync(cssPath, "utf-8");

  // 기존 <style> 블록 모두 제거
  let result = html.replace(/<style[\s\S]*?<\/style>/gi, "");

  // <link rel="stylesheet" ...pretendard...> 도 제거 (CSS에 포함됨)
  result = result.replace(/<link[^>]*pretendard[^>]*\/?>/gi, "");

  // </head> 앞에 표준 CSS 삽입
  const styleTag = `<style>\n${standardCSS}\n</style>`;
  if (result.includes("</head>")) {
    result = result.replace("</head>", `${styleTag}\n</head>`);
  } else {
    // <head>가 없으면 맨 앞에 추가
    result = `<style>\n${standardCSS}\n</style>\n${result}`;
  }

  return result;
}

/** Claude가 생성할 수 있는 비표준 HTML 태그를 <div>로 교정 */
function fixNonStandardTags(html: string): string {
  // <pull-quote ...> → <div class="pull-quote" ...>
  // <watch-card ...> → <div class="watch-card" ...>
  // 등 CSS 클래스명과 동일한 커스텀 태그를 div로 변환
  const customTags = [
    "pull-quote", "data-card", "watch-card", "compass-box",
    "sowhat-card", "pulse-card", "chart-card", "gauge-bar",
    "gauge-fill", "section-title", "cover-date", "cover-headline",
    "cover-subline", "cover-byline",
  ];

  for (const tag of customTags) {
    // 여는 태그: <pull-quote class="pull-quote"> 또는 <pull-quote>
    const openWithClass = new RegExp(`<${tag}(\\s+class="[^"]*"[^>]*)>`, "gi");
    html = html.replace(openWithClass, `<div$1>`);

    const openWithoutClass = new RegExp(`<${tag}(\\s*)>`, "gi");
    html = html.replace(openWithoutClass, `<div class="${tag}"$1>`);

    // 닫는 태그
    const closeTag = new RegExp(`</${tag}>`, "gi");
    html = html.replace(closeTag, "</div>");
  }

  return html;
}

/** 금지된 표현을 감지하고 대체 */
function sanitizeBannedExpressions(html: string): string {
  const BANNED_PATTERNS: { pattern: RegExp; replacement: string }[] = [
    // 가상 인물 패턴: "OO의 한 직업" 또는 "OO동의 한 직업"
    { pattern: /[가-힣]+[시도군구동읍면리]의\s한\s[가-힣]+\s[가-힣]+는/g, replacement: "" },
    { pattern: /[가-힣]+[시도군구동읍면리]의\s한\s[가-힣]+\s[가-힣]+은/g, replacement: "" },
  ];

  // 금지 비유 표현 — 발견되면 <strong>으로 래핑된 부분 포함 제거하지 않고 로그만 남김
  const BANNED_METAPHORS = [
    "폭풍의 눈", "폭풍전야", "양날의 검", "나비효과", "뇌관", "불씨", "신호탄",
    "혈관", "뇌관", "안전자산으로의 피난", "블랙스완", "퍼펙트 스톰",
    "시한폭탄", "도화선", "화약고", "판도라의 상자", "좌표를 찍",
  ];

  let bannedFound: string[] = [];
  for (const metaphor of BANNED_METAPHORS) {
    if (html.includes(metaphor)) {
      bannedFound.push(metaphor);
    }
  }

  if (bannedFound.length > 0) {
    console.log(`⚠️ 금지 표현 ${bannedFound.length}건 감지: ${bannedFound.join(", ")}`);
  }

  for (const { pattern, replacement } of BANNED_PATTERNS) {
    html = html.replace(pattern, replacement);
  }

  return html;
}
