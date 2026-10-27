import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  headlineForm, headlineScore, headlineCodeMetrics, recentFormStats, takeRecentHeadlines, cleanHeadline,
  HEADLINE_JUDGE_SYSTEM, renderHeadlineStandard, renderRecentHeadlineLines, NATURALNESS_PAIRS,
} from "./headline-editorial";

const fixture = JSON.parse(fs.readFileSync("lib/__fixtures__/headline-baseline-2026-10-27.json", "utf8")) as { ETF: string[]; Market: string[] };
const baseline = JSON.parse(fs.readFileSync("docs/quality/headline-baseline-2026-10-27.json", "utf8"));

test("코드 지표는 2026-10-27 기준선 수치를 그대로 재현한다(분류기·계산이 바뀌면 기준선과 비교할 수 없다)", () => {
  assert.deepEqual(headlineCodeMetrics(fixture.ETF), baseline.metrics.ETF);
  assert.deepEqual(headlineCodeMetrics(fixture.Market), baseline.metrics.Market);
});

test("headlineForm: 기준선 분류 순서 — 사이 > 날/밤 > 예고 > 말줄임 > 쉼표 > 단문", () => {
  assert.equal(headlineForm("방산 5% 밀린 사이, 미 반도체가 달렸다"), "A하는 사이 B");
  assert.equal(headlineForm("코스피 3.65% 급락, 반도체 ETF 4~6% 밀린 날"), "~한 날/밤");
  assert.equal(headlineForm("국내 반도체 4%대 급등, 한은 금리 동결이 변수다"), "예고형(답한다·변수·시험대·숙제)");
  assert.equal(headlineForm("SK하이닉스 ADR 상장 임박…삼성과 엇갈렸다"), "말줄임 이음(…)");
  assert.equal(headlineForm("반도체 직격, 방어주가 버텼다"), "쉼표 두 토막");
  assert.equal(headlineForm("미 수출규제 우려 속 2차전지·반도체 ETF 동반 급락"), "단문");
});

test("recentFormStats: 직전 제목의 형태와 최근 3번 이상 쓴 형태(최신순 입력)", () => {
  const s = recentFormStats(["A, B", "C, D", "E 급락", "F, G", "H…I"]);
  assert.equal(s.previous, "쉼표 두 토막");
  assert.equal(s.dominant, "쉼표 두 토막");
  assert.equal(s.counts.get("쉼표 두 토막"), 3);
  assert.equal(recentFormStats(["E 급락", "A, B"]).dominant, null);
  assert.equal(recentFormStats([]).previous, null);
});

test("headlineScore: 직전과 같은 형태 -2, 우세 형태 -1, 같은 끝 어절 -1, 어휘 겹침 0.3 이상 -1 — 결정적", () => {
  const recent = [
    "방산 5% 밀린 사이, 미 반도체가 달렸다", // 직전: 사이형
    "2차전지 4% 하락, 원유·채권은 강세",
    "국내 반도체 급등, 방어주는 약세",
    "금 급락, 은도 약세",                     // 쉼표 3건 = 우세
  ];
  assert.deepEqual(headlineScore("미 바이오 ETF 4% 상승", recent), { score: 0, reasons: [] });
  const b = headlineScore("국내 2차전지 급락, 금은 약세", recent);
  assert.equal(b.score, -3); // 우세 형태 -1, 끝 어절 '약세' -1, '금 급락, 은도 약세'와 겹침 0.33 -1
  assert.equal(b.reasons.length, 3);
  const c = headlineScore("미 반도체 강세 사이, 방산은 밀렸다", recent);
  assert.equal(c.score, -2);
  assert.match(c.reasons[0], /직전 제목과 같은 형태/);
  assert.deepEqual(headlineScore("국내 2차전지 급락, 금은 약세", recent), b);
});

