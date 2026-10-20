import Anthropic from "@anthropic-ai/sdk";
import type {
  MarketDataCollection,
  NarrativeAngle,
  NarrativeLogEntry,
  SidewaysAnalysis,
  ContextData,
  HistoricalComparison,
  ReportContent,
  ReportSummary,
} from "./types";
import { CLAUDE_MAX_RETRIES, CLAUDE_REQUEST_TIMEOUT_MS, MARKET_GENERATION_BUDGET_MS, makeDeadline } from "./claude-budget";
import { EVIDENCE_RULES } from "./evidence-rules";
import { formatEconomicEventLine } from "./economic-calendar";
import { renderReport } from "./report-renderer";
import { cardTextFits } from "./preview/data-card";
import { stripEmphasisTags } from "./html-entities";
import { plainText, cutAtSentence } from "./market-summary";
import { BANNED_METAPHORS } from "./banned-metaphors";
import { renderVoiceExemplars } from "./voice-exemplars";
import { buildTemporalFramingBlock } from "./temporal-framing";
// R2·R3 (2026-07-22): 시점·출처 정합 검사(파싱 직후 문자열 레벨 soft fix).
import { checkAndFixTemporal } from "./temporal-consistency";
import { softFixUnquotableSources, countCitationPhrases, QUOTABLE_SOURCES } from "./quotable-sources";
import { renderPolicyRateBlock, POLICY_RATE_RULE, findPolicyDirectionMismatches, extractReportText } from "./policy-rate";
// Ruling 31 (2026-10-19): 제목·카드 한 줄의 확인할 수 없는 기간 비교·최상급 표현(ETF와 공용).
import { comparativeClaimViolations } from "./comparative-claims";
// Ruling 37·37a (2026-10-20): 독자에게 사라·팔라는 지시형·수익 보장(Market용 좁은 목록) — 마지막 시도에도 막는다.
import { findDirectiveAdvice } from "./compliance";

// F07: 요청 상한·SDK 재시도를 명시(기본 10분·2회는 job 상한 20분과 맞지 않았다).
const client = new Anthropic({ timeout: CLAUDE_REQUEST_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES });

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
  // Layer 0 (2026-05-29): 근거 충분성 tier. run.ts 가 항상 채움(컨텍스트 null 이어도 hollow 산출). 없으면 근거 상태 블록 생략.
  evidence?: import("./evidence-confidence").EvidenceConfidence;
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
- **짧은 문장**으로 끊어 쓸 것. 한 문장에 하나의 정보만 담을 것. 리듬을 위해 명사 종결 조각("배럴당 104달러.")을 가끔 펀치로 써도 좋다. 같은 어미("~입니다")가 여러 문장 연속되면 "~셈입니다/~것입니다/~점입니다" 등으로 변주할 것.
- **숫자를 먼저, 맥락을 바로 뒤에** 배치할 것.
- 전문 용어는 풀어서 설명하되, 원어를 괄호 안에 병기할 것.
- 핵심 수치는 <strong> 태그로 강조할 것.
- **신선하고 구체적인 은유·관점**을 적극 사용할 것 (제목·본문 모두). 단 오늘의 데이터에서 길어올린 은유만 — "아무 날에나 붙일 수 있는 비유"는 쓰지 말 것.

### 절대 하지 말 것
- ❌ 구어체 금지: "~거든요", "~했어요", "~잖아요", "~하죠" 사용 금지
- ❌ 죽은 클리셰(뻔한 비유)는 피하십시오. 무엇이 진부한지는 아래 [목표 보이스] 블록의 예시로 익히고, 매번 어느 날에나 붙일 수 있는 비유는 쓰지 마십시오. (하드 금지어 목록이 아니라 결을 따르는 것입니다.)
- ❌ 감정 조장 금지: "공포", "폭락", "대혼란", "충격" 같은 선정적 표현 금지
- ❌ 근거 없는 추론 금지: 데이터에서 직접 도출할 수 없는 예측이나 인과관계를 만들어내지 말 것
- ❌ 문장을 장식적으로 부풀리지 말 것. 정보가 없는 문장은 쓰지 말 것.
- ❌ 이모지 사용 금지: 제목이나 본문에 이모지를 넣지 마십시오.

${renderVoiceExemplars()}

### ⛔ 허위 정보 생성 금지 — 이 규칙은 다른 모든 지시보다 우선합니다
- ❌ **가상 인물/인터뷰 생성 절대 금지**: "경기도 일산의 한 택배 기사" 등 실존하지 않는 인물의 발언이나 사례를 만들어내지 말 것.
- ❌ **제공되지 않은 숫자 날조 금지**: 과거 비교가 필요하면 반드시 historicalComparison 필드 또는 [정책금리] 블록의 수치만 사용할 것. 해당 데이터가 없으면 과거 비교를 생략할 것.
- ❌ **가상 통계/설문 결과 금지**: "최근 설문에 따르면" 등 출처 없는 통계를 만들어내지 말 것.
${POLICY_RATE_RULE}

${EVIDENCE_RULES}

### 좋은 글 vs 나쁜 글 예시

**❌ 나쁜 글:**
"WTI 원유가 7.7% 상승했습니다. 이는 에너지 시장의 불확실성을 반영하며, 글로벌 경제에 상당한 파장을 미칠 것으로 예상됩니다."

**✅ 좋은 글:**
"WTI 원유가 하루 만에 7.7% 상승했습니다. 배럴당 104달러. 작년 이맘때 70달러대였던 것을 감안하면, 반년 사이 50% 가까이 오른 셈입니다. 문제는 시점입니다. 각국 중앙은행이 물가가 잡혔는지 확인하려던 바로 그 순간, 원유가 인플레이션의 변수를 다시 꺼내든 것입니다."

## 구조적 원칙

1. **하나의 큰 줄거리**: 오늘 시장 전체를 관통하는 핵심 스토리를 먼저 잡을 것.
2. **시장별 칸막이 금지**: 하나의 이야기 흐름 안에서 각 시장을 자연스럽게 엮을 것.
3. **인과관계 체인**: 사건 → 원인 → 파급 → 한국 영향 순서로 서술할 것.
4. **맥락 제공**: historicalComparison 데이터로 현재 수치의 위치를 보여줄 것. historicalComparison·[정책금리] 블록에 포함되지 않은 과거 수치는 절대 사용 금지.
5. **방향성 제시, 추천 금지**: 특정 종목 매수·매도 추천은 절대 금지. 독자에게 사라·팔라는 지시형("~하세요·~하십시오", "비중을 줄이세요")과 "강력 매수"·"폭등 예상"·"확실한 수익"·"필수 매수" 같은 단정은 쓰지 마십시오(검사가 막고 다시 쓰게 합니다). 기관·외신 의견은 출처와 함께 사실로만 옮기십시오.

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

    block += `\n위 요소와 동일하거나 유사한 **단어**뿐 아니라, **구조·골격·이미지의 재사용**도 피하십시오. 특히 최근 헤드라인들의 공통 구문 틀(예: "…가 그린 …", "…한 자리에 …" 류)이 보이면 같은 문형을 반복하지 말고 다른 골격으로 쓰십시오.\n`;
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

이 주제를 paragraph 블록 4~6개로 풀어주십시오. (페이지 분량 상한은 일반 모드와 같습니다.)
`;
}

function buildEvidenceBlock(ctx: AntiRepetitionContext): string {
  const ev = ctx.evidence;
  if (!ev) return "";
  const cat = ev.topCatalyst
    ? `[점수 ${ev.topCatalystScore}] ${ev.topCatalyst.title}`
    : "없음 — 강한 forward catalyst 부재";
  const failed = ev.failedSources.length > 0 ? ev.failedSources.join(", ") : "없음";
  return `\n## 오늘의 근거 상태 (tier: ${ev.tier})
