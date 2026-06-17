import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlEntities, stripEmphasisTags } from "./html-entities";

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
