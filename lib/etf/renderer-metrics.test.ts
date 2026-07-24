import { test } from "node:test";
import assert from "node:assert/strict";
import { metricItemsHtml } from "./renderer";

test("null 메트릭은 항목 생략 — '미확보' 미노출", () => {
  const html = metricItemsHtml([
    { label: "거래대금(원)", value: null },
    { label: "괴리율", value: "+0.12%" },
    { label: "지수대비", value: null },
  ]);
  assert.ok(!html.includes("미확보"), "미확보가 노출되면 안 됨");
  assert.ok(html.includes("괴리율"), "값 있는 항목은 유지");
  assert.ok(!html.includes("거래대금"), "null 항목은 생략");
});

test("모든 메트릭이 null이면 빈 문자열(→ 호출부에서 grid 생략)", () => {
  const html = metricItemsHtml([
    { label: "거래대금(원)", value: null },
    { label: "괴리율", value: null },
    { label: "지수대비", value: null },
  ]);
  assert.equal(html, "");
});

test("max 개수 제한 적용(값 있는 항목 기준)", () => {
  const html = metricItemsHtml(
    [
      { label: "A", value: "1" },
      { label: "B", value: "2" },
      { label: "C", value: "3" },
      { label: "D", value: "4" },
    ],
    2
  );
  assert.ok(html.includes("A") && html.includes("B"));
  assert.ok(!html.includes("C") && !html.includes("D"));
});