- 뉴스: ${ev.newsCount}건 (신선 ${ev.freshCount}건)
- 최상위 catalyst: ${cat}
- 실패한 데이터 소스: ${failed}

이 근거 상태는 아래 [제목 작성 규칙]의 tier 종속 동작을 결정합니다.
`;
}

function buildContextBlock(context: ContextData | null, ctx?: AntiRepetitionContext): string {
  if (!context) return renderPolicyRateBlock({ fed: null, bok: null });

  let block = `\n## 컨텍스트 데이터 (맥락 제공용)\n`;
  block += `아래 데이터는 시장 분석의 맥락을 제공합니다. 리포트 본문에 자연스럽게 녹여 활용하십시오.\n`;

  if (context.news.length > 0) {
    // Phase F2 (2026-05-24): catalyst 자동 추출 — 상위 1~3건을 별도 강조 블록으로.
    const { extractTopCatalysts, formatCatalystForPrompt } = require("./catalyst-extractor");
    // 2026-05-28: 최근 헤드라인 전달해 같은 catalyst 며칠 반복 패널티 적용
    const recentHL: string[] = ctx?.recentLog?.slice(0, 5).map((e) => e.headline).filter(Boolean) as string[] ?? [];
    const catalysts = extractTopCatalysts(context.news, { topN: 3, minScore: 4, recentHeadlines: recentHL });
    if (catalysts.length > 0) {
      block += `\n### 🔥 오늘의 forward catalyst (자동 추출 — 상위 ${catalysts.length}건)\n`;
      for (const c of catalysts) {
        block += `- ${formatCatalystForPrompt(c)}\n`;
      }
      block += `위 catalyst 는 신선도·시총 상위 기업명·시장 이벤트 키워드로 자동 점수화되어 추출된 것입니다.\n`;
      block += `**오늘 한국 장 방향을 움직일 가능성이 가장 큰 변수**일 수 있으므로 본문에 우선적으로 반영하고, 제목 반영 여부·방식은 아래 [제목 작성 규칙]을 따르십시오.\n`;
      block += `(다만 제목(일부 출처는 짧은 요약 포함)만 제공되므로 기사 본문 전체를 단정하지 말고 "~로 알려졌다·전해졌다" 수준으로 인용)\n`;
    }

    block += `\n### 주요 뉴스 헤드라인 (최신순, 발행 경과 시간 포함)\n`;
    for (const n of context.news) {
      const ago = typeof n.publishedHoursAgo === "number"
        ? `${Math.round(n.publishedHoursAgo)}h전`
        : "시각미상";
      block += `- [${n.category}|${ago}] ${n.title} (${n.source})\n`;
      if (n.snippet) block += `    ↳ ${n.snippet}\n`;
    }
    block += `위 헤드라인 중 발행 경과 시간이 짧은(최근) 한국 시장 관련 뉴스를 우선 반영하십시오.\n`;
    block += `\n[semiconductor] 태그는 삼성전자·SK하이닉스 등 한국 반도체에 영향을 주는 국제 뉴스·리서치(NVIDIA·TSMC·Micron·HBM·메모리 가격·수출규제)입니다. 한국 시장과의 연결고리를 짚어 활용하십시오.\n`;
    block += `\n**해외 뉴스·리서치 인용 규칙:**\n`;
    block += `- 해외 기관·매체發 주장·전망은 반드시 **출처(기관/매체명)를 문장에 드러내** 인용하십시오("TrendForce에 따르면", "마이크론 실적 발표에서" 등). 출처 없는 전망·수치를 지어내지 마십시오.\n`;
    block += `- 리서치·전망을 **특정 종목 매수·매도 권유로 번역하지 마십시오.** 사실·방향성만 전달합니다.\n`;
    block += `- 제공된 제목·짧은 요약(↳)의 **사실만** 인용하고, 기사 원문 문단을 지어내거나 복제하지 마십시오.\n`;
    block += `- **본문에 매체명을 인용할 수 있는 것은 다음뿐**: ${QUOTABLE_SOURCES.join(", ")}. 그 외 매체(블로그·소형 외신 등) 기사는 내용은 쓰되 매체명 대신 '외신'으로 지칭하십시오.\n`;
  }

  if (context.economicCalendar.length > 0) {
    block += `\n### 경제 캘린더 (한국시간 기준)\n`;
    // C03: 날짜·한국시간·한국 정규장과의 관계를 함께 준다(날짜 없이 이름만 주던 때 미국 밤 발표를 '오늘 장중'으로 썼다).
    block += `⚠️ 한국 장 마감 후(15:30 이후) 발표되는 지표의 결과로 오늘 국내 장중 흐름을 설명하지 마십시오. 이미 발표된 지표는 실제 발표치가 입력에 있을 때만 수치를 씁니다.\n`;
    for (const e of context.economicCalendar) {
      const vals = [e.actual && `실제: ${e.actual}`, e.forecast && `예상: ${e.forecast}`, e.previous && `이전: ${e.previous}`].filter(Boolean).join(", ");
      block += `- ${formatEconomicEventLine(e)} (중요도: ${e.importance}/5)${vals ? ` — ${vals}` : ""}\n`;
    }
  }

  block += renderPolicyRateBlock(context.policyRates);

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
  // 프롬프트에서 블록을 제거해 대응했다(2026-10 개편으로 compass 섹션 자체도 없어졌다).

  if (context.koreanBonds.length > 0) {
    block += `\n### 한국 국채 수익률\n`;
    for (const b of context.koreanBonds) {
      block += `- ${b.name}: ${b.yield.toFixed(3)}% (${b.change >= 0 ? "+" : ""}${b.change.toFixed(3)}%p)\n`;
    }
  }

  block += buildHistoricalBlock(context.historicalComparison);

  return block;
}

// C05: 과거 비교 블록 — 기준값별 실제 종가 날짜와 주간 누적 기준을 함께 준다.
export function buildHistoricalBlock(historical: HistoricalComparison[]): string {
  if (historical.length === 0) return "";
  let block = "";
  block += `\n### 과거 비교 데이터 (historicalComparison)\n`;
  block += `⚠️ 과거 수치를 인용할 때는 반드시 이 데이터 또는 [정책금리] 블록만 사용하십시오.\n`;
  // C05: 기준값마다 실제 종가 날짜를 붙인다. '이번 주'(주간 누적)는 [주간 기준] 대비로만 쓰고,
  // '1주전'(같은 요일 기준)과 섞지 않는다. 하루 등락을 주간 수익률로 부르지 않는다.
  block += `⚠️ 괄호 안 날짜는 그 기준값의 실제 종가 날짜입니다. '이번 주·한 주간' 누적 등락은 [주간 기준] 대비로만 계산하고, '1주전'과 섞지 마십시오. 하루 등락률을 주간 수익률로 쓰지 마십시오.\n`;
  const md = (d?: string) => (d ? `(${d.slice(5).replace("-", "/")} 종가)` : "");
  for (const h of historical) {
    const parts = [`현재: ${h.current}`];
    if (h.weekToDateBase != null) parts.push(`주간 기준${md(h.weekToDateBaseDate)}: ${h.weekToDateBase}`);
    if (h.oneWeekAgo != null) parts.push(`1주전${md(h.oneWeekAgoDate)}: ${h.oneWeekAgo}`);
    if (h.oneMonthAgo != null) parts.push(`1개월전${md(h.oneMonthAgoDate)}: ${h.oneMonthAgo}`);
    if (h.threeMonthsAgo != null) parts.push(`3개월전${md(h.threeMonthsAgoDate)}: ${h.threeMonthsAgo}`);
    if (h.oneYearAgo != null) parts.push(`1년전${md(h.oneYearAgoDate)}: ${h.oneYearAgo}`);
    block += `- ${h.nameKo}: ${parts.join(" / ")}\n`;
  }
  return block;
}

