import * as fs from "fs";
import * as path from "path";
import { collectAllMarketData, toKSTString } from "../lib/market-data";
import { collectContextData } from "../lib/context-data";
import { generateReport } from "../lib/claude-client";
import type { AntiRepetitionContext } from "../lib/claude-client";
import type { ContextData } from "../lib/types";
import { selectAngle } from "../lib/narrative-angles";
import { analyzeSideways, selectDeepDiveTopic } from "../lib/sideways-detector";
import {
  getRecentEntries,
  saveNarrativeEntry,
} from "../lib/narrative-memory";
import { saveMarketPreviewImage } from "../lib/market/preview";
import type { ReportsIndex, ReportMeta, MarketSnapshot, MarketSnapshotItem, MarketDataCollection } from "../lib/types";

const REPORTS_DIR = path.join(process.cwd(), "public", "reports");
const INDEX_PATH = path.join(process.cwd(), "data", "reports-index.json");
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "market-snapshot.json");
const LAST_DATA_HASH_PATH = path.join(process.cwd(), "data", "last-data-hash.txt");

function ensureDirectories() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
}

function loadIndex(): ReportsIndex {
  if (fs.existsSync(INDEX_PATH)) {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  }
  return { reports: [], lastUpdated: toKSTString(new Date()) };
}

function saveIndex(index: ReportsIndex) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

function extractHeadlineFromHtml(html: string): { headline: string; subline: string } {
  // cover-headline에서 추출
  const headlineMatch = html.match(/class="cover-headline"[^>]*>([^<]+)/)
    || html.match(/class="[^"]*headline[^"]*"[^>]*>([^<]+)/)
    || html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const sublineMatch = html.match(/class="cover-subline"[^>]*>([^<]+)/)
    || html.match(/class="[^"]*subline[^"]*"[^>]*>([^<]+)/);
  return {
    headline: headlineMatch?.[1]?.trim() || "iM AI Market Report",
    subline: sublineMatch?.[1]?.trim() || "",
  };
}

