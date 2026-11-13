// scripts/render-view.ts — econo의 Economist View 견본 파이프라인이 호출한다.
//   tsx scripts/render-view.ts check  <content.json>                      권유 표현 검사(lib/compliance.ts), 위반 시 exit 3
//   tsx scripts/render-view.ts render <content.json> <facts.json> <outRoot> HTML·카드·인덱스 생성

import * as fs from "fs";
import * as path from "path";
import { findHardAdvice, findInvestmentAdvice, findSoftAdvice } from "../lib/compliance";
import { stripEmphasisTags } from "../lib/html-entities";
import { allSentences, renderViewReport, saveViewPreview, VIEW_PUBLIC_DIR } from "../lib/view/renderer";
import type { ViewContent, ViewFacts, ViewReportMeta, ViewReportsIndex } from "../lib/view/types";

const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, "utf-8")) as T;

export function viewTexts(c: ViewContent): string[] {
  return [c.title, c.cardLine, ...allSentences(c).map((s) => s.text)].map((t) => stripEmphasisTags(t));
}

export function checkViewCompliance(c: ViewContent): { hard: string[]; soft: string[]; etf: string[] } {
  const all = viewTexts(c).join("\n");
  return { hard: findHardAdvice(all), soft: findSoftAdvice(all), etf: findInvestmentAdvice(all) };
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "check") {
    const r = checkViewCompliance(readJson<ViewContent>(args[0]));
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(r.hard.length + r.soft.length + r.etf.length > 0 ? 3 : 0);
  }
  if (cmd === "render") {
    const [cp, fp, outRoot] = args;
    const c = readJson<ViewContent>(cp);
    const f = readJson<ViewFacts>(fp);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.issue_date)) throw new Error(`issue_date 형식 오류: ${f.issue_date}`);
    const dir = path.join(outRoot, "public", VIEW_PUBLIC_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const html = path.join(dir, `${f.issue_date}.html`);
    fs.writeFileSync(html, renderViewReport(c, f), "utf-8");
    const png = await saveViewPreview(c, f, path.join(dir, `${f.issue_date}-preview.png`));
    const idxPath = path.join(outRoot, "data", "economist-view-index.json");
    fs.mkdirSync(path.dirname(idxPath), { recursive: true });
    const idx: ViewReportsIndex = fs.existsSync(idxPath) ? readJson(idxPath) : { reports: [], lastUpdated: "" };
    const meta: ViewReportMeta = {
      date: f.issue_date, headline: stripEmphasisTags(c.title),
      description: stripEmphasisTags(c.lede.map((s) => s.text).join(" ")).slice(0, 180),
      filePath: `/${VIEW_PUBLIC_DIR}/${f.issue_date}.html`, previewPath: `/${VIEW_PUBLIC_DIR}/${f.issue_date}-preview.png`,
      generatedAt: new Date().toISOString(),
    };
    idx.reports = [meta, ...idx.reports.filter((r) => r.date !== f.issue_date)].sort((a, b) => b.date.localeCompare(a.date));
    idx.lastUpdated = meta.generatedAt;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n", "utf-8");
    process.stdout.write(JSON.stringify({ html, png, index: idxPath }) + "\n");
    return;
  }
  process.stderr.write("usage: render-view.ts check <content.json> | render <content.json> <facts.json> <outRoot>\n");
  process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`render-view 실패: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
