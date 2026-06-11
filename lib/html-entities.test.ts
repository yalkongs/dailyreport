import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlEntities } from "./html-entities";

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
