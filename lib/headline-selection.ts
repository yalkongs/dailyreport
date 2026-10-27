// lib/headline-selection.ts
//
// 제목 후보 셋 중 고르기(2026-10-27 스펙 §3). 모델은 cover.headlineCandidates 에 { headline, subline } 후보를 쓰고, 코드는:
//   (1) 파이프라인의 제목 단위 정확성 검사로 거르고
//   (2) 최근 반복 감점으로 임시 제목을 cover.headline·subline 에 쓰고(이후 기존 검증이 그대로 돈다)
//   (3) 발송할 리포트가 정해진 뒤 편집자에게 한 번 묻는다. 편집자는 번호만 고른다 — 문장을 고쳐 쓰지 않는다.
// 어떤 실패도 발송을 막지 않는다: 편집자 오류·시간 초과·예산 부족·꺼짐이면 임시 제목(코드 점수 1위)으로 발송한다.
import Anthropic from "@anthropic-ai/sdk";
import { REPORT_MODEL } from "./claude-budget";
import { headlineForm, headlineScore, HEADLINE_DESK, HEADLINE_RUBRIC, type HeadlineForm, type HeadlineTarget } from "./headline-editorial";

export interface HeadlineCandidate {
  headline: string;
  subline: string;
}

export interface ScoredHeadline extends HeadlineCandidate {
  index: number;          // 모델이 쓴 순서(0부터)
  form: HeadlineForm;
  score: number;          // headlineScore — 0이 가장 좋다
  scoreReasons: string[];
  problems: string[];     // 제목 단위 정확성 검사 위반(빈 배열 = 생존)
}

export interface HeadlineSelection {
  scored: ScoredHeadline[];
  survivors: ScoredHeadline[];
  chosen: ScoredHeadline; // 임시 제목
}

export const MAX_HEADLINE_CANDIDATES = 3;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * cover 에서 후보를 읽는다(앞 3개, 빈 제목 제외). headlineCandidates 가 없거나 비면 옛 cover.headline·subline 을
 * 손대지 않고 후보 하나로 본다(호환 — 기존 응답·테스트 픽스처). 둘 다 없으면 [].
 */
export function extractHeadlineCandidates(cover: unknown): HeadlineCandidate[] {
  const c = asRecord(cover);
  if (!c) return [];
  const list = Array.isArray(c.headlineCandidates) ? c.headlineCandidates : [];
  const candidates = list
    .map(asRecord)
    .filter((x): x is Record<string, unknown> => x !== null && trimmed(x.headline) !== "")
    .slice(0, MAX_HEADLINE_CANDIDATES)
    .map((x) => ({ headline: trimmed(x.headline), subline: trimmed(x.subline) }));
  if (candidates.length > 0) return candidates;
  if (typeof c.headline === "string" && c.headline.trim()) {
    return [{ headline: c.headline, subline: typeof c.subline === "string" ? c.subline : "" }];
  }
  return [];
}

/**
 * 후보를 거르고 점수를 매겨 임시 제목을 cover.headline·cover.subline 에 쓴다. cover.headlineCandidates 는 지운다
 * (렌더·인덱스·로그에 후보가 남지 않게). 후보가 없으면 null — 필수 항목 검사가 누락을 보고한다.
 * recent: 같은 리포트 종류의 최근 제목(최신순, 오늘 제외). problemsOf: 파이프라인의 제목 단위 검사.
 * scoring:false(HEADLINE_SELECTION=off)면 점수 대신 첫 생존 후보를 쓴다.
 */
