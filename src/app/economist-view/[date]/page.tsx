import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ViewReportsIndex } from "../../../../lib/view/types";

interface PageProps {
  params: Promise<{ date: string }>;
}

// iM뱅크 Economist View — 주간 전망 페이지(src/app/weekly-reports/[date])와 같은 구조.
// 없는 리포트·잘못된 날짜는 HTTP 404 — ETF 페이지(src/app/etf-reports/[date])와 동일.
// 예전엔 안내 컴포넌트를 200으로 반환해 가짜 날짜도 "건강한 리포트"로 판정됐다(F13).
// 날짜 형식 검사는 경로 조작(../ 등) 차단도 겸한다.
function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
}

function reportHtmlPath(date: string): string {
  return path.join(process.cwd(), "public", "economist-view", `${date}.html`);
}

function ensureReportExists(date: string): void {
  if (!fs.existsSync(reportHtmlPath(date))) notFound();
}

function getReportMeta(date: string) {
  const indexPath = path.join(process.cwd(), "data", "economist-view-index.json");
  if (!fs.existsSync(indexPath)) return null;
  const index: ViewReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.find((r) => r.date === date) || null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  // 페이지와 같은 기준(날짜 형식 → HTML 존재)으로 404 — 메타데이터만 인덱스를 따라가지 않도록
  validateDate(date);
  ensureReportExists(date);
  const report = getReportMeta(date);

  const headline = report?.headline || "iM뱅크 Economist View";
  // 2026-10 개편 이후 리포트는 세 줄 요약 한 문장(description)이 있고, 이전 리포트는 부제를 쓴다.
  const description = report?.description || "경제지표와 금융생활 사이의 시차를 설명하는 iM뱅크 경제 리포트";
  const ogImageUrl = `https://dailyreport-eta.vercel.app/economist-view/${date}-preview.png`;

  return {
    title: `${headline} - iM뱅크 Economist View`,
    description,
    openGraph: {
      title: headline,
      description,
      siteName: "iM뱅크",
      type: "article",
      images: [
        {
          url: ogImageUrl,
          width: 1080,
          height: 1350,
          alt: headline,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: headline,
      description,
      images: [ogImageUrl],
    },
  };
}

export async function generateStaticParams() {
  const indexPath = path.join(process.cwd(), "data", "economist-view-index.json");
  if (!fs.existsSync(indexPath)) return [];

  const index: ViewReportsIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  return index.reports.map((report) => ({
    date: report.date,
  }));
}

function getReportContent(date: string): string | null {
  const filePath = reportHtmlPath(date);
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
  const filePath = reportHtmlPath(date);
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

export default async function EconomistViewPage({ params }: PageProps) {
  const { date } = await params;
  validateDate(date);
  const content = getReportContent(date);

  if (!content) notFound();

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
