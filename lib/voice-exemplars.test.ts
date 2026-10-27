import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderVoiceExemplars, pickHeadlineExemplars, renderHeadlineExemplars,
  MARKET_HEADLINE_POOL, ETF_HEADLINE_POOL, HEADLINE_EXEMPLARS_PER_DAY, type HeadlineStyle,
} from "./voice-exemplars";
import { headlineForm, type HeadlineForm } from "./headline-editorial";
import { comparativeClaimViolations } from "./comparative-claims";
import { findHardAdvice, findSoftAdvice } from "./compliance";

const STYLES: HeadlineStyle[] = ["단문 사실형", "원인형", "배경·동시형", "대비형", "수치 강조형", "명사형 종결", "예고형", "말줄임 이음", "쉼표 두 토막"];

test("목표 보이스 블록: 원칙·본문 예시·표현 반례만 — 제목 예시는 사용자 프롬프트의 순환 예시로 옮겼다", () => {
  const block = renderVoiceExemplars();
  assert.match(block, /진부한 비유와 반복되는 구문 틀은 피하라/);
  assert.match(block, /그린 \[지도/);
  assert.ok(block.includes("괴리율 확대가 체결 비용을 조용히 갉아먹습니다"));
  assert.match(block, /\[제목 편집 기준\]/);
  assert.ok(!block.includes("### 지향할 헤드라인 결"));
  assert.ok(!block.includes("금리 올린 연준, 달러만 웃었다"));
  assert.ok(!block.includes("특히 **제목은 한국 신문 편집자가 쓰듯"));
  const etf = renderVoiceExemplars("etf");
  assert.ok(!etf.includes("원화, 하루 만에 20원 되찾다"));
  assert.ok(etf.includes("한 주를 닫다"));          // ETF 표현 반례 유지
  assert.ok(!etf.includes("데이터피드형 제목"));     // market 형태 반례는 ETF에 없음(기존 결정)
});

test("예시 풀: 기존 예시를 모두 담는다(ETF는 2026-09-30 사용자가 고른 6개)", () => {
  const etf = ETF_HEADLINE_POOL.map((e) => e.text);
  for (const t of ["원화, 하루 만에 20원 되찾다", "금 급락·반도체 하락, 방어 우위 국면 진입", "삼성·SK, 45조 베팅…AI 메모리 전쟁 본격화",
    "반도체 직격, 방어주가 버텼다", "미 국채 5% 벽, 원화가 먼저 무너졌다", "무디스 성장률 3.5% 상향, 반도체가 국내 주도"]) assert.ok(etf.includes(t), t);
  const market = MARKET_HEADLINE_POOL.map((e) => e.text);
  for (const t of ["금리 올린 연준, 달러만 웃었다", "반도체 빈자리, 통신·금융이 메웠다", "SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다",
    "삼성·SK, 코스피 급락에도 충청 392조 투자"]) assert.ok(market.includes(t), t);
});

test("예시 풀: 항목 모양·다양성·정확성 검사와의 정합", () => {
  for (const pool of [MARKET_HEADLINE_POOL, ETF_HEADLINE_POOL]) {
    assert.ok(pool.length >= 18);
    assert.equal(new Set(pool.map((e) => e.text)).size, pool.length, "중복 예시");
    assert.ok(new Set(pool.map((e) => headlineForm(e.text))).size >= 3, "형태 3종 이상");
    assert.ok(new Set(pool.map((e) => e.style)).size >= 7, "문형 7종 이상");
    for (const e of pool) {
      assert.ok(STYLES.includes(e.style), e.text);
      assert.ok(e.note.length > 0, e.text);
      // 반례 형태('~사이'·'~한 날/밤')는 예시에 넣지 않는다
      assert.ok(!["A하는 사이 B", "~한 날/밤"].includes(headlineForm(e.text)), e.text);
      // 예시가 검사에 걸리는 표현을 가르치지 않는다
      assert.deepEqual(comparativeClaimViolations([["예시", e.text]]), [], e.text);
      assert.deepEqual([...findHardAdvice(e.text), ...findSoftAdvice(e.text)], [], e.text);
    }
  }
});

test("pickHeadlineExemplars: 날마다 4개, 문형이 모두 다르고, 같은 날짜·같은 최근 제목이면 같은 결과", () => {
  const recent = ["코스피 3.7% 하락, 금통위 주목", "나스닥 1.9% 하락", "삼성전자 실적, 코스피 혼조", "환율 1,400원, 외국인 매도"];
  const a = pickHeadlineExemplars("market", recent, "2026-11-02");
  assert.equal(a.length, HEADLINE_EXEMPLARS_PER_DAY);
  assert.equal(new Set(a.map((e) => e.style)).size, a.length);
  assert.deepEqual(pickHeadlineExemplars("market", recent, "2026-11-02"), a);
  // 직전 형태(쉼표)와 우세 형태(쉼표 3건)는 빠진다
  for (const e of a) assert.notEqual(headlineForm(e.text), "쉼표 두 토막", e.text);
  // 다른 날짜는 (대개) 다른 조합 — 열흘 중 적어도 두 가지 조합
  const combos = new Set(["03", "04", "05", "06", "09", "10", "11", "12", "13", "16"].map((d) => pickHeadlineExemplars("market", recent, `2026-11-${d}`).map((e) => e.text).join("|")));
  assert.ok(combos.size >= 2);
});

test("pickHeadlineExemplars: 남는 예시의 문형이 4종보다 적으면 '우세' 제외부터 푼다", () => {
  // 직전=단문, 우세=쉼표 → 둘을 빼면 말줄임·예고형 두 문형뿐이라 우세(쉼표) 제외를 풀고 단문만 뺀다
  const recent = ["국내 반도체 ETF 급락", "A, B", "C, D", "E, F"];
  const etf = pickHeadlineExemplars("etf", recent, "2026-11-02");
  assert.equal(etf.length, 4);
  assert.equal(new Set(etf.map((e) => e.style)).size, 4);
  for (const e of etf) assert.notEqual(headlineForm(e.text), "단문", e.text);
  // 최근 제목이 없으면 제외 없이 4개
  assert.equal(pickHeadlineExemplars("etf", [], "2026-11-02").length, 4);
});

// 형태별 대표 제목 — (직전, 우세) 조합을 만들어 내는 입력. headlineForm이 기대한 형태로 분류하는지도 함께 본다.
const FORM_SAMPLES: Array<[HeadlineForm, string]> = [
  ["단문", "국내 반도체 ETF 급락"],
  ["쉼표 두 토막", "A 하락, B 강세"],
  ["말줄임 이음(…)", "A 하락…B 강세"],
  ["예고형(답한다·변수·시험대·숙제)", "다음 변수는 금통위"],
];

test("pickHeadlineExemplars: 어떤 (직전, 우세) 조합·날짜에서도 4개가 서로 다른 문형이고, 직전 형태는 가능한 한 빠진다", () => {
  for (const [form, sample] of FORM_SAMPLES) assert.equal(headlineForm(sample), form, sample);
  const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-12-01"];
  for (const target of ["market", "etf"] as const) {
    const pool = target === "etf" ? ETF_HEADLINE_POOL : MARKET_HEADLINE_POOL;
    const stylesWithout = (...excluded: HeadlineForm[]) =>
      new Set(pool.filter((e) => !excluded.includes(headlineForm(e.text))).map((e) => e.style)).size;
    // 풀에 나오는 형태로 (직전, 우세) 쌍을 모두 만든다. 우세 없음(null)과 최근 제목 없음도 포함.
    const cases: Array<{ recent: string[]; previous: HeadlineForm | null; dominant: HeadlineForm | null }> = [
      { recent: [], previous: null, dominant: null },
    ];
    for (const [previous, prevSample] of FORM_SAMPLES) {
      cases.push({ recent: [prevSample], previous, dominant: null });
      for (const [dominant, domSample] of FORM_SAMPLES) {
        // 직전 1건 + 우세 3건. 같은 형태면 4건이 모두 같은 형태다.
        cases.push({ recent: [prevSample, domSample, domSample, domSample], previous, dominant });
      }
    }
    for (const { recent, previous, dominant } of cases) {
      const label = `${target} 직전=${previous} 우세=${dominant}`;
      for (const date of dates) {
        const picked = pickHeadlineExemplars(target, recent, date);
        assert.equal(picked.length, HEADLINE_EXEMPLARS_PER_DAY, `${label} ${date}`);
        assert.equal(new Set(picked.map((e) => e.style)).size, HEADLINE_EXEMPLARS_PER_DAY, `${label} ${date} 문형 중복`);
        // 직전 형태를 빼도 문형이 4종 이상 남으면 직전 형태는 반드시 빠진다
        if (previous && stylesWithout(previous) >= HEADLINE_EXEMPLARS_PER_DAY) {
          for (const e of picked) assert.notEqual(headlineForm(e.text), previous, `${label} ${date} ${e.text}`);
        }
        // 직전·우세를 모두 빼도 문형이 4종 이상 남으면 우세 형태도 빠진다
        if (previous && dominant && stylesWithout(previous, dominant) >= HEADLINE_EXEMPLARS_PER_DAY) {
          for (const e of picked) assert.notEqual(headlineForm(e.text), dominant, `${label} ${date} ${e.text}`);
        }
      }
    }
    // 두 번째 완화(직전 제외까지 풀기)는 현재 풀에서 도달하지 않는다 — 어떤 한 형태를 빼도 문형이 4종 이상 남는다.
    for (const [form] of FORM_SAMPLES) assert.ok(stylesWithout(form) >= HEADLINE_EXEMPLARS_PER_DAY, `${target} ${form}`);
  }
});

test("renderHeadlineExemplars: 머리 줄과 예시·문형·노트", () => {
  const picked = pickHeadlineExemplars("etf", [], "2026-11-02");
  const block = renderHeadlineExemplars(picked);
  assert.match(block, /^\[오늘 참고할 제목 예시/);
  for (const e of picked) assert.ok(block.includes(`"${e.text}" (${e.style}) — ${e.note}`));
});
