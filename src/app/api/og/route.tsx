import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import type { ReportsIndex } from "../../../../lib/types";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  // 인덱스에서 헤드라인 가져오기
  let headline = "iM AI Market Report";
  let subline = "매일 아침 전달되는 글로벌 금융 시장 리포트";
  let displayDate = "";

  if (date) {
    try {
      const indexPath = path.join(process.cwd(), "data", "reports-index.json");
      if (fs.existsSync(indexPath)) {
        const index: ReportsIndex = JSON.parse(
          fs.readFileSync(indexPath, "utf-8")
        );
        const report = index.reports.find((r) => r.date === date);
        if (report) {
          headline = report.headline || headline;
          subline = report.subline || subline;
        }
      }
    } catch {
      // fallback to defaults
    }

    const [year, month, day] = date.split("-");
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    displayDate = `${year}년 ${parseInt(month)}월 ${parseInt(day)}일 ${days[d.getDay()]}요일`;
  }

  // 세로형 이미지 (600x900)
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(160deg, #00C2A7 0%, #82D94B 100%)",
          padding: "60px 50px",
          fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        }}
      >
        {/* 상단 로고 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "rgba(255,255,255,0.9)",
              letterSpacing: "-0.5px",
            }}
          >
            iM AI Market Report
          </span>
        </div>

        {/* 날짜 */}
        {displayDate && (
          <div
            style={{
              fontSize: "20px",
              color: "rgba(255,255,255,0.8)",
              marginBottom: "40px",
              fontWeight: 500,
            }}
          >
            {displayDate}
          </div>
        )}

        {/* 구분선 */}
        <div
          style={{
            width: "60px",
            height: "3px",
            background: "rgba(255,255,255,0.5)",
            marginBottom: "40px",
            borderRadius: "2px",
          }}
        />

        {/* 헤드라인 */}
        <div
          style={{
            fontSize: "44px",
            fontWeight: 800,
            color: "white",
            textAlign: "center",
            lineHeight: 1.3,
            letterSpacing: "-1px",
            maxWidth: "500px",
            marginBottom: "24px",
            textShadow: "0 2px 10px rgba(0,0,0,0.1)",
          }}
        >
          {headline}
        </div>

        {/* 서브라인 */}
        {subline && (
          <div
            style={{
              fontSize: "20px",
              color: "rgba(255,255,255,0.9)",
              textAlign: "center",
              lineHeight: 1.5,
              maxWidth: "450px",
              fontWeight: 400,
            }}
          >
            {subline}
          </div>
        )}

        {/* 하단 바이라인 */}
        <div
          style={{
            position: "absolute",
            bottom: "50px",
            fontSize: "16px",
            color: "rgba(255,255,255,0.6)",
            fontWeight: 500,
          }}
        >
          Powered by iM AI Analyst
        </div>
      </div>
    ),
    {
      width: 600,
      height: 900,
    }
  );
}
