// scripts/headline-quality.ts
//
// 제목 품질 기준선 평가(2026-10-27). 규칙을 덧대기 전에 '지금 어떤가'를 같은 잣대로 잰다 — 바꾼 뒤 같은 명령으로 다시 재서 비교한다.
//   npx tsx scripts/headline-quality.ts [--n 60] [--judge] [--out docs/quality/headline-baseline-YYYY-MM-DD]
// - 코드 지표: 구조 분포, 마지막 술어 반복률(직전 5건), 직전 제목과 같은 구조 비율, 직전 5건과의 어휘 겹침, 의인화 동사 사용률(측정용 — 금지 목록이 아니다)
//   (분류기·지표·평가 기준은 lib/headline-editorial.ts — 운영 후보 점수와 같은 함수)
// - --judge: Claude가 한국 경제신문 증권면 데스크 기준으로 제목마다 자연스러움·명확성·인과 단정 위험을 매기고 어색한 표현의 유형·대안을 적는다
//   (ANTHROPIC_API_KEY와 평가 모델(--model 또는 HEADLINE_JUDGE_MODEL) 필요. 판정은 참고용 — 사람이 결과를 읽고 판단한다)
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { headlineCodeMetrics, HEADLINE_JUDGE_SYSTEM } from "../lib/headline-editorial";

type Kind = "ETF" | "Market";
interface Item { kind: Kind; date: string; headline: string }

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

interface Judged { date: string; kind: Kind; headline: string; naturalness: number; clarity: number; causalAssertion: boolean; issues: Array<{ type: string; phrase: string; why: string; suggestion: string }> }

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" }, kind: { type: "string", enum: ["ETF", "Market"] }, headline: { type: "string" },
          naturalness: { type: "integer", minimum: 1, maximum: 5 }, clarity: { type: "integer", minimum: 1, maximum: 5 },
          causalAssertion: { type: "boolean" },
          issues: { type: "array", items: { type: "object", properties: {
            type: { type: "string" }, phrase: { type: "string" }, why: { type: "string" }, suggestion: { type: "string" },
          }, required: ["type", "phrase", "why", "suggestion"] } },
        },
        required: ["date", "kind", "headline", "naturalness", "clarity", "causalAssertion", "issues"],
      },
    },
  },
  required: ["items"],
};

