import * as fs from "fs";
import * as path from "path";
import { collectAllMarketData } from "../lib/market-data";
import { generateReport } from "../lib/claude-client";
import type { AntiRepetitionContext } from "../lib/claude-client";
import { selectAngle } from "../lib/narrative-angles";
import { analyzeSideways, selectDeepDiveTopic } from "../lib/sideways-detector";
import {
  getRecentEntries,
  extractNarrativeFromHtml,
  saveNarrativeEntry,
} from "../lib/narrative-memory";
import type { ReportsIndex, ReportMeta, MarketSnapshot, MarketSnapshotItem, MarketDataCollection } from "../lib/types";

const REPORTS_DIR = path.join(process.cwd(), "public", "reports");
const INDEX_PATH = path.join(process.cwd(), "data", "reports-index.json");
const SNAPSHOT_PATH = path.join(process.cwd(), "data", "market-snapshot.json");

function ensureDirectories() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(INDEX_PATH), { recursive: true });
}

function loadIndex(): ReportsIndex {
  if (fs.existsSync(INDEX_PATH)) {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  }
  return { reports: [], lastUpdated: new Date().toISOString() };
}

function saveIndex(index: ReportsIndex) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
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
  const html = await generateReport(marketData, ctx);
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

  const existingIdx = index.reports.findIndex((r) => r.date === reportDate);
  const meta: ReportMeta = {
    date: reportDate,
    title: `iM AI Market Report - ${reportDate}`,
    generatedAt: new Date().toISOString(),
    filePath: `/reports/${fileName}`,
  };

  if (existingIdx >= 0) {
    index.reports[existingIdx] = meta;
    console.log(`🔄 기존 리포트 업데이트: ${reportDate}`);
  } else {
    index.reports.unshift(meta);
    console.log(`➕ 새 리포트 추가: ${reportDate}`);
  }

  index.lastUpdated = new Date().toISOString();
  saveIndex(index);
  console.log(`📁 인덱스 업데이트 완료 (총 ${index.reports.length}건)`);
  console.log();

  // Step 7: 내러티브 로그 저장 (다음 날 반복 방지용)
  console.log("━━━ Step 7: 내러티브 로그 저장 ━━━");
  try {
    const narrativeEntry = await extractNarrativeFromHtml(html, reportDate, angle.id);
    saveNarrativeEntry(narrativeEntry);
    console.log(`📝 내러티브 로그 저장 완료: 앵글=${angle.id}, 헤드라인="${narrativeEntry.headline}"`);
  } catch (err) {
    // 로그 추출 실패해도 리포트 자체는 이미 생성/저장됨 — fallback 저장
    console.log(`⚠️ 내러티브 추출 API 실패, 기본 로그로 저장`);
    saveNarrativeEntry({
      date: reportDate,
      narrativeAngle: angle.id,
      headline: "",
      bigStoryTopic: "",
      walletTopics: [],
      metaphors: [],
      lookingAhead: "",
    });
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
