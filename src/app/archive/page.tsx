import fs from "fs";
import path from "path";
import type { ReportsIndex } from "../../../lib/types";

function getReports(): ReportsIndex {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) {
    return { reports: [], lastUpdated: "" };
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일 (${days[date.getDay()]})`;
}

export default function ArchivePage() {
  const index = getReports();

  const grouped = new Map<string, typeof index.reports>();
  for (const report of index.reports) {
    const monthKey = report.date.substring(0, 7);
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(report);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-6 text-[var(--text)]">
        리포트 아카이브
      </h1>

      {index.reports.length === 0 ? (
        <div className="bg-[var(--card)] rounded-2xl p-12 text-center border border-[var(--border)]">
          <p className="text-[var(--text-sub)]">
            아직 생성된 리포트가 없습니다.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([monthKey, reports]) => {
            const [year, month] = monthKey.split("-");
            return (
              <div key={monthKey}>
                <h2 className="text-sm font-semibold mb-3 text-[var(--teal)]">
                  {year}년 {parseInt(month)}월
                </h2>
                <div className="grid gap-2">
                  {reports.map((report) => (
                    <a
                      key={report.date}
                      href={`/reports/${report.date}`}
                      className="flex items-center justify-between bg-[var(--card)] rounded-xl px-4 py-3 border border-[var(--border)] hover:border-[var(--teal)] transition-colors"
                    >
                      <span className="text-sm font-medium text-[var(--text)]">
                        {formatDate(report.date)}
                      </span>
                      <span className="text-xs text-[var(--teal)] font-medium">
                        보기 →
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
