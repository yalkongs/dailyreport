import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  extractHeadlineCandidates, applyHeadlineSelection, headlineSelectionEnabled, parseHeadlineEditorVerdict,
  buildHeadlineEditorPrompt, chooseFinalHeadline, type HeadlineEditor, type HeadlineSelection,
} from "./headline-selection";

function quiet(t: TestContext) {
  t.mock.method(console, "log", () => {});
}

test("extractHeadlineCandidates: 후보 목록(앞 3개, 빈 제목 제외·공백 정리)이 옛 cover.headline 보다 우선한다", () => {
  const cover = {
    headline: "옛 제목 필드",
    subline: "옛 부제",
    headlineCandidates: [{ headline: " A ", subline: " a " }, { headline: "", subline: "x" }, null, { headline: "B" }, { headline: "C", subline: "c" }, { headline: "D", subline: "d" }],
  };
  assert.deepEqual(extractHeadlineCandidates(cover), [
    { headline: "A", subline: "a" }, { headline: "B", subline: "" }, { headline: "C", subline: "c" },
  ]);
});

test("extractHeadlineCandidates: 후보가 없으면 옛 cover.headline·subline 을 손대지 않고 후보 하나로, 둘 다 없으면 빈 배열", () => {
  assert.deepEqual(extractHeadlineCandidates({ headline: "옛 제목", subline: " 부제 " }), [{ headline: "옛 제목", subline: " 부제 " }]);
  assert.deepEqual(extractHeadlineCandidates({ headline: "옛 제목", headlineCandidates: [] }), [{ headline: "옛 제목", subline: "" }]);
  assert.deepEqual(extractHeadlineCandidates({ subline: "부제만" }), []);
  assert.deepEqual(extractHeadlineCandidates(null), []);
});

test("applyHeadlineSelection: 검사에 걸린 후보는 빼고 점수 1위(동점이면 앞 순서)를 임시 제목으로, 후보 필드는 지운다", (t) => {
  quiet(t);
  const report = { cover: { headlineCandidates: [
    { headline: "나쁜 후보", subline: "s0" },
    { headline: "A, B", subline: "s1" },   // 직전과 같은 쉼표 형태 → -2
    { headline: "C 급락", subline: "s2" },
  ] } } as { cover: Record<string, unknown> };
  const sel = applyHeadlineSelection(report, ["X, Y"], (c) => (c.headline === "나쁜 후보" ? ["기간 비교"] : []));
  assert.ok(sel);
  assert.deepEqual(sel.survivors.map((s) => s.index), [1, 2]);
  assert.equal(sel.chosen.headline, "C 급락");
  assert.equal(report.cover.headline, "C 급락");
  assert.equal(report.cover.subline, "s2");
  assert.equal("headlineCandidates" in report.cover, false);
  assert.deepEqual(sel.scored[0].problems, ["기간 비교"]);
});

test("applyHeadlineSelection: 생존이 없으면 첫 후보, scoring:false 면 점수 대신 첫 생존 후보, 후보가 없으면 null", (t) => {
  quiet(t);
  const none = { cover: { headlineCandidates: [{ headline: "P", subline: "p" }, { headline: "Q", subline: "q" }] } } as { cover: Record<string, unknown> };
  const s1 = applyHeadlineSelection(none, [], () => ["위반"]);
  assert.equal(s1?.survivors.length, 0);
  assert.equal(none.cover.headline, "P");

  const off = { cover: { headlineCandidates: [{ headline: "A, B", subline: "a" }, { headline: "C 급락", subline: "c" }] } } as { cover: Record<string, unknown> };
  applyHeadlineSelection(off, ["X, Y"], () => [], { scoring: false });
  assert.equal(off.cover.headline, "A, B");

  assert.equal(applyHeadlineSelection({ cover: { subline: "s" } }, [], () => []), null);
  assert.equal(applyHeadlineSelection({}, [], () => []), null);
});

test("headlineSelectionEnabled: off(대소문자·공백 무관)만 끈다", () => {
  assert.equal(headlineSelectionEnabled({}), true);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: "on" }), true);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: "off" }), false);
  assert.equal(headlineSelectionEnabled({ HEADLINE_SELECTION: " OFF " }), false);
});