export function applyHeadlineSelection(
  report: unknown,
  recent: readonly string[],
  problemsOf: (c: HeadlineCandidate) => string[],
  options: { scoring?: boolean } = {},
): HeadlineSelection | null {
  const cover = asRecord(asRecord(report)?.cover);
  if (!cover) return null;
  const candidates = extractHeadlineCandidates(cover);
  delete cover.headlineCandidates;
  if (candidates.length === 0) return null;
  const scored: ScoredHeadline[] = candidates.map((c, index) => {
    const { score, reasons } = headlineScore(c.headline, recent);
    return { ...c, index, form: headlineForm(c.headline), score, scoreReasons: reasons, problems: problemsOf(c) };
  });
  const survivors = scored.filter((s) => s.problems.length === 0);
  const ranked = options.scoring === false ? survivors : [...survivors].sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = ranked[0] ?? scored[0];
  cover.headline = chosen.headline;
  cover.subline = chosen.subline;
  console.log(`🏷️ 제목 후보 ${scored.length}개(생존 ${survivors.length}) — 임시 제목: "${chosen.headline}" 〔${chosen.form}, 점수 ${chosen.score}〕`);
  for (const s of scored) {
    const why = [...s.problems.map((p) => `✗ ${p}`), ...s.scoreReasons].join(" / ");
    console.log(`   ${s.index + 1}. "${s.headline}" 〔${s.form}, ${s.score}〕${why ? ` — ${why}` : ""}`);
  }
  return { scored, survivors, chosen };
}

/** HEADLINE_SELECTION=off(대소문자·공백 무관)면 끈다 — 편집자를 부르지 않고 첫 생존 후보로 발송(긴급 되돌리기). */
// Partial: Next 타입이 ProcessEnv에 NODE_ENV를 필수로 두어 일부 키만 넘기는 호출(테스트)이 안 맞는다.
export function headlineSelectionEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  return env.HEADLINE_SELECTION?.trim().toLowerCase() !== "off";
}

export const HEADLINE_EDITOR_TIMEOUT_MS = 30_000;
// 편집자 호출을 시작할지 판단할 때 생성 예산(makeDeadline.canStartCall)에 넘기는 예상 시간.
export const HEADLINE_EDITOR_ESTIMATE_MS = 60_000;

export interface HeadlineEditorInput {
  target: HeadlineTarget;
  candidates: readonly HeadlineCandidate[];
  recent: readonly string[];
  tier?: string;
  subjectName?: string;
  evidence: readonly string[];
}

export interface HeadlineEditorVerdict {
  pick: number;
  scores: Array<{ natural: number; clear: number }>;
  reason: string;
}

export type HeadlineEditor = (input: HeadlineEditorInput) => Promise<HeadlineEditorVerdict | null>;

const EDITOR_SYSTEM = `${HEADLINE_DESK}
아래 제목 후보 가운데 오늘 발행할 제목 하나를 고릅니다. 고르기만 하고 고쳐 쓰지 않습니다.
기준(앞의 것이 우선):
${HEADLINE_RUBRIC}
- 같은 점수면 최근 제목과 형태·끝 어절이 덜 겹치는 후보.
결과는 pick 도구로 한 번 낸다.`;

export function buildHeadlineEditorPrompt(input: HeadlineEditorInput): string {
  const parts = [
    `리포트: ${input.target === "etf" ? "ETF Today (자산군·ETF)" : "Daily Market (시장 전체)"}`,
    input.tier ? `근거 상태(tier): ${input.tier}` : "",
    input.subjectName ? `오늘의 주제 자산군: ${input.subjectName}` : "",
    input.evidence.length > 0
      ? `오늘의 핵심 근거:\n${input.evidence.map((e) => `- ${e}`).join("\n")}`
      : "오늘의 핵심 근거: 없음(인과를 단정한 후보는 감점)",
    input.recent.length > 0 ? `최근 제목(최신순):\n${input.recent.map((h) => `- ${h}`).join("\n")}` : "",
    `후보:\n${input.candidates.map((c, i) => `${i}. 제목: ${c.headline}\n   부제: ${c.subline}`).join("\n")}`,
    "후보마다 자연스러움·명확성을 1~5로 매기고, 가장 나은 후보의 번호(0부터)를 pick 도구로 내십시오.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

const PICK_SCHEMA = {
  type: "object",
  properties: {
    pick: { type: "integer", minimum: 0 },
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: { natural: { type: "integer", minimum: 1, maximum: 5 }, clear: { type: "integer", minimum: 1, maximum: 5 } },
        required: ["natural", "clear"],
      },
    },
    reason: { type: "string" },
  },
  required: ["pick", "scores", "reason"],
};

