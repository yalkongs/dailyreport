import fs from "fs";
import path from "path";
import type { ReportsIndex } from "../../../../lib/types";

interface PageProps {
  params: Promise<{ date: string }>;
}

export async function generateStaticParams() {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) return [];

  const index: ReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.map((report) => ({
    date: report.date,
  }));
}

function reportExists(date: string): boolean {
  const filePath = path.join(process.cwd(), "public", "reports", `${date}.html`);
  return fs.existsSync(filePath);
}

export default async function ReportPage({ params }: PageProps) {
  const { date } = await params;

  if (!reportExists(date)) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="bg-[var(--card)] rounded-2xl p-12 border border-[var(--border)]">
          <h1 className="text-lg font-bold mb-3 text-[var(--text)]">
            리포트를 찾을 수 없습니다
          </h1>
          <p className="text-[var(--text-sub)] text-sm mb-6">
            {date} 날짜의 리포트가 존재하지 않습니다.
          </p>
          <a
            href="/archive"
            className="text-sm text-[#00C2A7] hover:underline font-medium"
          >
            ← 아카이브로 돌아가기
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <a
          href="/archive"
          className="text-sm text-[var(--text-sub)] hover:text-[#00C2A7] transition-colors font-medium"
        >
          ← 아카이브
        </a>
        <span className="text-sm text-[var(--text-sub)]">{date}</span>
      </div>
      <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <iframe
          src={`/reports/${date}.html`}
          className="report-frame"
          title={`iM AI Market Report - ${date}`}
        />
      </div>
    </div>
  );
}
