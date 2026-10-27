import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  extractHeadlineCandidates, applyHeadlineSelection, headlineSelectionEnabled, parseHeadlineEditorVerdict,
  buildHeadlineEditorPrompt, chooseFinalHeadline, callHeadlineEditor, type HeadlineEditor, type HeadlineSelection,
} from "./headline-selection";
import { REPORT_MODEL } from "./claude-budget";

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

function coverOf(...headlines: string[]) {
  return { cover: { headlineCandidates: headlines.map((h, i) => ({ headline: h, subline: `s${i}` })) } } as { cover: Record<string, unknown> };
}

test("applyHeadlineSelection(F1): 생존이 없으면 차단 후보는 제쳐 두고 차단되지 않는 후보를 임시 제목으로 쓴다", (t) => {
  quiet(t);
  const isBlocking = (c: { headline: string }) => c.headline === "권유";
  // 0번이 차단(HARD 권유 등), 1번은 위반이 있어도 경고로 발송할 수 있다 → 1번
  const r1 = coverOf("권유", "위반만");
  const s1 = applyHeadlineSelection(r1, [], (c) => (c.headline === "권유" ? ["권유"] : ["비교"]), { isBlocking });
  assert.equal(s1?.survivors.length, 0);
  assert.equal(s1?.chosen.index, 1);
  assert.equal(r1.cover.headline, "위반만");
  assert.equal(r1.cover.subline, "s1");
  assert.deepEqual(s1?.scored.map((s) => s.blocking), [true, false]);

  // 차단되지 않는 둘은 위반이 적은 쪽 → 2번(위반 1건)
  const r2 = coverOf("권유", "위반둘", "위반하나");
  const s2 = applyHeadlineSelection(r2, [], (c) => (c.headline === "권유" ? ["권유"] : c.headline === "위반둘" ? ["가", "나"] : ["가"]), { isBlocking });
  assert.equal(s2?.chosen.index, 2);
  assert.equal(r2.cover.headline, "위반하나");

  // 위반 수가 같으면 점수가 높은 쪽(쉼표 두 토막 반복은 -2), 점수도 같으면 앞 순서
  const r3 = coverOf("A, B", "C 급락");
  assert.equal(applyHeadlineSelection(r3, ["X, Y"], () => ["가"], { isBlocking })?.chosen.index, 1);
  const r4 = coverOf("C 급락", "D 급락");
  assert.equal(applyHeadlineSelection(r4, [], () => ["가"], { isBlocking })?.chosen.index, 0);
});

test("applyHeadlineSelection(F1): 모두 차단이면(또는 isBlocking 이 없으면) 첫 후보 — 필수 항목 검사가 알리게 둔다", (t) => {
  quiet(t);
  const r1 = coverOf("권유A", "권유B");
  assert.equal(applyHeadlineSelection(r1, [], () => ["권유"], { isBlocking: () => true })?.chosen.index, 0);
  assert.equal(r1.cover.headline, "권유A");
  const r2 = coverOf("P", "Q");
  assert.equal(applyHeadlineSelection(r2, [], (c) => (c.headline === "P" ? ["가", "나"] : ["가"]))?.chosen.index, 0);
});

test("applyHeadlineSelection(F1): 생존 후보가 있으면 차단 여부와 무관하게 기존대로(점수 → 순서, scoring:false 면 첫 생존)", (t) => {
  quiet(t);
  const r = coverOf("A, B", "C 급락", "E 급락");
  const s = applyHeadlineSelection(r, ["X, Y"], (c) => (c.headline === "E 급락" ? ["위반"] : []), { isBlocking: (c) => c.headline === "E 급락" });
  assert.deepEqual(s?.survivors.map((x) => x.index), [0, 1]);
  assert.equal(s?.chosen.index, 1);
  const off = coverOf("A, B", "C 급락");
  assert.equal(applyHeadlineSelection(off, ["X, Y"], () => [], { scoring: false, isBlocking: () => false })?.chosen.index, 0);
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
  const noEvidence = buildHeadlineEditorPrompt({ target: "market", recent: [], candidates: [], evidence: [] });
  assert.match(noEvidence, /오늘의 핵심 근거: 없음/);
  // F8: 근거가 없어도 입력 수치로 확인되는 인과까지 감점하지는 않는다 — 확인되지 않는 원인 단정만.
  assert.match(noEvidence, /입력 수치로 확인되지 않는 원인을 단정한 후보는 감점/);
});

