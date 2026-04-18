import fs from "fs";
import path from "path";
import type { ReportsIndex } from "../../../lib/types";

interface EtfReportMeta {
  date: string;
  type: string;
  headline: string;
  url: string;
  anomalyCount: number;
  createdAt: string;
}

interface EtfReportsIndex {
  reports: EtfReportMeta[];
}

function getMarketReports(): ReportsIndex {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) {
    return { reports: [], lastUpdated: "" };
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

function getEtfReports(): EtfReportsIndex {
  const indexPath = path.join(process.cwd(), "data", "etf-reports-index.json");
  if (!fs.existsSync(indexPath)) {
    return { reports: [] };
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일 (${days[date.getDay()]})`;
}

function groupByMonth<T extends { date: string }>(reports: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const report of reports) {
    const monthKey = report.date.substring(0, 7);
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(report);
  }
  return grouped;
}

export default function ArchivePage() {
  const marketIndex = getMarketReports();
  const etfIndex = getEtfReports();

  const marketGrouped = groupByMonth(marketIndex.reports);
  const etfGrouped = groupByMonth(etfIndex.reports);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-6 text-[var(--text)]">
        리포트 아카이브
      </h1>

      {/* 시장 리포트 섹션 */}
      <section className="mb-12">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border)]">
          <span className="text-base">📊</span>
          <h2 className="text-base font-semibold text-[var(--text)]">
            시장 리포트
          </h2>
          <span className="text-xs text-[var(--text-sub)] ml-1">
            ({marketIndex.reports.length}건)
          </span>
        </div>

        {marketIndex.reports.length === 0 ? (
          <div className="bg-[var(--card)] rounded-2xl p-8 text-center border border-[var(--border)]">
            <p className="text-sm text-[var(--text-sub)]">
              아직 생성된 시장 리포트가 없습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(marketGrouped.entries()).map(([monthKey, reports]) => {
              const [year, month] = monthKey.split("-");
              return (
                <div key={monthKey}>
                  <h3 className="text-sm font-semibold mb-3 text-[var(--teal)]">
                    {year}년 {parseInt(month)}월
                  </h3>
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
      </section>

      {/* ETF 리포트 섹션 */}
      <section>
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border)]">
          <span className="text-base">🌅</span>
          <h2 className="text-base font-semibold text-[var(--text)]">
            ETF 리포트
          </h2>
          <span className="text-xs text-[var(--text-sub)] ml-1">
            ({etfIndex.reports.length}건)
          </span>
        </div>

        {etfIndex.reports.length === 0 ? (
          <div className="bg-[var(--card)] rounded-2xl p-8 text-center border border-[var(--border)]">
            <p className="text-sm text-[var(--text-sub)]">
              아직 생성된 ETF 리포트가 없습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(etfGrouped.entries()).map(([monthKey, reports]) => {
              const [year, month] = monthKey.split("-");
              return (
                <div key={monthKey}>
                  <h3 className="text-sm font-semibold mb-3 text-[var(--teal)]">
                    {year}년 {parseInt(month)}월
                  </h3>
                  <div className="grid gap-2">
                    {reports.map((report) => (
                      <a
                        key={report.date}
                        href={`/etf-reports/${report.date}`}
                        className="flex items-center justify-between bg-[var(--card)] rounded-xl px-4 py-3 border border-[var(--border)] hover:border-[var(--teal)] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-sm font-medium text-[var(--text)] shrink-0">
                            {formatDate(report.date)}
                          </span>
                          {report.anomalyCount > 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-medium shrink-0">
                              ⚠ {report.anomalyCount}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[var(--teal)] font-medium shrink-0 ml-2">
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
      </section>
    </div>
  );
}