async function judge(items: Item[], model: string): Promise<Judged[]> {
  const client = new Anthropic();
  const out: Judged[] = [];
  for (let i = 0; i < items.length; i += 20) {
    const batch = items.slice(i, i + 20);
    const user = `다음 제목들을 기준대로 평가하라(날짜 순, 같은 종류 안에서 반복되는 틀도 상투적 틀로 지적하라).\n` +
      batch.map((b) => `- ${b.date} [${b.kind}] ${b.headline}`).join("\n");
    // 구조화 출력: report 도구 호출로 받는다(자유 텍스트 JSON은 제목 속 따옴표로 자주 깨졌다). 이 모델은 tool_choice 강제를
    // 지원하지 않아 auto + 지시로 부르고, 결과가 없으면 다시 묻는다.
    let parsed: Judged[] | undefined;
    for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
      const res = await client.messages.create({
        model, max_tokens: 16000, system: HEADLINE_JUDGE_SYSTEM,
        tools: [{ name: "report", description: "제목 평가 결과를 낸다(반드시 이 도구로 한 번에 모두)", input_schema: JUDGE_SCHEMA as never }],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: `${user}\n\n결과는 report 도구를 한 번 호출해 items 배열로 모두 낸다.` }],
      });
      const call = res.content.find((c) => c.type === "tool_use") as { input?: { items?: Judged[] } } | undefined;
      parsed = call?.input?.items;
      if (!parsed) process.stderr.write(`  도구 호출 없음(${attempt}/3, stop=${res.stop_reason})\n`);
    }
    if (!parsed) throw new Error(`판정 응답에 결과가 없음(묶음 ${i / 20 + 1})`);
    out.push(...parsed);
    process.stderr.write(`  judged ${Math.min(i + 20, items.length)}/${items.length}\n`);
  }
  return out;
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const n = Number(arg("n", "60"));
  const doJudge = process.argv.includes("--judge");
  const out = arg("out", `docs/quality/headline-baseline-${new Date().toISOString().slice(0, 10)}`)!;
  const load = (f: string, kind: Kind): Item[] =>
    (JSON.parse(fs.readFileSync(f, "utf8")).reports as Array<{ date: string; headline?: string }>)
      .filter((r) => r.headline).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-n)
      .map((r) => ({ kind, date: r.date, headline: r.headline!.replace(/<[^>]+>/g, "").trim() }));
  const sets: Record<Kind, Item[]> = { ETF: load("data/etf-reports-index.json", "ETF"), Market: load("data/reports-index.json", "Market") };
  const metrics = { ETF: headlineCodeMetrics(sets.ETF.map((i) => i.headline)), Market: headlineCodeMetrics(sets.Market.map((i) => i.headline)) };
  let judged: Judged[] = [];
  // 평가 모델은 기준선과 같은 것을 써야 비교가 된다 — --model 또는 HEADLINE_JUDGE_MODEL로 지정
  const model = arg("model", process.env.HEADLINE_JUDGE_MODEL);
  if (doJudge && !model) throw new Error("--judge에는 --model 또는 HEADLINE_JUDGE_MODEL이 필요하다");
  if (doJudge) judged = await judge([...sets.ETF, ...sets.Market], model!);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), n, metrics, judged }, null, 2));

  const lines: string[] = [`# 제목 품질 기준선 (${new Date().toISOString().slice(0, 10)}, 종류별 최근 ${n}건)`, ""];
  for (const kind of ["ETF", "Market"] as const) {
    const m = metrics[kind];
    lines.push(`## ${kind} (${sets[kind][0]?.date} ~ ${sets[kind].at(-1)?.date})`, "");
    lines.push(`- 쉼표로 두 토막 낸 제목(모든 분류 합): ${pct(m.commaRate)}`);
    lines.push(`- 구조: ${m.structures.map(([k, v]) => `${k} ${v}(${pct(v / m.n)})`).join(" · ")}`);
    lines.push(`- 끝맺음: ${m.endingTypes.map(([k, v]) => `${k} ${v}`).join(" · ")} / 많이 쓴 끝 어절: ${m.topEndings.map(([k, v]) => `${k} ${v}`).join(", ")}`);
    lines.push(`- 직전 5건과 같은 끝 어절: ${pct(m.repeatEndingRate)} · 직전 제목과 같은 구조: ${pct(m.sameStructurePrevRate)} · 의인화 동사 포함: ${pct(m.personifiedRate)} · 직전 5건과 최대 어휘 겹침 평균: ${m.avgMaxOverlapPrev5.toFixed(2)}`);
    const j = judged.filter((x) => x.kind === kind);
    if (j.length) {
      const avg = (f: (x: Judged) => number) => (j.reduce((s, x) => s + f(x), 0) / j.length).toFixed(2);
      const types = new Map<string, number>();
      for (const x of j) for (const is of x.issues) types.set(is.type, (types.get(is.type) ?? 0) + 1);
      lines.push(`- 편집자 평가(${j.length}건): 자연스러움 평균 ${avg((x) => x.naturalness)} · 명확성 평균 ${avg((x) => x.clarity)} · 인과 단정 ${j.filter((x) => x.causalAssertion).length}건 · 지적 있는 제목 ${j.filter((x) => x.issues.length).length}건`);
      lines.push(`- 지적 유형: ${[...types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "없음"}`);
      lines.push("", "| 날짜 | 제목 | 자연 | 명확 | 지적 → 대안 |", "|---|---|---|---|---|");
      for (const x of j.filter((x) => x.issues.length || x.naturalness <= 3).slice(-25)) {
        lines.push(`| ${x.date} | ${x.headline} | ${x.naturalness} | ${x.clarity} | ${x.issues.map((is) => `${is.type}: "${is.phrase}" → ${is.suggestion}`).join("<br>")} |`);
      }
    }
    lines.push("");
  }
  fs.writeFileSync(`${out}.md`, lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
