import Anthropic from "@anthropic-ai/sdk";
import type {
  MarketDataCollection,
  NarrativeAngle,
  NarrativeLogEntry,
  SidewaysAnalysis,
} from "./types";

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
4. **맥락 제공**: 항상 과거 비교(1주 전, 1개월 전, 1년 전)로 현재 수치의 위치를 보여줄 것.
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

function buildReportPrompt(data: MarketDataCollection, ctx: AntiRepetitionContext): string {
  const antiRepetition = buildAntiRepetitionBlock(ctx);
  const sidewaysBlock = buildSidewaysBlock(ctx);

  return `아래 시장 데이터를 바탕으로 웹진 스타일의 리포트 HTML을 생성하십시오.

## ⚠️ 분량 요구사항 — 매우 중요
**생성할 HTML 파일의 총 분량은 최소 30,000자(공백 포함) 이상이어야 합니다.**
본문 텍스트(태그 제외)만 최소 3,000자 이상이어야 합니다. 짧게 쓰지 마십시오.
특히 "오늘의 시장 이야기" 섹션은 최소 2,000자 이상 작성하십시오.
충분한 분석, 충분한 맥락, 충분한 데이터 비교를 포함하십시오.

## 날짜: ${data.date} (${data.dayOfWeek}요일)
## 수집 시각: ${data.collectedAt}
${antiRepetition}
${sidewaysBlock}
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
- **메인 컬러**: #00C2A7 (민트/틸)
- **보조 컬러 1**: #82D94B (그린)
- **보조 컬러 2**: #666666 (그레이)
- **배경**: 라이트 #F5F7FA, 다크 #0D1117
- **카드**: 라이트 #FFFFFF, 다크 #161B22
- **본문**: 라이트 #24292F, 다크 #C9D1D9
- **상승**: #E54545, **하락**: #4589E5 (한국 관례 유지)
- **폰트**: -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif
- **본문**: 16px, line-height 1.8
- **최대 너비**: 640px, 다크모드 필수 지원 (@media prefers-color-scheme: dark)

### 리포트 구조 — 5개 섹션

#### 1. 커버
- **배경**: linear-gradient(135deg, #00C2A7 0%, #82D94B 100%) — 민트→그린 그라데이션
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
- 상승 시: rgba(229, 69, 69, 농도) — 농도는 변동률에 비례 (0.3% → 0.05, 1% → 0.15, 3% → 0.3, 5%+ → 0.5)
- 하락 시: rgba(69, 137, 229, 농도) — 동일 비례
- 변동률 텍스트 색상도 상승 #E54545 / 하락 #4589E5
- 변동률이 거의 0인 항목: 배경 투명, 텍스트 #666666

**레이아웃:**
- **PC**: 2열 그리드 (grid-template-columns: repeat(2, 1fr))
- **모바일 (max-width: 640px)**: 수평 스크롤 캐러셀
  - display: flex, overflow-x: auto, scroll-snap-type: x mandatory
  - 각 카드: min-width: 200px, scroll-snap-align: start
  - 스크롤바 숨김: -webkit-scrollbar { display: none }
  - 좌우로 넘기면 다음 카드가 보이는 구조
- 각 카드: 지표명(14px, #666), 수치(24px, bold), 변동률(14px, 상승/하락 색상)
- 이 섹션은 데이터 중심. 서술 최소화.

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

#### 4. 그래서, 무엇이 달라지나 (So What) — 최소 4~5개 포인트
**현재 영향 + 앞으로 주목할 것**을 하나의 섹션으로 통합합니다.

- **최소 4~5가지** 포인트를 카드 형태로 정리
- 각 포인트는 제목(한 줄) + 본문(3~4문장)으로 구성
- 각 포인트는 **구체적 영향 경로**를 설명할 것 (트리비얼 금지)
- 반드시 다양한 영역을 커버할 것: 산업/기업 영향, 개인 자산 영향, 정책/제도 영향, 앞으로의 일정/이벤트 등
- 오늘의 관점("${ctx.angle.name}")을 이 섹션에 반영하십시오

#### 5. 클로징 + 푸터
- iM AI Analyst의 마무리 한 문장 (절제된 톤, 따뜻하지만 가볍지 않게)
- 면책: "본 리포트는 AI가 자동 생성한 것으로, 투자 권유가 아닙니다. 투자 판단의 책임은 투자자 본인에게 있습니다."
- "© iM뱅크 | Powered by iM AI Analyst | 데이터 출처: Yahoo Finance"

### 스타일 세부
- 섹션 간 여백: 48~60px
- 카드: border-radius 12~16px, box-shadow 0 2px 8px rgba(0,0,0,0.06)
- 섹션 타이틀: color #00C2A7, 하단 accent bar도 #00C2A7
- pull quote: border-left 4px **#00C2A7**, 큰 폰트, 이탤릭, 배경 rgba(0,194,167,0.05)
- data-card 보더: rgba(0,194,167,0.2)
- 구분선(divider): linear-gradient(90deg, transparent, #00C2A7, transparent)
- So What 카드: 보더 rgba(0,194,167,0.15), 제목 색상 #00C2A7
- 변동률 ±2% 이상: bold + 히트맵 배경 강조
- 클로징 구분선: #00C2A7
- 링크/강조 텍스트: #00C2A7
- viewport meta, charset utf-8 필수
- **모바일 반응형 필수:**
  - 커버: full-width (border-radius: 0, margin: 0 -20px, width: calc(100% + 40px))
  - pull-quote: 풀블리드 (좌우 여백 제거)
  - 본문 폰트: 16px 유지
  - 헤드라인: 24px로 축소
- null 데이터: 해당 문맥에서 자연스럽게 "확인이 어렵습니다"로 처리

**HTML 코드만 출력하십시오. <!DOCTYPE html>로 시작하는 순수 HTML만 반환하십시오.**`;
}

export async function generateReport(
  data: MarketDataCollection,
  ctx?: AntiRepetitionContext
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
        max_tokens: 32000,
        messages: [
          {
            role: "user",
            content: buildReportPrompt(data, defaultCtx),
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

  console.log(`✅ 리포트 생성 완료 (${html.length} bytes)`);
  return html;
}