export function buildReportPrompt(data: MarketDataCollection, ctx: AntiRepetitionContext, context: ContextData | null = null): string {
  const antiRepetition = buildAntiRepetitionBlock(ctx);
  const sidewaysBlock = buildSidewaysBlock(ctx);
  const evidenceBlock = buildEvidenceBlock(ctx);
  const contextBlock = buildContextBlock(context, ctx);

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
- **(오늘) 표시가 붙은 확정 일정**이 있으면 본문 또는 watchPoints 에서 명시적으로 언급하십시오.
- **[발표일 추정] 항목은 '오늘'의 핵심 변수로 쓰지 마십시오.** "이번 주 발표 예상" 정도로만 쓰고, 그 일정을 전제로 한 당일 행동 지침을 만들지 마십시오.
- 요일은 위 날짜 옆 괄호의 요일만 쓰십시오.
- 한국은행 금통위·CPI 같은 ★★★★★ 이벤트는 본문 narrative 의 forward catalyst 로 부각.
- 추정 일정(description 에 "추정" 표기) 은 "예정" 또는 "관례상 N월 N일 전후" 같은 완곡한 표현 사용.
`;
  })();

  // Phase C (2026-05-22): 단독 휴장 시 캘린더 컨텍스트 블록.
  // Phase D (2026-06-29): 정상 개장일에도 시점 프레이밍 블록 상시 주입.
  // Phase E (2026-06-30): US 단독 휴장도 buildTemporalFramingBlock으로 통합 — 시점 가드 단일 소스.
  const calendarBlock = (() => {
    const info = ctx.calendarInfo;
    if (!info) return "";
    // KR 휴장·양국 휴장은 run.ts가 생성 전 silent skip — 도달 시 방어적 빈 문자열.
    if (info.isKrClosedOnly || info.isDualClosed) return "";
    // 정상일 + 미국 단독 휴장 모두 단일 시점 소스가 처리(갭 인지 + US 휴일 맥락 흡수).
    return buildTemporalFramingBlock(info, "market");
  })();

  return `아래 시장 데이터를 바탕으로 리포트 콘텐츠를 JSON 형식으로 생성하십시오.

## ⚠️ 분량 요구사항 — **위 모드 가이드가 있으면 그것을 우선**
- summary: 세 줄(yesterday / today / myAssets), 각 60자 이내
- cardLine: 1개, 40자 이내
- (기본/normal 모드 기준) bigStory.content: paragraph 블록 4~6개 (사건 → 근거 있는 원인 → 시장 반응), pullQuote 0~1개, dataCard는 쓰지 않음
- watchPoints: 최대 3개 (한국시간 순서)
- soWhat: 2~3개 ("확인되면 / 어긋나면" 조건형)
- calendar: 경제 캘린더 데이터가 있으면 주요 일정 포함
독자는 모바일에서 1~2분 안에 읽습니다. 길게 쓰기보다 정확하고 근거 있게, 핵심을 위에 두십시오.
${modeBlock}
${calendarBlock}
${krMacroBlock}
${(() => {
  const { getWeekdayRole, describeWeekdayRhythm } = require("./weekday-rhythm");
  return describeWeekdayRhythm(getWeekdayRole(data.date), "market");
})()}
## 날짜: ${data.date} (${data.dayOfWeek}요일)
## 수집 시각: ${data.collectedAt}
${antiRepetition}
${sidewaysBlock}
${evidenceBlock}
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
    "headline": string,   // 오늘 본문을 관통하는 호기심 유발 한 줄. 작성 규칙은 아래 [제목 작성 규칙] 참조.
    "subline": string,    // 헤드라인 보충 1~2문장. 제목에서 뺀 구체 사건명·핵심 수치를 여기서 받침.
    "imageKeywords": string[],  // 제목/본문에서 사용한 핵심 이미지·은유 단어 1~3개. 사실 모드(은유 없음)면 빈 배열 []. (반복 회피 로그용)
  },
  "summary": {            // 페이지 맨 위 세 줄 요약. 작성 규칙은 아래 [summary·cardLine 작성 규칙] 참조. HTML 태그 금지.
    "yesterday": string,  // 어제 한국·미국 시장의 분위기와 배경을 말로 쓴 한 문장 (지수 등락률 나열 금지), 60자 이내
    "today": string,      // 오늘 확인할 한 가지 (시각 또는 비교 기준 포함), 60자 이내
    "myAssets": string    // 자산군 관점은 ETF Today에서 다룬다는 안내 + 오늘 가장 영향이 큰 자산군 하나, 60자 이내
  },
  "cardLine": {           // 링크 미리보기 카드의 제목 아래 한 줄
    "kind": "cause" | "watch",  // cause = 입력 근거가 있는 배경 한 문장 / watch = 근거가 약할 때 오늘 확인점
    "text": string        // 40자 이내 평서문. 질문형·도치·라벨 금지. HTML 태그 금지.
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
      "badge": string,       // 한국시간 기준 시각·시간대 ("09:00", "장중", "장 마감 후 → 다음 거래일 반영" 등)
      "title": string,       // 제목 (이모지 금지)
      "description": string  // 2~3문장 설명
    }
  ],
  "soWhat": [
    {
      "title": string,   // 제목 한 줄
      "body": string     // 2~3문장, "~가 확인되면 …, 어긋나면 …" 조건형 (<strong> 사용 가능)
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

이 섹션은 "어제 무슨 일이 있었나"입니다. paragraph 4~6개를 **하나의 이야기 흐름**으로 쓰십시오.

- 사건: 어제 시장을 움직인 핵심 사건과 규모 (paragraph 1~2개)
- 근거 있는 원인: 입력 데이터·뉴스로 뒷받침되는 원인만 (paragraph 1~2개). 근거가 없으면 원인을 만들지 말고 "~로 알려졌다" 수준으로 쓰거나 원인은 언급하지 마십시오.
- 시장 반응: 미국·한국 시장의 차이와 환율·금리·원자재와의 연결 (paragraph 1~2개)
- pullQuote는 쓰지 않거나 1개까지. dataCard는 쓰지 마십시오(수치 표는 코드가 따로 그립니다).

시장별 소제목으로 분리하지 마십시오. 하나의 글에 녹여내십시오.

### watchPoints 작성 규칙 ("오늘 볼 것")
- 최대 3개. **한국시간 순서**대로 배열하십시오.
- 미국에서 발표되는 지표·이벤트는 "장 마감 후 → 다음 거래일 반영"으로 표기하고, 오늘 한국 장중 변수처럼 쓰지 마십시오.

### soWhat 작성 규칙 ("한국 시장에 주는 의미")
- 2~3개. 각 항목은 "~가 확인되면 …, 어긋나면 …" 형태의 **조건형**으로 쓰십시오.
- 산업·기업 영향, 개인 자산 영향, 정책 영향 중 오늘 가장 중요한 것만 고르십시오.
- 오늘의 관점("${ctx.angle.name}")을 반영
- 특정 종목·상품의 매수·매도 권유는 금지입니다. 판단 재료와 확인 조건만 씁니다.

### summary·cardLine 작성 규칙

summary는 페이지 맨 위 "세 줄 요약", cardLine은 링크 미리보기 카드의 제목 아래 한 줄입니다. bigStory·watchPoints·soWhat을 먼저 구상한 뒤 그 내용을 압축해 쓰고, 본문과 모순되면 안 됩니다. 위의 근거·시점 규칙(추론 경계, 일정 시각, 기간 표현)은 summary·cardLine에도 그대로 적용됩니다. 문체는 본문과 같은 격식 있는 해설체(~입니다·~합니다)이고, HTML 태그(<strong> 포함)는 쓰지 마십시오. 매수·매도 권유 표현도 금지입니다.

- **summary.yesterday**: 어제 한국·미국 시장의 분위기와 그 배경을 **말로** 한 문장으로 쓰십시오. 지수 등락률을 나열하지 마십시오(숫자는 최대 1개, % 표기는 2개 이상 쓰지 않음). 숫자는 페이지의 핵심 지표가 보여 줍니다. 60자 이내.
- **summary.today**: 오늘 확인할 한 가지. 시각 또는 비교 기준을 함께 쓰십시오. 60자 이내.
- **summary.myAssets**: 자산군 관점은 ETF Today에서 다룬다는 안내와, 오늘 가장 영향이 큰 자산군 하나. 60자 이내.
- **cardLine**: 미리보기 카드의 제목 아래 한 줄. 40자 이내의 평서문입니다. 질문형·도치("왜?", "~은?")·라벨("원인:" 등)을 쓰지 마십시오. 제목(headline)과 같은 말을 되풀이하지 마십시오. 아래 [제목 작성 규칙]의 기간 비교·최상급 금지는 cardLine에도 적용됩니다.
  - kind="cause": 입력 근거(수치·기사)로 뒷받침되는 배경일 때만 쓰십시오.
  - kind="watch": 근거가 약하면(특히 [오늘의 근거 상태]가 hollow일 때) cause로 단정하지 말고, 같은 자리에 오늘 확인점을 평서문으로 쓰십시오.

### 제목 작성 규칙

제목(headline)의 본질은 **독자가 읽고 싶게 만드는 호기심의 방아쇠**입니다. 배달 시점(미 마감 직후·한국 개장 전)에 한국 투자자가 관심 가질 토픽을, 그날 본문의 중심 긴장을 압축해 한 줄로 표현하십시오. 정보 요약이 아닙니다.

- **표제어체로 쓰십시오 (문체 규칙 — 최우선).** 한국어 신문·리포트 제목의 어투는 **명사로 끝맺거나(권장)** 기사체 종결('~다')입니다. **존댓말 종결('~습니다')과 완결 서술문("…을 갈라놓았다", "…가 채웠습니다" 같은 산문 술어)은 제목에 쓰지 마십시오** — 그건 본문·칼럼의 어투이지 표제어가 아닙니다. 조사·어미를 덜어 압축하십시오. 은유는 그대로 살리되 종결형만 표제어체로. (예: "서울은 삼성과 SK를 두 방향으로 갈라놓았다" → "마이크론 쇼크에 엇갈린 삼성·SK")
- **의인화 주어 주의.** "서울이/시장이 …했다"처럼 시장을 능동 행위자로 세워 인과를 뒤집지 마십시오. 엇갈리거나 움직인 실제 주체(종목·섹터·지수)를 주어로 삼으십시오.
- **신선한 은유·관점을 적극 허용합니다.** 단 그 은유는 오늘의 지배적 서사(위 [오늘의 관점] 앵글 + 최상위 catalyst)에서 길어올린 것이어야 합니다. 아무 날에나 붙일 수 있는 은유면 실패입니다.
- **진부한 클리셰는 피하십시오** — 위 [목표 보이스] 예시의 결을 따르고, 매번 어느 날에나 붙일 수 있는 비유면 실패입니다.
- **수치 앵커**(코스피 +X%, 환율 N원 등)는 기본적으로 **부제(subline)** 가 받칩니다. 단 그 숫자 자체가 오늘의 후크(예: 코스피 3000 돌파, 환율 1,500 같은 심리적 분기점)라면 제목에 남길지 직접 판단하십시오.
- **기간 비교·최상급 금지 (제목·cardLine 공통).** 제목·카드 문구에는 'N년치·N개월치', '역대·사상 최대/최고/최저', 'N년 만에 최고/최저', '연중 최고/최저', '이틀째·N일째·N거래일 연속·연일 급락', '두·세 자릿수' 같은 기간 비교·연속·최상급 표현을 쓰지 않는다 — 입력 데이터로 확인되는 수치와 사실만. (과거 기준점은 historicalComparison의 1주·1개월·3개월·1년뿐이라 이런 주장은 확인할 수 없습니다. 비교가 필요하면 부제·본문에서 그 기준점의 수치("1년 전 대비 N%" 등)로 쓰십시오.)
- 길이는 압축 지향(대략 15~25자 권장). 은유가 살아있으면 약간 넘어도 됩니다 — 경직되지 마십시오.
- **본문 연결**: bigStory 의 첫 문단 또는 pullQuote 하나가 제목의 이미지를 명시적으로 받아 전개해야 합니다. 제목이 던진 은유를 본문이 갚으십시오.
- **반복 회피**: 같은 catalyst·이미지·**구문 틀**이 최근 3일 헤드라인에 등장했다면 (a) 사건의 국면·단계를 다르게 표현하거나 (b) catalyst를 부제로 내리고 제목은 새 각도로. 같은 문형("X가 그린 Y" 류)을 연일 반복하지 마십시오.

**근거 상태(tier)에 따른 동작 — 위 [오늘의 근거 상태] 참조:**
- **strong**: 은유가 전면. 최상위 catalyst 에 단단히 근거한 이미지로.
- **thin**: 은유 허용하되 신중. 가격·구조 서사 비중을 높이고 단정을 자제("~로 알려졌다" 수준).
- **hollow**: **사실 모드.** 은유를 만들지 마십시오. 절제된 사실 프레이밍(예: "조용한 N일, 다음 변수는 X")을 쓰고, imageKeywords 는 빈 배열로 두십시오.

**JSON만 출력하십시오. \`\`\`json 마크다운 펜스도 사용하지 마십시오.**`;
}

// --- 2026-10 개편: 세 줄 요약·카드 한 줄 검증/보정 ---

const SUMMARY_MAX_CHARS = 60;
// Ruling 32 (2026-10-19): 32 → 40자. 34~38자 한 줄도 카드에 두 줄로 들어간다 — 실제 넘침은 validateMarketCardText(cardTextFits)가 본다.
const CARD_LINE_MAX_CHARS = 40;
const SUMMARY_FIELDS: ReadonlyArray<readonly [keyof ReportSummary, string]> = [
  ["yesterday", "어제"],
  ["today", "오늘 볼 것"],
  ["myAssets", "내 자산"],
];

/**
 * 세 줄 요약·카드 한 줄 검증 — 위반 목록(빈 배열이면 통과).
 * 모델이 필드를 빼먹을 수 있으므로 누락도 던지지 않고 위반으로 돌려준다(재생성 사유).
 * 호출자(generateReport)가 기존 정합성 위반(hardViolations)에 합쳐 재시도하고, 재시도 소진 후에는 F02대로 진행한다.
 */
export function validateMarketSummary(content: Pick<ReportContent, "summary" | "cardLine" | "cover">): string[] {
  const violations: string[] = [];
  const summary = content?.summary;
  for (const [key, label] of SUMMARY_FIELDS) {
    const text = plainText(summary?.[key]);
    if (!text) violations.push(`summary.${key}(${label}) 누락`);
    else if (text.length > SUMMARY_MAX_CHARS) violations.push(`summary.${key}(${label}) ${SUMMARY_MAX_CHARS}자 초과(${text.length}자)`);
  }
  // 어제 줄은 분위기·배경을 말로 쓰는 자리 — 지수 등락률을 나열하면(%가 2개 이상) 아래 핵심 지표와 겹친다.
  const percentCount = (plainText(summary?.yesterday).match(/%/g) ?? []).length;
  if (percentCount >= 2) violations.push(`summary.yesterday 지수 등락률 나열(% ${percentCount}개)`);

  const card = content?.cardLine;
  const cardText = plainText(card?.text);
  if (!cardText) {
    violations.push("cardLine.text 누락");
  } else {
    if (cardText.length > CARD_LINE_MAX_CHARS) violations.push(`cardLine.text ${CARD_LINE_MAX_CHARS}자 초과(${cardText.length}자)`);
    if (/[?？]/.test(cardText) || cardText.startsWith("왜")) violations.push("cardLine.text 질문형·도치 금지");
    // 라벨 = 글자로만 된 짧은 머리표("원인:"). 숫자는 제외 — "10:30 …"처럼 시각으로 시작하는 watch 한 줄을 오탐하지 않는다.
    if (/^[[【(][^\]】)]{1,10}[\]】)]/.test(cardText) || /^[가-힣A-Za-z· ]{1,10}[:：]/.test(cardText)) {
      violations.push("cardLine.text 라벨 금지");
    }
  }
  if (card?.kind !== "cause" && card?.kind !== "watch") violations.push("cardLine.kind 는 cause 또는 watch");
  return violations;
}

