import { NextRequest, NextResponse } from "next/server";

// 과거 호환 전용 얇은 리다이렉트.
//
// 구 리포트 HTML들은 og:image 로 /api/og?date=YYYY-MM-DD 를 가리킨다.
// 신규 리포트는 정적 /reports/<date>-preview.png 를 og:image 로 직접 쓴다
// (lib/report-renderer.ts, src/app/reports/[date]/page.tsx).
//
// 과거 이 라우트는 그린 그라데이션 카드를 동적 렌더했는데, 정적 프리뷰가
// 흰색 디자인으로 갱신된 뒤로 둘이 어긋나 텔레그램에 옛 그린이 노출되는
// 인시던트가 있었다(배포 경합 시 og:image fallback). 동적 렌더를 제거하고
// 정적 프리뷰 PNG로 일원화한다.
export function GET(request: NextRequest): NextResponse {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  const m = date.match(/^\d{4}-\d{2}-\d{2}/);
  const target = m ? `/reports/${m[0]}-preview.png` : "/reports";
  return NextResponse.redirect(new URL(target, request.url));
}
