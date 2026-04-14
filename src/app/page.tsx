import fs from "fs";
import path from "path";
import type { ReportsIndex, MarketSnapshot } from "../../lib/types";

function getReportContent(filePath: string): { body: string; styles: string } | null {
  const fullPath = path.join(process.cwd(), "public", filePath.replace(/^\//, ""));
  if (!fs.existsSync(fullPath)) return null;

  const html = fs.readFileSync(fullPath, "utf-8");

  // <style> 추출
  const styles: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }

  // <body> 내부 추출
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch
    ? bodyMatch[1]
    : html
        .replace(/<!DOCTYPE[^>]*>/i, "")
        .replace(/<html[^>]*>/i, "")
        .replace(/<\/html>/i, "")
        .replace(/<head>[\s\S]*?<\/head>/i, "")
        .trim();

  return { body, styles: styles.join("\n") };
}

function getLatestReport(): { date: string; filePath: string } | null {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) return null;
  const index: ReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  if (index.reports.length === 0) return null;
  return index.reports[0];
}

function getRecentReports(skip: number = 1, count: number = 5) {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) return [];
  const index: ReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.slice(skip, skip + count);
}

function getMarketSnapshot(): MarketSnapshot | null {
  const snapshotPath = path.join(process.cwd(), "data", "market-snapshot.json");
  if (!fs.existsSync(snapshotPath)) return null;
  return JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${parseInt(month)}월 ${parseInt(day)}일 (${days[date.getDay()]})`;
}

export default function Home() {
  const latest = getLatestReport();
  const snapshot = getMarketSnapshot();
  const recentReports = getRecentReports();

  if (!latest) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="bg-[var(--card)] rounded-2xl p-12 border border-[var(--border)]">
          <div className="text-4xl mb-4">📊</div>
          <h1 className="text-xl font-bold mb-3 text-[var(--text)]">
            iM AI Market Report
          </h1>
          <p className="text-[var(--text-sub)] text-sm">
            아직 생성된 리포트가 없습니다.
            <br />
            매일 오전 7시(KST)에 새로운 리포트가 자동으로 생성됩니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* 핵심 수치 바 */}
      {snapshot && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-sub)]">
              시장 요약
            </h2>
            <span className="text-xs text-[var(--text-sub)] opacity-60">
              {snapshot.date} ({snapshot.dayOfWeek}) 기준
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {snapshot.items.map((item) => {
              const absPct = Math.abs(item.changePercent);
              let bgOpacity = 0.04;
              if (absPct > 5) bgOpacity = 0.25;
              else if (absPct > 2) bgOpacity = 0.15;
              else if (absPct > 1) bgOpacity = 0.1;
              else if (absPct > 0.3) bgOpacity = 0.06;

              const bgColor =
                item.direction === "up"
                  ? `rgba(211, 47, 47, ${bgOpacity})`
                  : item.direction === "down"
                  ? `rgba(21, 101, 192, ${bgOpacity})`
                  : "transparent";

              return (
                <div
                  key={item.name}
                  className="rounded-xl px-3 py-2.5 border border-[var(--border)]"
                  style={{ backgroundColor: bgColor }}
                >
                  <div className="text-[11px] text-[var(--text-sub)] mb-0.5 truncate">
                    {item.name}
                  </div>
                  <div className="text-sm font-bold text-[var(--text)] tabular-nums text-right">
                    {item.value}
                  </div>
                  <div
                    className="text-xs font-semibold tabular-nums text-right"
                    style={{
                      color:
                        item.direction === "up"
                          ? "#D32F2F"
                          : item.direction === "down"
                          ? "#1565C0"
                          : "var(--text-sub)",
                    }}
                  >
                    {item.direction === "up" ? "▲" : item.direction === "down" ? "▼" : "—"}{" "}
                    {item.change}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 오늘의 리포트 */}
      <section className="-mx-4 sm:mx-0">
        <div className="flex items-center justify-between mb-3 px-4 sm:px-0">
          <h2 className="text-sm font-semibold text-[var(--text-sub)]">
            오늘의 리포트
          </h2>
          <a
            href={`/reports/${latest.date}`}
            className="text-xs text-[var(--teal)] font-medium hover:underline"
          >
            전체 보기 →
          </a>
        </div>
        {(() => {
          const reportData = getReportContent(latest.filePath);
          if (!reportData) return null;
          return (
            <div className="sm:rounded-2xl sm:border sm:border-[var(--border)] overflow-hidden report-embed">
              <style dangerouslySetInnerHTML={{ __html: reportData.styles }} />
              <div dangerouslySetInnerHTML={{ __html: reportData.body }} />
            </div>
          );
        })()}
      </section>

      {/* 최근 리포트 */}
      {recentReports.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--text-sub)]">
              이전 리포트
            </h2>
            <a
              href="/archive"
              className="text-xs text-[var(--teal)] font-medium hover:underline"
            >
              전체 보기 →
            </a>
          </div>
          <div className="grid gap-2">
            {recentReports.map((report) => (
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
        </section>
      )}
    </div>
  );
}