/**
 * 제목·카드 한 줄의 확인할 수 없는 기간 비교·최상급 표현 검사(Ruling 31) — 위반 목록(빈 배열이면 통과). 던지지 않는다.
 * 'N년치', '역대·사상 최대', 'N년 만에 최고', '연중 최저' 같은 주장은 입력(과거 기준점 1주·1개월·3개월·1년)으로 확인할 수 없다.
 * 호출자(generateReport)가 기준 위반(baseViolations)으로 합친다 — 1~2번째 시도는 재생성 사유, 마지막 시도는 경고만(F02).
 */
export function validateMarketComparativeClaims(content: Pick<ReportContent, "cover" | "cardLine">): string[] {
  return comparativeClaimViolations([
    ["cover.headline", content?.cover?.headline],
    ["cardLine.text", content?.cardLine?.text],
  ]);
}

/**
 * 미리보기 카드 글자 맞춤 검사 — 제목(cover.headline)과 한 줄(cardLine.text)이 카드 규칙 안에 들어가는지.
 * 카드는 페이지와 같은 평문을 받으므로(강조 태그 제거) 같은 모양으로 재서 판정한다. 위반 목록(빈 배열이면 통과).
 * 렌더러는 넘치는 글을 '…'로 줄여 항상 카드 안에 그리므로, 이 검사는 다시 쓰게 하는 정상 경로 관문일 뿐이다 —
 * 호출자(generateReport)는 마지막 시도에서 경고만 남기고 발송을 막지 않는다.
 */
