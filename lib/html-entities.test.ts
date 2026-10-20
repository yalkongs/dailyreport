import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCharacterReferences, decodeHtmlEntities, stripEmphasisTags } from "./html-entities";

test("decodeHtmlEntities: &amp; → & (인시던트 회귀: S&P / M&A)", () => {
  assert.equal(decodeHtmlEntities("S&amp;P 500"), "S&P 500");
  assert.equal(decodeHtmlEntities("삼성전자 M&amp;A 모색"), "삼성전자 M&A 모색");
});

test("decodeHtmlEntities: 다중 엔티티 혼합", () => {
  assert.equal(
    decodeHtmlEntities("A&amp;B &lt;c&gt; &quot;d&quot; &#39;e&#39;"),
    "A&B <c> \"d\" 'e'",
  );
});

test("decodeHtmlEntities: 이중 디코딩 방지 (&amp;lt; → &lt;)", () => {
  assert.equal(decodeHtmlEntities("&amp;lt;"), "&lt;");
});

test("decodeHtmlEntities: 엔티티 없는 평문은 불변", () => {
  assert.equal(
    decodeHtmlEntities("코스피 4.52% 하락, 7763선 회복"),
    "코스피 4.52% 하락, 7763선 회복",
  );
});

test("stripEmphasisTags: <strong> 제거 (회귀: 서브라인 태그 노출)", () => {
  assert.equal(
    stripEmphasisTags("국채 금리가 <strong>4.46%</strong>로 뛰었습니다"),
    "국채 금리가 4.46%로 뛰었습니다",
  );
});

test("stripEmphasisTags: 속성 있는 태그·다중 강조 태그 제거", () => {
  assert.equal(
    stripEmphasisTags('<strong class="x">A</strong> <b>B</b> <em>C</em>'),
    "A B C",
  );
});

test("stripEmphasisTags: 강조 태그 외 stray 부등호는 보존 (escape는 호출부 책임)", () => {
  assert.equal(stripEmphasisTags("금리 < 5% 또는 > 3%"), "금리 < 5% 또는 > 3%");
  assert.equal(stripEmphasisTags("태그 없는 평문 S&P 500"), "태그 없는 평문 S&P 500");
});

// Ruling 37c: 권유 검사는 화면에 보이는 글자로 본다 — 이름·10진·16진 문자 참조를 한 번만 푼다.
test("decodeCharacterReferences: 이름·10진·16진 참조를 한 번만 풀고, 모르는 이름·잘못된 코드는 그대로", () => {
  assert.equal(decodeCharacterReferences("매수&nbsp;하세요"), "매수 하세요");
  assert.equal(decodeCharacterReferences("매수&#32;하세요"), "매수 하세요");
  assert.equal(decodeCharacterReferences("매수&#x20;하세요 &#X41;"), "매수 하세요 A");
  assert.equal(decodeCharacterReferences("매수&#8203;하세요"), "매수​하세요");
  assert.equal(decodeCharacterReferences("S&amp;P &lt;b&gt; &quot;x&quot; &apos;y&apos; &hellip;"), "S&P <b> \"x\" 'y' …");
  assert.equal(decodeCharacterReferences("&amp;nbsp; &amp;#32;"), "&nbsp; &#32;"); // 한 번만
  assert.equal(decodeCharacterReferences("&foo; &#0; &#99999999; &#xD800; & 홀로"), "&foo; &#0; &#99999999; &#xD800; & 홀로");
  assert.equal(decodeCharacterReferences("코스피 4.52% 하락"), "코스피 4.52% 하락");
});
