import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iM AI Market Report",
  description: "iM뱅크 AI가 매일 아침 전달하는 글로벌 금융 시장 리포트",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-50 bg-[var(--card)] border-b border-[var(--border)] backdrop-blur-sm bg-opacity-95">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <a href="/" className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-[var(--teal)]">iM</span>
              <span className="text-base font-semibold text-[var(--text)]">
                AI Market Report
              </span>
            </a>
            <nav className="flex items-center gap-5 text-sm">
              <a
                href="/"
                className="text-[var(--text-sub)] hover:text-[var(--teal)] transition-colors font-medium"
              >
                홈
              </a>
              <a
                href="/archive"
                className="text-[var(--text-sub)] hover:text-[var(--teal)] transition-colors font-medium"
              >
                아카이브
              </a>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="bg-[var(--card)] border-t border-[var(--border)] py-6">
          <div className="max-w-3xl mx-auto px-4 text-center text-xs text-[var(--text-sub)]">
            <p>© iM뱅크 | Powered by iM AI Analyst</p>
            <p className="mt-1 opacity-70">
              본 리포트는 AI가 자동 생성한 것으로, 투자 권유가 아닙니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