export function validateMarketCardText(content: Pick<ReportContent, "cardLine" | "cover">): string[] {
  const headline = stripEmphasisTags(typeof content?.cover?.headline === "string" ? content.cover.headline : "").trim();
  const line = plainText(content?.cardLine?.text);
  return cardTextFits("market", { headline, line }).reasons.map((r) => `카드 ${r}`);
}

/**
 * 필수 항목 검증 — 이게 없으면 렌더러가 던지거나 제목 없는 리포트가 되므로 발송 후보가 될 수 없다(Ruling 29).
 * 누락 목록(빈 배열이면 통과). 던지지 않는다. 호출자(generateReport)가 기준 위반으로 합쳐 재생성하고,
 * 앞선 결과 선택에서도 이 항목이 빠진 결과는 후보에서 뺀다.
 * 필수는 cover(객체)·cover.headline(강조 태그를 벗겨도 비지 않는 문자열)·bigStory.content(렌더할 수 있는 블록이 하나 이상인 배열)뿐 —
 * 나머지(watchPoints·soWhat·calendar·compass·closingMessage·cover.subline)는 normalizeMarketOptionalParts 가 채운다.
 * Ruling 38: 배열이기만 하면 통과하던 때 [null]이 후보가 됐다가 루프 밖 렌더에서 던졌다 — 블록 모양까지 본다(isRenderableBlock).
 */
