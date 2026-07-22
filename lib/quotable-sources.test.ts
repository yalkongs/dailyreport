import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTABLE_SOURCES,
  softFixUnquotableSources,
  countCitationPhrases,
} from "./quotable-sources";

test("비승인 소스 '이 전한' 프레임 치환", () => {
  const r = softFixUnquotableSources("Crypto Briefing이 전한 Micron의 전망", ["Crypto Briefing", "연합뉴스"]);
  assert.equal(r.fixed, "외신이 전한 Micron의 전망");
  assert.equal(r.softFixes.length, 1);
});

test("승인 소스는 무변경", () => {
  const src = "연합뉴스 마켓 보도에 따르면 코스피가 상승했습니다.";
  const r = softFixUnquotableSources(src, ["연합뉴스"]);
  assert.equal(r.fixed, src);
  assert.equal(r.softFixes.length, 0);
});

test("복합 비승인 소스 나열 '~과 ~ 등 외신에 따르면' 정리", () => {
  const r = softFixUnquotableSources(
    "Crypto Briefing과 finance.biggo.com 등 외신에 따르면 마이크론이 강세입니다.",
    ["Crypto Briefing", "finance.biggo.com"]
  );
  assert.equal(r.fixed, "외신에 따르면 마이크론이 강세입니다.");
});

test("비승인 소스 '에 따르면' 프레임 치환", () => {
  const r = softFixUnquotableSources("finance.biggo.com에 따르면 반등했습니다.", ["finance.biggo.com"]);
  assert.equal(r.fixed, "외신 보도에 따르면 반등했습니다.");
});

test("프레임 밖 잔존 비승인 이름은 warning으로", () => {
  const r = softFixUnquotableSources("Crypto Briefing 리포트가 나왔습니다.", ["Crypto Briefing"]);
  // 인용 프레임이 아니므로 치환되지 않고 warning 로그 대상
  assert.equal(r.fixed, "Crypto Briefing 리포트가 나왔습니다.");
  assert.equal(r.warnings.length, 1);
});

test("countCitationPhrases: '에 따르면' 6회", () => {
  const text = Array.from({ length: 6 }, (_, i) => `소스${i}에 따르면 A.`).join(" ");
  assert.equal(countCitationPhrases(text), 6);
});

test("QUOTABLE_SOURCES는 주요 국내외 매체를 포함", () => {
  for (const s of ["연합뉴스", "한국경제", "Reuters", "Bloomberg", "CNBC"]) {
    assert.ok(QUOTABLE_SOURCES.includes(s), `${s} 누락`);
  }
});