test("takeRecentHeadlines·cleanHeadline: 태그를 벗기고 빈 값을 빼고 앞 n건만", () => {
  assert.equal(cleanHeadline("<strong>코스피</strong>  급락"), "코스피 급락");
  assert.equal(cleanHeadline(null), "");
  assert.deepEqual(takeRecentHeadlines(["<strong>A</strong>, B", "", null, "C", "D", "E", "F", "G"]), ["A, B", "C", "D", "E", "F"]);
  assert.deepEqual(takeRecentHeadlines(["A", "B", "C"], 2), ["A", "B"]);
});

test("평가 기준(측정용 시스템 문구)은 기준선을 잰 문구와 글자 하나까지 같다", () => {
  assert.equal(HEADLINE_JUDGE_SYSTEM, `당신은 한국 종합경제지(한국경제·매일경제·연합뉴스 경제부) 증권면 데스크입니다. 매일 아침 개인 투자자용 시황 리포트 제목을 검토합니다.
기준:
- 자연스러움(1~5): 한국어 화자가 증권 기사 제목으로 읽을 때 자연스러운가. 감점 요인 — 영어 직역투(rally를 '달렸다'로 옮긴 듯한 표현), 대상 없는 어색한 의인화('채권이 받쳤다'처럼 무엇을 받쳤는지 없는 경우), 어울리지 않는 낱말 짝(연어), 과장. 한국 경제 기사에서 통용되는 관용적 은유(숨 고르기·훈풍·찬물·발목·급제동·떠받치다(지수를) 등)가 자연스럽게 쓰였으면 감점하지 않는다. 은유 자체는 나쁘지 않다.
- 명확성(1~5): 주식 경험이 조금 있는 개인 투자자가 무엇이 어느 방향으로 얼마나 움직였는지 한 번에 아는가.
- causalAssertion(true/false): 제목이 확인하기 어려운 인과(A가 B를 눌렀다·끌어올렸다 등)를 단정하는가.
- issues: 어색하거나 문제가 있는 표현만. type은 "직역투" | "어색한 의인화" | "어울리지 않는 연어" | "과장" | "근거 없는 인과 단정" | "상투적 틀" | "모호함" | "기타" 중 하나. phrase는 문제 구절, why는 한 문장 이유, suggestion은 같은 사실을 자연스럽게 쓴 대안 제목.
문제가 없으면 issues는 빈 배열. 결과는 report 도구로 낸다.`);
});

test("renderHeadlineStandard: 우선순위 넷·자연스러움 쌍·인과 기준·형태 목록·후보 세 개", () => {
  const s = renderHeadlineStandard();
  assert.match(s, /^\[제목 편집 기준 — Market·ETF 공통\]/);
  assert.ok(s.indexOf("1. 명확성") < s.indexOf("2. 자연스러운 한국어"));
  assert.ok(s.indexOf("2. 자연스러운 한국어") < s.indexOf("3. 인과는 입력에 근거가 있을 때만"));
  assert.ok(s.indexOf("3. 인과는") < s.indexOf("4. 변주"));
  for (const [a, b] of NATURALNESS_PAIRS) assert.ok(s.includes(`"${a}" → "${b}"`));
  assert.match(s, /strong — .*\/ thin — .*\/ hollow — /);
  assert.match(s, /cover\.headlineCandidates에 제목 후보 세 개/);
  assert.ok(!s.includes("[제목 작성 규칙]")); // 두 프롬프트의 블록 이름과 겹치지 않게
});

test("renderRecentHeadlineLines: 최신순 제목에 형태를 붙이고 피할 형태를 알린다", () => {
  assert.equal(renderRecentHeadlineLines([]), "");
  const block = renderRecentHeadlineLines(["A, B", "C, D", "E, F", "G 급락"]);
  const lines = block.split("\n");
  assert.equal(lines[0], "- A, B 〔쉼표 두 토막〕");
  assert.equal(lines[3], "- G 급락 〔단문〕");
  assert.match(lines[4], /^오늘 제목은 이 형태를 피하십시오: 쉼표 두 토막 \(직전 제목의 형태, 최근 4건 중 3건이 쓴 형태\)\.$/);
  assert.match(renderRecentHeadlineLines(["G 급락"]), /피하십시오: 단문 \(직전 제목의 형태\)\.$/);
});