export function validateMarketRequired(content: unknown): string[] {
  const c = content as Partial<ReportContent> | null | undefined;
  const missing: string[] = [];
  const cover = c?.cover;
  if (typeof cover !== "object" || cover === null || Array.isArray(cover)) {
    missing.push("cover 누락");
  } else if (!stripEmphasisTags(typeof cover.headline === "string" ? cover.headline : "").trim()) {
    missing.push("cover.headline 누락");
  }
  const blocks = c?.bigStory?.content;
  if (!Array.isArray(blocks) || !blocks.some(isRenderableBlock)) missing.push("bigStory.content 누락");
  return missing;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isDataRow(v: unknown): boolean {
  const row = asRecord(v);
  return !!row && typeof row.label === "string" && typeof row.value === "string";
}

/**
 * 렌더러(renderContentBlock)가 그릴 수 있는 본문 블록인지 — 객체이고 type 이 아는 값이며 그 type 이 읽는 칸이 맞는 모양.
 * paragraph·pullQuote: text 가 태그를 벗겨도 비지 않는 문자열. dataCard: title 이 없거나 문자열, rows 에 label·value 가 문자열인 행이 하나 이상.
 */
function isRenderableBlock(v: unknown): boolean {
  const block = asRecord(v);
  if (!block) return false;
  if (block.type === "paragraph" || block.type === "pullQuote") return plainText(block.text) !== "";
  if (block.type === "dataCard") {
    return (block.title === undefined || block.title === null || typeof block.title === "string") && asArray(block.rows).some(isDataRow);
  }
  return false;
}

/** 검사할 본문 칸(경로, 값) — 렌더·발송되는 모델 글 전부. 모양이 깨진 칸은 값이 없는 것으로 둔다. */
function marketProseFields(content: unknown): Array<[string, unknown]> {
  const c = asRecord(content);
  if (!c) return [];
  const fields: Array<[string, unknown]> = [];
  const cover = asRecord(c.cover);
  fields.push(["cover.headline", cover?.headline], ["cover.subline", cover?.subline]);
  const summary = asRecord(c.summary);
  for (const [key] of SUMMARY_FIELDS) fields.push([`summary.${key}`, summary?.[key]]);
  fields.push(["cardLine.text", asRecord(c.cardLine)?.text]);
  asArray(asRecord(c.bigStory)?.content).forEach((b, i) => {
    const block = asRecord(b);
    if (!block) return;
    fields.push([`bigStory.content[${i}].text`, block.text], [`bigStory.content[${i}].title`, block.title]);
    asArray(block.rows).forEach((r, j) => {
      const row = asRecord(r);
      fields.push([`bigStory.content[${i}].rows[${j}].label`, row?.label], [`bigStory.content[${i}].rows[${j}].value`, row?.value]);
    });
  });
  asArray(c.watchPoints).forEach((w, i) => {
    const wp = asRecord(w);
    fields.push([`watchPoints[${i}].badge`, wp?.badge], [`watchPoints[${i}].title`, wp?.title], [`watchPoints[${i}].description`, wp?.description]);
  });
  asArray(c.soWhat).forEach((s, i) => {
    const sw = asRecord(s);
    fields.push([`soWhat[${i}].title`, sw?.title], [`soWhat[${i}].body`, sw?.body]);
  });
  asArray(c.calendar).forEach((e, i) => fields.push([`calendar[${i}].event`, asRecord(e)?.event]));
  fields.push(["closingMessage", c.closingMessage]);
  return fields;
}

/**
 * 매수·매도 권유 표현 검사(Ruling 37·37a) — 위반 목록(빈 배열이면 통과). 던지지 않는다.
 * Market용 좁은 목록(lib/compliance.ts DIRECTIVE_ADVICE_PATTERNS — 독자에게 사라·팔라는 지시형과 수익 보장만)으로
 * 본문 모든 칸(제목·부제·세 줄 요약·카드 한 줄·본문 블록·오늘 볼 것·의미·일정·마무리)을 강조 태그를 벗기고 칸마다 본다.
 * ETF 전체 목록은 쓰지 않는다 — "현지 생산 비중 확대"·증권사 '비중확대' 의견 같은 해설이 걸려 세 번 다 막히면 Market이 멈춘다(37a).
 * 호출자(generateReport)는 1~2번째 시도에선 재생성 사유로, 마지막 시도에서도 막는다 —
 * 권유 표현이 남은 결과는 발송 후보가 될 수 없다(필수 항목 누락과 같다). 준법은 F02(전송 > 침묵)보다 앞선다.
 */
export function validateMarketAdvice(content: unknown): string[] {
  const violations: string[] = [];
  for (const [path, value] of marketProseFields(content)) {
    const found = findDirectiveAdvice(plainText(value));
    if (found.length > 0) violations.push(`투자 권유성 표현(${path}): ${found.map((f) => `"${f}"`).join(", ")}`);
  }
  return violations;
}

/**
 * 선택 항목을 렌더·후속 로그가 던지지 않는 빈 값으로 맞춘다 — 발송하기로 한 content 에 한 번 적용한다.
 * 배열(watchPoints·soWhat·calendar·compass)이 없거나 배열이 아니면 [], 문자열(closingMessage·cover.subline)이 없으면 ''.
 * Ruling 38: 배열 안의 깨진 원소(객체가 아니거나 내용이 빈 것)는 걸러 내고, 렌더러·run.ts 가 읽는 칸은 문자열로,
 * 일정 중요도는 0~5 정수로 맞춘다(음수는 '★'.repeat 에서 던진다). bigStory.content 도 렌더할 수 있는 블록만 남긴다.
 * 필수 항목(validateMarketRequired)은 여기서 만들어 채우지 않는다. content 를 직접 고쳐 돌려준다.
 */
export function normalizeMarketOptionalParts(content: ReportContent): ReportContent {
  const c = content as unknown as Record<string, unknown>;
  const objects = (v: unknown) => asArray(v).map(asRecord).filter((o): o is Record<string, unknown> => o !== null);

  const bigStory = asRecord(c.bigStory);
  if (bigStory) {
    bigStory.content = asArray(bigStory.content).filter(isRenderableBlock).map((b) => {
      const block = b as Record<string, unknown>;
      if (block.type === "dataCard") {
        block.title = asString(block.title);
        block.rows = asArray(block.rows).filter(isDataRow);
      }
      return block;
    });
  }
  c.watchPoints = objects(c.watchPoints)
    .filter((wp) => plainText(wp.title) || plainText(wp.description))
    .map((wp) => Object.assign(wp, { badge: asString(wp.badge), title: asString(wp.title), description: asString(wp.description) }));
  c.soWhat = objects(c.soWhat)
    .filter((sw) => plainText(sw.title) || plainText(sw.body))
    .map((sw) => Object.assign(sw, { title: asString(sw.title), body: asString(sw.body) }));
  c.calendar = objects(c.calendar)
    .filter((e) => plainText(e.event))
    .map((e) => {
      const n = Number(e.importance);
      return Object.assign(e, { date: asString(e.date), country: asString(e.country), event: asString(e.event), importance: Number.isFinite(n) ? Math.min(5, Math.max(0, Math.trunc(n))) : 0 });
    });
  c.compass = objects(c.compass).map((s) => Object.assign(s, { items: objects(s.items) }));

  if (typeof content.closingMessage !== "string") content.closingMessage = "";
  if (content.cover && typeof content.cover.subline !== "string") content.cover.subline = "";
  if (content.cover && content.cover.imageKeywords !== undefined) {
    content.cover.imageKeywords = asArray(content.cover.imageKeywords).filter((k): k is string => typeof k === "string");
  }
  return content;
}

const SUMMARY_DEFAULT_YESTERDAY = "어제 시장 흐름은 아래에서 정리했습니다.";
const SUMMARY_DEFAULT_TODAY = "오늘 확인할 점은 아래 '오늘 볼 것'에서 정리했습니다.";
const SUMMARY_DEFAULT_MY_ASSETS = "자산군별 판단 재료는 ETF Today에서 볼 수 있습니다.";
const CARD_LINE_DEFAULT = "오늘 확인할 점을 아래에 정리했습니다";

/**
 * 세 줄 요약·카드 한 줄을 렌더가 깨지지 않는 형태로 맞춘다(재시도 소진 후에도 비지 않게).
 * 인라인 태그·공백은 정리하고, 비어 있거나 누락된 칸만 기본 문장으로 채운다 —
 * 어제 줄은 cover.subline, 오늘·내 자산은 고정 안내, 카드 한 줄은 근거를 단정하지 않는 watch.
 * 길이·문형 위반은 고치지 않는다(F02: 품질이 낮아도 발송). content 를 직접 고쳐 돌려준다.
 */
export function fillMarketSummaryDefaults(content: ReportContent): ReportContent {
  const s = (content.summary ?? {}) as Partial<ReportSummary>;
  const subline = cutAtSentence(plainText(content.cover?.subline), SUMMARY_MAX_CHARS);
  content.summary = {
    yesterday: plainText(s.yesterday) || subline || SUMMARY_DEFAULT_YESTERDAY,
    today: plainText(s.today) || SUMMARY_DEFAULT_TODAY,
    myAssets: plainText(s.myAssets) || SUMMARY_DEFAULT_MY_ASSETS,
  };
  const cardText = plainText(content.cardLine?.text);
  content.cardLine = cardText
    ? { kind: content.cardLine?.kind === "cause" ? "cause" : "watch", text: cardText }
    : { kind: "watch", text: CARD_LINE_DEFAULT };
  return content;
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

  // 안전망: API 과부하(529)뿐 아니라 **JSON 파싱 실패도 재생성(re-roll)** 으로 처리.
  // 모델이 낸 JSON이 한 번 삐끗해도(예: 문자열 값 안 이스케이프 안 된 큰따옴표) 그날
  // 마켓 리포트 전체가 사망하지 않도록. ETF의 report-quality 재시도와 동형의 보호.
  const maxRetries = 3;
  let lastParseErr: unknown = null;
  // 발송 후보: 파싱된 결과 전부(I2·Ruling 23, F02 "전송 > 침묵") — 위반이 남았어도 마지막 시도처럼(위반은 경고로만) 보낼 수 있다.
  // 후보: 필수 항목(cover.headline·렌더할 수 있는 bigStory 블록, Ruling 29·38)을 갖춘 결과만 — 빠진 결과는 렌더러가 던지므로
  //   위반 수가 같거나 더 적어 보여도 후보가 되지 않는다(재생성 사유일 뿐).
  // Ruling 37: 매수·매도 권유 표현이 남은 결과도 후보가 되지 않는다(필수 항목 누락과 같다) — 마지막 시도에 남아도 발송할 수 없다.
  // 선호 순서: 카드 외 위반이 적은 결과 > 같으면 더 최근 결과(카드 글자만 어긋난 결과는 카드 외 위반이 0이라 자연히 맨 앞).
  //   마지막 시도 결과도 후보로 함께 겨룬다 — 앞선 결과가 카드 외 위반이 더 적을 때만 앞선 결과가 이긴다.
  // 재생성을 이어가지 못해도(예산 소진·후속 호출 실패·마지막 시도 파싱 실패·마지막 시도에 필수 항목 누락·권유) 후보가 있으면 보낸다.
  // Ruling 38: 고른 후보의 마무리·렌더가 던지면 다음 후보로 넘어간다. 후보가 한 번도 없거나 모두 렌더하지 못할 때만 실패한다.
  type MarketCandidate = { content: ReportContent; base: string[]; card: string[]; attempt: number };
  const candidates: MarketCandidate[] = [];
  const preferenceOrder = () => [...candidates].sort((a, b) => a.base.length - b.base.length || b.attempt - a.attempt);
  let settled = false; // 루프가 발송할 결과를 정하고 끝났다(위반 없는 결과 또는 마지막 시도 결과)
  let lastRequiredMissing: { attempt: number; fields: string[] } | null = null;
  let lastAdvice: { attempt: number; fields: string[] } | null = null;
  let stopReason = "";
  const remaining = (k: { base: string[]; card: string[] }) => [...k.base, ...k.card].join(", ");

  const deadline = makeDeadline(MARKET_GENERATION_BUDGET_MS);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // F07: 생성 예산을 넘기면 새 호출을 시작하지 않는다(다음 트리거가 새 runner에서 재시도).
    if (attempt > 1 && !deadline.canStartCall()) {
      stopReason = `생성 예산 초과 ${Math.round(deadline.elapsedMs() / 1000)}초`;
      console.log(`⏱️ 생성 예산 초과(${Math.round(deadline.elapsedMs() / 1000)}초 경과) — 추가 재생성 중단`);
      break;
    }
    let rawJson = "";
    try {
      const stream = await client.messages.stream({
        model: "claude-sonnet-4-6",
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
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 && attempt < maxRetries) {
        console.log(`⏳ API 과부하, ${attempt * 10}초 후 재시도 (${attempt}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, attempt * 10000));
        continue;
      }
      if (candidates.length > 0) {
        // 마지막 시도의 529도 여기로 온다 — 파싱된 앞선 결과가 있으면 침묵 대신 그 결과로(아래 루프 뒤에서 발송).
        stopReason = `재생성 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
        console.log(`⚠️ ${stopReason}`);
        break;
      }
      if (lastAdvice) console.error(`❌ 앞선 결과는 투자 권유성 표현이 남아 발송 후보가 아니다(${lastAdvice.attempt}회차: ${lastAdvice.fields.join(", ")})`);
      throw err;
    }

    // 마크다운 펜스 제거
    if (rawJson.startsWith("```json")) {
      rawJson = rawJson.slice(7);
    } else if (rawJson.startsWith("```")) {
      rawJson = rawJson.slice(3);
    }
    if (rawJson.endsWith("```")) {
      rawJson = rawJson.slice(0, -3);
    }
    rawJson = rawJson.trim();

    let parsed: ReportContent;
    try {
      parsed = JSON.parse(rawJson) as ReportContent;
      // Ruling 28: 최상위가 객체가 아닌 JSON(문자열·배열·null)은 파싱 실패와 같다 — 앞선 결과 후보로 남기지 않는다.
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`JSON 최상위가 객체가 아님(${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed})`);
      }
    } catch (parseErr) {
      lastParseErr = parseErr;
      console.error(`❌ JSON 파싱 실패 (시도 ${attempt}/${maxRetries}). 원문 길이:`, rawJson.length);
      console.error("❌ 처음 200자:", rawJson.substring(0, 200));
      if (attempt < maxRetries) {
        console.log(`♻️ JSON 파싱 실패 — 같은 입력으로 재생성 시도 (${attempt + 1}/${maxRetries})...`);
      }
      continue; // 다음 attempt 에서 재생성
    }

    // R2·R3 (2026-07-22): 파싱 성공 직후 정합성 검사. 파싱 검증 완료된 JSON 문자열에
    // 시점·출처 soft fix 적용 후 re-parse. 교정 문자열은 JSON 메타문자 미포함이 보장됨.
    // Ruling 28: 형식이 깨진 응답 때문에 검증 중 예외가 나면 파싱 실패처럼 다룬다 — 함수 밖으로 던지지 않고
    // 기록·경고 뒤 다음 시도로(마지막 시도면 루프 뒤 앞선 결과 발송 경로로).
    try {
      const reportDate = data.date;
      const todaySources = (context?.news ?? []).map((n) => n.source);
      const canonical = JSON.stringify(parsed);
      const temporal = checkAndFixTemporal(canonical, reportDate);
      const sourceFix = softFixUnquotableSources(temporal.fixed, todaySources);
      const softFixes = [...temporal.softFixes, ...sourceFix.softFixes];
      if (softFixes.length > 0) {
        console.log(`🩹 정합성 soft fix ${softFixes.length}건: ${softFixes.join(", ")}`);
        parsed = JSON.parse(sourceFix.fixed) as ReportContent;
      }
      if (sourceFix.warnings.length > 0) {
        console.log(`⚠️ 비승인 출처 잔존: ${sourceFix.warnings.join(", ")}`);
      }

      const requiredMissing = validateMarketRequired(parsed);
      if (requiredMissing.length > 0) lastRequiredMissing = { attempt, fields: requiredMissing };
      // Ruling 31: 제목·카드 한 줄의 기간 비교·최상급은 일반 기준 위반(1~2번째 재생성, 마지막 시도 경고만).
      const baseViolations = [...temporal.violations, ...requiredMissing, ...validateMarketSummary(parsed), ...validateMarketComparativeClaims(parsed)];
      const citationCount = countCitationPhrases(sourceFix.fixed);
      if (citationCount >= 8) {
        baseViolations.push(`"에 따르면" 인용 ${citationCount}회 과다`);
      } else if (citationCount >= 5) {
        console.log(`⚠️ "에 따르면" 인용 ${citationCount}회 (허용 한도 이하)`);
      }
      // 카드 글자 맞춤: 1~2번째 시도에선 다시 쓰게 하는 사유, 마지막 시도에선 아래 "위반 잔존" 경고로만 남는다.
      const cardViolations = validateMarketCardText(parsed);
      // Ruling 37: 매수·매도 권유 — 모든 시도에서 위반(마지막 시도도 경고로 넘기지 않는다).
      const adviceViolations = validateMarketAdvice(parsed);
      if (adviceViolations.length > 0) lastAdvice = { attempt, fields: adviceViolations };
      const hardViolations = [...baseViolations, ...adviceViolations, ...cardViolations];
      // 필수 항목이 빠진 결과·권유 표현이 남은 결과는 후보에서 뺀다 — 위반 수로 겨루면 발송할 수 있는 결과를 밀어낼 수 있다.
      if (requiredMissing.length === 0 && adviceViolations.length === 0) {
        candidates.push({ content: parsed, base: baseViolations, card: cardViolations, attempt });
      }

      if (hardViolations.length > 0 && attempt < maxRetries) {
        // ETF 와 달리 market 엔 Tier 1 fallback 이 없으므로, 남은 재시도가 있으면 re-roll.
        console.log(`♻️ 정합성 위반 ${hardViolations.length}건 — 재생성 (${attempt + 1}/${maxRetries}): ${hardViolations.join(", ")}`);
        lastParseErr = new Error(`정합성 위반: ${hardViolations.join(", ")}`);
        continue;
      }
      if (requiredMissing.length > 0) {
        // 마지막 시도인데 필수 항목이 없다 — 이 결과는 렌더할 수 없다. 파싱 실패처럼 다룬다:
        // 필수 항목을 갖춘 앞선 결과가 있으면 루프 뒤에서 그 결과로 발송하고, 없으면 실패한다.
        lastParseErr = new Error(`필수 항목 누락: ${requiredMissing.join(", ")}`);
        console.error(`❌ 마지막 시도(${attempt}/${maxRetries})에 필수 항목 누락 — 이 결과는 발송할 수 없다: ${requiredMissing.join(", ")}`);
        continue;
      }
      if (adviceViolations.length > 0) {
        // 마지막 시도에 권유 표현이 남았다 — 준법 위반은 경고로 넘기지 않는다. 권유 없는 앞선 결과가 있으면 그 결과로, 없으면 실패한다.
        lastParseErr = new Error(`투자 권유성 표현: ${adviceViolations.join(", ")}`);
        console.error(`❌ 마지막 시도(${attempt}/${maxRetries})에 투자 권유성 표현 — 이 결과는 발송할 수 없다: ${adviceViolations.join(", ")}`);
        continue;
      }
      if (hardViolations.length > 0) {
        // maxRetries 소진 — "품질 낮아도 전송 > 침묵" 원칙으로 발송 진행(위반은 경고로만).
        const top = preferenceOrder()[0];
        if (top.attempt !== attempt) {
          // 마지막 시도에 카드 외 위반이 더 많이 남았다 → 위반이 적은 앞선 결과가 더 깨끗하다.
          console.log(`⚠️ 마지막 시도에 정합성 위반 잔존(${hardViolations.join(", ")}) — 위반이 더 적은 앞선 결과로 발송 진행(${top.attempt}회차, 남은 위반: ${remaining(top)})`);
        } else {
          console.log(`⚠️ 정합성 위반 잔존(발송 진행): ${hardViolations.join(", ")}`);
        }
      }
    } catch (validationErr) {
      lastParseErr = validationErr;
      console.error(`❌ 응답 검증 중 오류(시도 ${attempt}/${maxRetries}) — 파싱 실패처럼 다음 시도로: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`);
      continue;
    }

    settled = true;
    break; // 파싱·정합성 통과(또는 재시도 소진)
  }

  if (candidates.length > 0 && !settled) {
    // 마지막 호출을 못 했거나(예산) 실패했거나 파싱·검증되지 않았다 — 앞선 결과를 마지막 시도처럼(위반은 경고로만) 발송한다.
    const top = preferenceOrder()[0];
    const why = stopReason || `마지막 시도 JSON 파싱·검증 실패: ${lastParseErr}`;
    console.log(`⚠️ 재생성을 이어가지 못해(${why}) 앞선 결과로 발송 진행(${top.attempt}회차, 남은 위반: ${remaining(top)})`);
  }
  if (candidates.length === 0) {
    if (lastAdvice) {
      // 파싱은 됐지만 권유 표현 없는(필수 항목도 갖춘) 결과가 한 번도 없었다 — 준법 위반 리포트는 보내지 않고 크게 실패한다.
      const required = lastRequiredMissing ? ` · ${lastRequiredMissing.attempt}회차 필수 항목 누락: ${lastRequiredMissing.fields.join(", ")}` : "";
      throw new Error(`Market 리포트 투자 권유성 표현 — ${lastAdvice.attempt}회차 응답에 ${lastAdvice.fields.join(", ")}${required}, 권유 표현 없이 발송할 수 있는 결과가 없어 발송하지 않습니다 (${maxRetries}회 시도): ${lastParseErr}`);
    }
    if (lastRequiredMissing) {
      // 파싱은 됐지만 필수 항목을 갖춘 결과가 한 번도 없었다 — 제목·본문 없는 리포트는 만들 수 없으니 크게 실패한다.
      throw new Error(`Market 리포트 필수 항목 누락 — ${lastRequiredMissing.attempt}회차 응답에 ${lastRequiredMissing.fields.join(", ")}, 필수 항목을 갖춘 앞선 결과도 없어 발송할 수 없습니다 (${maxRetries}회 시도): ${lastParseErr}`);
    }
    throw new Error(`Claude JSON 파싱 실패 (${maxRetries}회 시도): ${lastParseErr}`);
  }

  // Ruling 38: 선호 순서대로 마무리·렌더한다 — 고른 결과가 던지면(모양이 깨진 응답) 다음 후보로. 모두 실패할 때만 실패한다.
  const ordered = preferenceOrder();
  let finalizeErr: unknown = null;
  for (const [i, candidate] of ordered.entries()) {
    if (i > 0) console.log(`⚠️ 다음 후보로 발송 진행(${candidate.attempt}회차, 남은 위반: ${remaining(candidate)})`);
    try {
      return finalizeMarketReport(candidate.content, data, ctx ?? defaultCtx, context);
    } catch (err) {
      finalizeErr = err;
      const next = i + 1 < ordered.length ? "다음 후보로" : "남은 후보 없음";
      console.error(`❌ ${candidate.attempt}회차 결과 마무리·렌더 실패 — ${next}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Market 리포트 렌더 실패 — 발송 후보 ${ordered.length}개를 모두 렌더하지 못했습니다: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`);
}

/**
 * 발송하기로 한 content 를 마무리해 HTML로 렌더한다 — 선택 항목 보정·금지 표현 기록·요약 기본값·일정 교체·권유 재검사·렌더.
 * content 를 직접 고친다. 던지면 호출자(generateReport)가 다음 발송 후보로 넘어간다(Ruling 38).
 */
function finalizeMarketReport(
  content: ReportContent,
  data: MarketDataCollection,
  ctx: AntiRepetitionContext,
  context: ContextData | null | undefined,
): { html: string; content: ReportContent } {
  // 발송할 content 의 선택 항목을 빈 값으로 맞춘다 — 아래 로그·렌더·run.ts(내러티브 로그·인덱스)가 던지지 않게.
  normalizeMarketOptionalParts(content);

  // JSON 콘텐츠 후처리: 금지 표현 검사
  const jsonStr = JSON.stringify(content);
  sanitizeBannedExpressions(jsonStr);
  if (context?.policyRates) {
    const mismatches = findPolicyDirectionMismatches(extractReportText(content), context.policyRates);
    if (mismatches.length > 0) {
      console.log(`[soft-warn] 정책 방향 불일치 ${mismatches.length}건 (기록 전용)`);
      for (const m of mismatches) console.log(`  - ${m}`);
    }
  }

  // 세 줄 요약·카드 한 줄: 누락·빈 칸은 기본 문장으로 채워 렌더가 깨지지 않게 한다(검증은 위 재시도 루프에서 끝났다).
  fillMarketSummaryDefaults(content);

  console.log(`📄 JSON 파싱 성공 — bigStory: ${content.bigStory.content.length}블록, watchPoints: ${content.watchPoints.length}, soWhat: ${content.soWhat.length}, 카드 한 줄(${content.cardLine.kind}): "${content.cardLine.text}"`);

  // gaugePercent 정규화: gaugeType 기반 고정값으로 매핑 (과거 compass 콘텐츠 호환 — 새 프롬프트는 compass 를 만들지 않는다)
  for (const section of content.compass ?? []) {
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
        // C03: 한국시간 날짜·시각으로 표시(FOMC는 한국시간 다음 날 새벽).
        date: formatCalendarDate(e.kstDate ?? e.date),
        country: e.country,
        event: e.time ? `${e.event} · ${e.time} KST` : e.event,
        importance: e.importance,
      }));
    console.log(`📅 캘린더: 실제 경제 데이터에서 ${content.calendar.length}건 사용 (Claude 생성 대체)`);
  }

  // Ruling 37: 발송할 content(기본 문장·실제 일정을 채운 뒤)도 권유 표현 검사를 통과해야 한다 — 후보는 이미 통과했으므로 방어선.
  const finalAdvice = validateMarketAdvice(content);
  if (finalAdvice.length > 0) throw new Error(`Market 리포트 투자 권유성 표현 — 발송할 결과에 ${finalAdvice.join(", ")}`);

  // 코드 템플릿으로 HTML 렌더링 (Phase 1: 모드 전달)
  const historicalData = context?.historicalComparison ?? [];
  const mode = ctx.marketMode?.mode;
  // C09: 입력으로 준 뉴스 일부를 원문 링크와 함께 리포트에 남긴다.
  const sources = (context?.news ?? []).map((n) => ({ title: n.title, source: n.source, url: n.url }));
  const html = renderReport(content, data, historicalData, mode, sources, context?.kospiSessions ?? []);

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