/** 도구 입력 검사 — pick 이 0..n-1 정수가 아니면 null. scores·reason 은 기록용이라 모양이 틀리면 비운다. */
export function parseHeadlineEditorVerdict(raw: unknown, n: number): HeadlineEditorVerdict | null {
  const r = asRecord(raw);
  const pick = r?.pick;
  if (typeof pick !== "number" || !Number.isInteger(pick) || pick < 0 || pick >= n) return null;
  const scores = Array.isArray(r?.scores)
    ? r.scores.map(asRecord).filter((s): s is Record<string, unknown> => s !== null).map((s) => ({ natural: Number(s.natural), clear: Number(s.clear) }))
    : [];
  return { pick, scores, reason: typeof r?.reason === "string" ? r.reason : "" };
}

let editorClient: Anthropic | null = null;
function getEditorClient(): Anthropic {
  // SDK 재시도 없이 30초 — 늦으면 임시 제목으로 발송한다.
  if (!editorClient) editorClient = new Anthropic({ timeout: HEADLINE_EDITOR_TIMEOUT_MS, maxRetries: 0 });
  return editorClient;
}

/** 기본 편집자 — 생성과 같은 모델에 한 번 묻는다. 도구 결과가 없거나 틀리면 null(호출자가 임시 제목을 쓴다). */
export const callHeadlineEditor: HeadlineEditor = async (input) => {
  const res = await getEditorClient().messages.create({
    model: REPORT_MODEL,
    max_tokens: 1024,
    system: EDITOR_SYSTEM,
    tools: [{ name: "pick", description: "고른 후보 번호와 후보별 점수를 낸다(반드시 이 도구로 한 번)", input_schema: PICK_SCHEMA as never }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: buildHeadlineEditorPrompt(input) }],
  });
  const call = res.content.find((c) => c.type === "tool_use") as { input?: unknown } | undefined;
  return parseHeadlineEditorVerdict(call?.input, input.candidates.length);
};

export interface FinalHeadlineOptions<T> {
  selection: HeadlineSelection | null;
  enabled: boolean;                               // headlineSelectionEnabled()
  canCall: () => boolean;                         // 생성 예산 — deadline.canStartCall(HEADLINE_EDITOR_ESTIMATE_MS)
  editor: HeadlineEditor;
  input: Omit<HeadlineEditorInput, "candidates">;
  trySwap: (candidate: ScoredHeadline) => T | null; // 고른 후보로 바꾼 리포트를 기존 검증으로 다시 본다 — 나빠지면 null
}

/**
 * 발송할 리포트가 정해진 뒤 한 번만 부른다. 생존 후보가 둘 이상이고 켜져 있고 예산이 있으면 편집자에게 묻고,
 * 고른 후보가 임시 제목과 다르면 trySwap 결과를 돌려준다. 그 밖(후보 부족·꺼짐·예산 부족·편집자 오류·같은 후보·검증 악화)은 null —
 * 호출자는 임시 제목 그대로 발송한다. 던지지 않는다.
 */
export async function chooseFinalHeadline<T>(o: FinalHeadlineOptions<T>): Promise<T | null> {
  const sel = o.selection;
  if (!sel || sel.survivors.length < 2) return null;
  if (!o.enabled) {
    console.log("🏷️ 제목 편집자 꺼짐(HEADLINE_SELECTION=off) — 임시 제목 유지");
    return null;
  }
  if (!o.canCall()) {
    console.log("🏷️ 생성 예산 부족 — 제목 편집자 생략, 임시 제목 유지");
    return null;
  }
  let verdict: HeadlineEditorVerdict | null;
  try {
    verdict = await o.editor({ ...o.input, candidates: sel.survivors.map(({ headline, subline }) => ({ headline, subline })) });
  } catch (e) {
    console.log(`🏷️ 제목 편집자 호출 실패 — 임시 제목 유지: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!verdict) {
    console.log("🏷️ 제목 편집자 응답 없음·형식 오류 — 임시 제목 유지");
    return null;
  }
  const picked = sel.survivors[verdict.pick];
  const scores = verdict.scores.map((s, i) => `${i}:${s.natural}/${s.clear}`).join(" ");
  console.log(`🏷️ 제목 편집자 선택: "${picked.headline}" (자연/명확 ${scores || "-"}) — ${verdict.reason}`);
  if (picked === sel.chosen) return null;
  const swapped = o.trySwap(picked);
  if (swapped === null) console.log("🏷️ 고른 후보로 바꾸면 검증이 나빠져 임시 제목 유지");
  return swapped;
}
