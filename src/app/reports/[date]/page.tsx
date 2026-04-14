import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import type { ReportsIndex } from "../../../../lib/types";

interface PageProps {
  params: Promise<{ date: string }>;
}

function getReportMeta(date: string) {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) return null;
  const index: ReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.find((r) => r.date === date) || null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  const report = getReportMeta(date);

  const headline = report?.headline || "iM AI Market Report";
  const subline = report?.subline || "매일 아침 전달되는 글로벌 금융 시장 리포트";
  const ogImageUrl = `/api/og?date=${date}`;

  return {
    title: `${headline} - iM AI Market Report`,
    description: subline,
    openGraph: {
      title: headline,
      description: subline,
      type: "article",
      images: [
        {
          url: ogImageUrl,
          width: 600,
          height: 900,
          alt: headline,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: headline,
      description: subline,
      images: [ogImageUrl],
    },
  };
}

export async function generateStaticParams() {
  const indexPath = path.join(process.cwd(), "data", "reports-index.json");
  if (!fs.existsSync(indexPath)) return [];

  const index: ReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.map((report) => ({
    date: report.date,
  }));
}

function getReportContent(date: string): string | null {
  const filePath = path.join(process.cwd(), "public", "reports", `${date}.html`);
  if (!fs.existsSync(filePath)) return null;

  const html = fs.readFileSync(filePath, "utf-8");

  // <body>...</body> 내부 콘텐츠만 추출
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  // body 태그가 없으면 전체 반환 (style 포함)
  // <!DOCTYPE>, <html>, <head> 제거
  return html
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .replace(/<html[^>]*>/i, "")
    .replace(/<\/html>/i, "")
    .replace(/<head>[\s\S]*?<\/head>/i, "")
    .trim();
}

function getReportStyles(date: string): string {
  const filePath = path.join(process.cwd(), "public", "reports", `${date}.html`);
  if (!fs.existsSync(filePath)) return "";

  const html = fs.readFileSync(filePath, "utf-8");

  // 모든 <style> 블록 추출
  const styles: string[] = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styles.push(match[1]);
  }
  return styles.join("\n");
}

export default async function ReportPage({ params }: PageProps) {
  const { date } = await params;
  const content = getReportContent(date);

  if (!content) {
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
            className="text-sm text-[var(--teal)] hover:underline font-medium"
          >
            ← 아카이브로 돌아가기
          </a>
        </div>
      </div>
    );
  }

  const styles = getReportStyles(date);

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="mb-4 flex items-center justify-between px-4">
        <a
          href="/archive"
          className="text-sm text-[var(--text-sub)] hover:text-[var(--teal)] transition-colors font-medium"
        >
          ← 아카이브
        </a>
        <span className="text-sm text-[var(--text-sub)]">{date}</span>
      </div>
      <div className="report-embed">
        {styles && (
          <style dangerouslySetInnerHTML={{ __html: styles }} />
        )}
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
}