function buildMarketSnapshot(data: MarketDataCollection): MarketSnapshot {
  const items: MarketSnapshotItem[] = [];

  const addIndex = (idx: { nameKo: string; price: number | null; change: number | null; changePercent: number | null }) => {
    if (idx.price == null) return;
    const pct = idx.changePercent ?? 0;
    items.push({
      name: idx.nameKo,
      value: idx.price.toLocaleString("en-US", { maximumFractionDigits: 2 }),
      change: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  };

  const addForex = (fx: { nameKo: string; rate: number | null; change: number | null; changePercent: number | null }) => {
    if (fx.rate == null) return;
    const pct = fx.changePercent ?? 0;
    items.push({
      name: fx.nameKo,
      value: fx.rate.toLocaleString("en-US", { maximumFractionDigits: 2 }),
      change: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  };

  const addCommodity = (c: { nameKo: string; price: number | null; changePercent: number | null }) => {
    if (c.price == null) return;
    const pct = c.changePercent ?? 0;
    items.push({
      name: c.nameKo,
      value: `$${c.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      change: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  };

  // 핵심 지표만 선택
  for (const idx of data.koreaStocks) addIndex(idx);
  for (const idx of data.usStocks) addIndex(idx);
  // 원/달러만
  const usdkrw = data.forex.find(f => f.symbol === "KRW=X");
  if (usdkrw) addForex(usdkrw);
  // WTI
  const wti = data.commodities.find(c => c.symbol === "CL=F");
  if (wti) addCommodity(wti);
  // 금
  const gold = data.commodities.find(c => c.symbol === "GC=F");
  if (gold) addCommodity(gold);
  // 비트코인
  const btc = data.crypto.find(c => c.symbol === "BTC-USD");
  if (btc) {
    const pct = btc.changePercent ?? 0;
    items.push({
      name: btc.nameKo,
      value: `$${(btc.price ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      change: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
      changePercent: pct,
      direction: pct > 0.01 ? "up" : pct < -0.01 ? "down" : "flat",
    });
  }

  return {
    date: data.date,
    dayOfWeek: data.dayOfWeek,
    collectedAt: data.collectedAt,
    headline: "",
    items,
  };
}

async function main() {
  console.log("🚀 iM AI Market Report 생성 파이프라인 시작\n");

  ensureDirectories();

  // Step 1: 데이터 수집
  console.log("━━━ Step 1: 시장 데이터 수집 ━━━");
  const marketData = await collectAllMarketData();
  console.log();

  // Step 1a: 중복 실행 방지 가드 — 오늘 자 리포트가 이미 있으면 종료
  // (GitHub Actions 크론 지연·수동 실행 충돌로 인한 중복 생성/텔레그램 재발송 방지)
  console.log("━━━ Step 1a: 중복 실행 방지 체크 ━━━");
  {
    const todayDate = marketData.date;
    const todayHtmlPath = path.join(REPORTS_DIR, `${todayDate}.html`);
    const existingIndex = loadIndex();
    const todayEntry = existingIndex.reports.find((r) => r.date === todayDate);

    if (fs.existsSync(todayHtmlPath) && todayEntry) {
      if (process.env.FORCE_REGENERATE === "true") {
        console.log(`⚠️ 오늘(${todayDate}) 리포트가 이미 존재하지만 FORCE_REGENERATE=true로 재생성합니다.`);
      } else {
        console.log(`✋ 오늘(${todayDate}) 리포트가 이미 존재합니다. 파이프라인을 종료합니다.`);
        console.log(`   기존 파일: ${todayHtmlPath}`);
        console.log(`   기존 헤드라인: "${todayEntry.headline}"`);
        console.log(`   기존 생성 시각: ${todayEntry.generatedAt}`);
        console.log(`   강제 재생성이 필요하면 FORCE_REGENERATE=true 환경변수로 실행하세요.`);
        process.exit(0);
      }
    } else {
      console.log(`✓ 오늘(${todayDate}) 신규 리포트 생성 진행`);
    }
  }
  console.log();

  // Step 1b: 컨텍스트 데이터 수집 (kill switch 지원)
  let contextData: ContextData | null = null;
  if (process.env.DISABLE_CONTEXT === "true") {
    console.log("━━━ Step 1b: 컨텍스트 수집 건너뜀 (DISABLE_CONTEXT=true) ━━━");
  } else {
    console.log("━━━ Step 1b: 컨텍스트 데이터 수집 ━━━");
    contextData = await collectContextData();
    console.log();
  }

  // Step 2: 수집 결과 검증
  console.log("━━━ Step 2: 수집 결과 검증 ━━━");
  const totalItems =
    marketData.koreaStocks.length +
    marketData.usStocks.length +
    marketData.europeStocks.length +
    marketData.japanStocks.length +
    marketData.chinaStocks.length +
    marketData.forex.length +
    marketData.commodities.length +
    marketData.bonds.length +
    marketData.crypto.length;

  console.log(`📋 총 ${totalItems}개 항목 수집, ${marketData.collectionErrors.length}개 실패`);

  if (marketData.collectionErrors.length > totalItems * 0.5) {
    console.error("❌ 50% 이상 데이터 수집 실패. 리포트 생성을 중단합니다.");
    process.exit(1);
  }

  // 동일 데이터 감지 — 핵심 가격 해시 비교
  const priceHash = [
    ...marketData.koreaStocks.map(s => `${s.symbol}:${s.price}`),
    ...marketData.usStocks.map(s => `${s.symbol}:${s.price}`),
    ...marketData.forex.map(f => `${f.symbol}:${f.rate}`),
  ].join("|");

  if (fs.existsSync(LAST_DATA_HASH_PATH)) {
    const lastHash = fs.readFileSync(LAST_DATA_HASH_PATH, "utf-8").trim();
    if (priceHash === lastHash) {
      console.log("⚠️ 시장 데이터가 이전과 동일합니다 (주말/휴일 가능성). 리포트 생성을 건너뜁니다.");
      process.exit(0);
    }
  }
  fs.writeFileSync(LAST_DATA_HASH_PATH, priceHash, "utf-8");
  console.log();

  // Step 3: 반복 방지 컨텍스트 구성
  console.log("━━━ Step 3: 내러티브 반복 방지 준비 ━━━");

  const recentLog = getRecentEntries(5);
  console.log(`📝 최근 내러티브 로그: ${recentLog.length}건 로드`);

  const angle = selectAngle(recentLog);
  console.log(`🎯 오늘의 앵글: "${angle.name}" (${angle.id})`);

  const sideways = analyzeSideways(marketData);
  let deepDiveTopic: string | null = null;

  if (sideways.isSideways) {
    deepDiveTopic = selectDeepDiveTopic(recentLog);
    console.log(`📊 횡보 감지! 딥다이브 모드 전환 → "${deepDiveTopic}"`);
  } else {
    console.log(`📈 시장 변동 감지 (평균 |변동률|: ${sideways.avgAbsChange.toFixed(2)}%)`);
  }
  console.log();

  // Step 4: Claude API로 리포트 생성
  console.log("━━━ Step 4: 리포트 HTML 생성 ━━━");
  const ctx: AntiRepetitionContext = {
    angle,
    recentLog,
    sideways,
    deepDiveTopic,
  };
  const { html, content: reportContent } = await generateReport(marketData, ctx, contextData);
  console.log();

  // Step 5: 파일 저장
  console.log("━━━ Step 5: 파일 저장 ━━━");
  const reportDate = marketData.date;
  const fileName = `${reportDate}.html`;
  const filePath = path.join(REPORTS_DIR, fileName);

  fs.writeFileSync(filePath, html, "utf-8");
  console.log(`💾 리포트 저장: ${filePath}`);

  // Step 6: 인덱스 업데이트
  console.log("━━━ Step 6: 인덱스 업데이트 ━━━");
  const index = loadIndex();

  const { headline, subline } = extractHeadlineFromHtml(html);
  console.log(`📰 헤드라인: "${headline}"`);

  const existingIdx = index.reports.findIndex((r) => r.date === reportDate);
  const meta: ReportMeta = {
    date: reportDate,
    title: `iM AI Market Report - ${reportDate}`,
    headline,
    subline,
    generatedAt: toKSTString(new Date()),
    filePath: `/reports/${fileName}`,
  };

  if (existingIdx >= 0) {
    index.reports[existingIdx] = meta;
    console.log(`🔄 기존 리포트 업데이트: ${reportDate}`);
  } else {
    index.reports.unshift(meta);
    console.log(`➕ 새 리포트 추가: ${reportDate}`);
  }

  index.lastUpdated = toKSTString(new Date());
  saveIndex(index);
  console.log(`📁 인덱스 업데이트 완료 (총 ${index.reports.length}건)`);
  console.log();

  // Step 6b: 링크 프리뷰 이미지 생성 (Telegram sendPhoto + OG card용)
  console.log("━━━ Step 6b: 링크 프리뷰 PNG 생성 ━━━");
  try {
    const previewPath = await saveMarketPreviewImage(reportDate, headline, subline);
    console.log(`🖼️  프리뷰 이미지: ${previewPath}`);
  } catch (err) {
    // 프리뷰 실패는 치명적 아님 — 기존 /api/og 폴백이 워크플로에 남아있다면 그걸로 처리
    console.warn(`⚠️  프리뷰 이미지 생성 실패 (계속 진행):`, err);
  }
  console.log();

  // Step 7: 내러티브 로그 저장 (JSON에서 직접 추출 — 2차 API 호출 불필요)
  console.log("━━━ Step 7: 내러티브 로그 저장 ━━━");
  {
    // Claude JSON 출력에서 직접 내러티브 요소 추출
    const soWhatTopics = reportContent.soWhat.map((s) => s.title);
    const watchTopics = reportContent.watchPoints.map((w) => w.title);
    const compassTopics = reportContent.compass.map((c) => c.title);
    const lookingAhead = reportContent.watchPoints[0]?.title || "";

    const narrativeEntry = {
      date: reportDate,
      narrativeAngle: angle.id,
      headline: reportContent.cover.headline,
      bigStoryTopic: reportContent.cover.subline.substring(0, 50),
      walletTopics: [...soWhatTopics.slice(0, 3), ...compassTopics.slice(0, 2)],
      metaphors: [], // JSON 모드에서는 별도 추출 불필요
      lookingAhead,
    };

    saveNarrativeEntry(narrativeEntry);
    console.log(`📝 내러티브 로그 저장 완료 (JSON 직접 추출): 앵글=${angle.id}, 헤드라인="${narrativeEntry.headline}"`);
  }
  console.log();

  // Step 8: 시장 데이터 스냅샷 저장 (홈 페이지 표시용)
  console.log("━━━ Step 8: 시장 스냅샷 저장 ━━━");
  const snapshot = buildMarketSnapshot(marketData);
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`📊 시장 스냅샷 저장 완료 (${snapshot.items.length}개 항목)`);
  console.log();

  console.log("✅ 파이프라인 완료!");
  console.log(`📄 리포트: ${filePath}`);
  console.log(`📅 날짜: ${reportDate} (${marketData.dayOfWeek}요일)`);
  console.log(`🎯 앵글: ${angle.name}`);
  if (sideways.isSideways) {
    console.log(`📊 모드: 딥다이브`);
  }
}

main().catch((err) => {
  console.error("❌ 파이프라인 실패:", err);
  process.exit(1);
});