function selectionOf(n: number): HeadlineSelection {
  const scored = Array.from({ length: n }, (_, i) => ({ headline: `H${i}`, subline: `S${i}`, index: i, form: "단문" as const, score: 0, scoreReasons: [], problems: [], blocking: false }));
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

test("chooseFinalHeadline(F5): 점수 로그는 원래 후보 번호(1부터)로 매기고, scores 없는 응답이 주입돼도 던지지 않는다", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  const sel = selectionOf(3);
  sel.survivors = [sel.scored[0], sel.scored[2]];
  const withScores = editorReturning({ pick: 1, scores: [{ natural: 4, clear: 5 }, { natural: 3, clear: 3 }], reason: "r" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: sel, editor: withScores.editor, trySwap: (c) => `swapped:${c.headline}` }), "swapped:H2");
  assert.ok(logs.some((l) => l.includes("자연/명확 1:4/5 3:3/3")), logs.join("\n"));
  const noScores = editorReturning({ pick: 1, reason: "r" } as unknown as Awaited<ReturnType<HeadlineEditor>>);
  assert.equal(await chooseFinalHeadline({ ...base, selection: sel, editor: noScores.editor, trySwap: (c) => `swapped:${c.headline}` }), "swapped:H2");
  assert.ok(logs.some((l) => l.includes("자연/명확 -")), logs.join("\n"));
});

test("chooseFinalHeadline: 편집자 번호가 범위 밖이면 null — 바꾸기를 부르지 않고 던지지 않는다", async (t) => {
  quiet(t);
  let swapCalls = 0;
  const e = editorReturning({ pick: 5, scores: [], reason: "" });
  const trySwap = () => { swapCalls++; return "x"; };
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: e.editor, trySwap }), null);
  assert.equal(swapCalls, 0);
});

test("chooseFinalHeadline: 바꾸기(trySwap)가 던지면 null — 던지지 않는다", async (t) => {
  quiet(t);
  const e = editorReturning({ pick: 1, scores: [], reason: "" });
  assert.equal(await chooseFinalHeadline({ ...base, selection: selectionOf(2), editor: e.editor, trySwap: () => { throw new Error("boom"); } }), null);
});

test("callHeadlineEditor: 도구를 pick 으로 고정하고 모델·전체 시간 제한을 넘기며, 도구 결과가 없으면 null", async (t) => {
  quiet(t);
  const calls: Array<{ params: Record<string, unknown>; options: { signal?: unknown } }> = [];
  let reply: unknown = { content: [{ type: "tool_use", id: "t", name: "pick", input: { pick: 1, scores: [{ natural: 4, clear: 4 }, { natural: 5, clear: 5 }], reason: "r" } }] };
  t.mock.method(Anthropic.Messages.prototype, "create", async (params: Record<string, unknown>, options: { signal?: unknown }) => {
    calls.push({ params, options });
    return reply;
  });
  const input = { target: "market" as const, candidates: [{ headline: "A", subline: "a" }, { headline: "B", subline: "b" }], recent: [], evidence: [] };
  assert.deepEqual(await callHeadlineEditor(input), { pick: 1, scores: [{ natural: 4, clear: 4 }, { natural: 5, clear: 5 }], reason: "r" });
  assert.equal(calls.length, 1);
  const { params, options } = calls[0];
  assert.equal(params.model, REPORT_MODEL);
  assert.deepEqual(params.tool_choice, { type: "tool", name: "pick" });
  assert.equal((params.tools as Array<{ name: string }>)[0].name, "pick");
  assert.ok(options.signal instanceof AbortSignal);
  // F3: 스펙의 우선순위(명확성 → 자연스러움)가 시스템 프롬프트에 그대로 있어야 한다 — 루브릭 나열 순서에 끌려가지 않게.
  assert.match(params.system as string, /명확성 → 자연스러움/);

  reply = { content: [{ type: "text", text: "도구 없이 쓴 글" }] };
  assert.equal(await callHeadlineEditor(input), null);
});
