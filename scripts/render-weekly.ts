// scripts/render-weekly.ts — econo(주간 전망 파이프라인)가 호출하는 렌더·준법 검사 CLI.
//
//   tsx scripts/render-weekly.ts check  <content.json>
//       매수·매도 권유 표현 검사(lib/compliance.ts). 결과 JSON을 stdout에, 위반이 있으면 exit 3.
//       주간 전망은 HARD·SOFT·ETF 목록 어느 하나에 걸려도 실패로 본다(고객용, 재작성 사유).
//   tsx scripts/render-weekly.ts render <content.json> <facts.json> <outRoot>
//       <outRoot>/public/weekly-reports/DATE.html, DATE-preview.png 생성,
//       <outRoot>/data/weekly-reports-index.json 갱신(같은 날짜는 교체). outRoot = 저장소 루트(실발행) 또는 드라이런 폴더.

import * as fs from "fs";
import * as path from "path";
import { findHardAdvice, findInvestmentAdvice, findSoftAdvice } from "../lib/compliance";
import { stripEmphasisTags } from "../lib/html-entities";
import { renderWeeklyReport, saveWeeklyPreview, WEEKLY_PUBLIC_DIR } from "../lib/weekly/renderer";
import type { WeeklyContent, WeeklyFacts, WeeklyReportMeta, WeeklyReportsIndex } from "../lib/weekly/types";

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

export function weeklyTexts(c: WeeklyContent): string[] {
  return [
    c.headline, c.subline, c.cardLine, c.closing,
    c.summary.lastWeek, c.summary.thisWeek, c.summary.outlook,
    ...c.review,
    ...c.watch.flatMap((w) => [w.title, w.body]),
    c.outlook.inflation, c.outlook.scenario, c.outlook.usRate, c.outlook.limits,
    ...c.risks.flatMap((r) => [r.title, r.ifConfirmed, r.ifNot]),
  ].map((t) => stripEmphasisTags(t ?? ""));
}

export function checkWeeklyCompliance(c: WeeklyContent): { hard: string[]; soft: string[]; etf: string[] } {
  const all = weeklyTexts(c).join("\n");
  return { hard: findHardAdvice(all), soft: findSoftAdvice(all), etf: findInvestmentAdvice(all) };
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "check") {
    const r = checkWeeklyCompliance(readJson<WeeklyContent>(args[0]));
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(r.hard.length + r.soft.length + r.etf.length > 0 ? 3 : 0);
  }
  if (cmd === "render") {
    const [contentPath, factsPath, outRoot] = args;
    const c = readJson<WeeklyContent>(contentPath);
    const f = readJson<WeeklyFacts>(factsPath);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.issue_date)) throw new Error(`issue_date 형식 오류: ${f.issue_date}`);
    const pubDir = path.join(outRoot, "public", WEEKLY_PUBLIC_DIR);
    fs.mkdirSync(pubDir, { recursive: true });
    const htmlPath = path.join(pubDir, `${f.issue_date}.html`);
    fs.writeFileSync(htmlPath, renderWeeklyReport(c, f), "utf-8");
    const pngPath = await saveWeeklyPreview(c, f, path.join(pubDir, `${f.issue_date}-preview.png`));

    const idxPath = path.join(outRoot, "data", "weekly-reports-index.json");
    fs.mkdirSync(path.dirname(idxPath), { recursive: true });
    const idx: WeeklyReportsIndex = fs.existsSync(idxPath) ? readJson(idxPath) : { reports: [], lastUpdated: "" };
    const meta: WeeklyReportMeta = {
      date: f.issue_date,
      headline: stripEmphasisTags(c.headline),
      subline: stripEmphasisTags(c.subline),
      description: stripEmphasisTags(`${c.summary.lastWeek} ${c.summary.thisWeek}`),
      filePath: `/${WEEKLY_PUBLIC_DIR}/${f.issue_date}.html`,
      previewPath: `/${WEEKLY_PUBLIC_DIR}/${f.issue_date}-preview.png`,
      generatedAt: new Date().toISOString(),
    };
    idx.reports = [meta, ...idx.reports.filter((r) => r.date !== f.issue_date)].sort((a, b) => b.date.localeCompare(a.date));
    idx.lastUpdated = meta.generatedAt;
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + "\n", "utf-8");
    process.stdout.write(JSON.stringify({ html: htmlPath, png: pngPath, index: idxPath }) + "\n");
    return;
  }
  process.stderr.write("usage: render-weekly.ts check <content.json> | render <content.json> <facts.json> <outRoot>\n");
  process.exit(2);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`render-weekly 실패: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