test("parseHeadlineEditorVerdict: pick 이 0..n-1 정수일 때만", () => {
  assert.deepEqual(parseHeadlineEditorVerdict({ pick: 1, scores: [{ natural: 4, clear: 5 }], reason: "r" }, 2), { pick: 1, scores: [{ natural: 4, clear: 5 }], reason: "r" });
  assert.deepEqual(parseHeadlineEditorVerdict({ pick: 0 }, 2), { pick: 0, scores: [], reason: "" });
  assert.equal(parseHeadlineEditorVerdict({ pick: 2 }, 2), null);
  assert.equal(parseHeadlineEditorVerdict({ pick: 0.5 }, 2), null);
  assert.equal(parseHeadlineEditorVerdict({ pick: "1" }, 2), null);
  assert.equal(parseHeadlineEditorVerdict(undefined, 2), null);
});

test("buildHeadlineEditorPrompt: 리포트·근거·최근 제목·번호 붙은 후보", () => {
  const p = buildHeadlineEditorPrompt({
    target: "etf", tier: "thin", subjectName: "국내 반도체", evidence: ["삼성전자 3분기 실적 발표"],
    recent: ["A, B"], candidates: [{ headline: "H0", subline: "S0" }, { headline: "H1", subline: "S1" }],
  });
  assert.match(p, /ETF Today/);
  assert.match(p, /근거 상태\(tier\): thin/);
  assert.match(p, /오늘의 주제 자산군: 국내 반도체/);
  assert.match(p, /- 삼성전자 3분기 실적 발표/);
  assert.match(p, /최근 제목\(최신순\):\n- A, B/);
  assert.match(p, /0\. 제목: H0\n {3}부제: S0\n1\. 제목: H1/);
  assert.match(buildHeadlineEditorPrompt({ target: "market", recent: [], candidates: [], evidence: [] }), /오늘의 핵심 근거: 없음/);
});

function selectionOf(n: number): HeadlineSelection {
  const scored = Array.from({ length: n }, (_, i) => ({ headline: `H${i}`, subline: `S${i}`, index: i, form: "단문" as const, score: 0, scoreReasons: [], problems: [] }));
  return { scored, survivors: scored, chosen: scored[0] };
}

function editorReturning(v: Awaited<ReturnType<HeadlineEditor>> | Error) {
  let calls = 0;
  const editor: HeadlineEditor = async () => { calls++; if (v instanceof Error) throw v; return v; };
  return { editor, calls: () => calls };
}

const base = { enabled: true, canCall: () => true, input: { target: "market" as const, recent: [], evidence: [] } };

test("chooseFinalHeadline: 다른 생존 후보를 고르면 trySwap 결과, 같은 후보면 다시 보지 않고 null", async (t) => {
  quiet(t);
  const swaps: string[] = [];
  const trySwap = (c: { headline: string }) => { swaps.push(c.headline); return `swapped:${c.headline}`; };
  const other = editorReturning({ pick: 1, scores: [], reason: "r" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: other.editor, trySwap }), "swapped:H1");
  const same = editorReturning({ pick: 0, scores: [], reason: "r" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: same.editor, trySwap }), null);
  assert.deepEqual(swaps, ["H1"]);
});

test("chooseFinalHeadline: 생존 2개 미만·꺼짐·예산 부족이면 편집자를 부르지 않는다", async (t) => {
  quiet(t);
  const e = editorReturning({ pick: 1, scores: [], reason: "r" });
  const trySwap = () => "x";
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(1), editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: null, editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, enabled: false, selection: selectionOf(2), editor: e.editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, canCall: () => false, selection: selectionOf(2), editor: e.editor, trySwap }), null);
  assert.equal(e.calls(), 0);
});

test("chooseFinalHeadline: 편집자 오류·응답 없음·검증 악화(trySwap null)는 모두 null — 던지지 않는다", async (t) => {
  quiet(t);
  const trySwap = () => "x";
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning(new Error("timeout")).editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning(null).editor, trySwap }), null);
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: editorReturning({ pick: 1, scores: [], reason: "" }).editor, trySwap: () => null }), null);
});

test("chooseFinalHeadline: 편집자에게는 생존 후보의 제목·부제만 보낸다", async (t) => {
  quiet(t);
  let seen: unknown = null;
  const editor: HeadlineEditor = async (input) => { seen = input.candidates; return null; };
  const sel = selectionOf(3);
  sel.survivors = [sel.scored[0], sel.scored[2]];
  await chooseFinalHeadline({ ...base, selection: sel, editor, trySwap: () => null });
  assert.deepEqual(seen, [{ headline: "H0", subline: "S0" }, { headline: "H2", subline: "S2" }]);
});
