// Market 파이프라인(scripts/run.ts)의 가드 판정과 발행 묶음 저장.
// run.ts는 import 시점에 main()을 실행하므로, 테스트 가능한 로직만 여기로 분리한다.
// (lib/market-data 등 외부 API 모듈은 import하지 않는다 — 테스트가 네트워크 없이 돌아야 함)

import * as fs from "fs";
import * as path from "path";
import type { ReportMeta, ReportsIndex } from "./types";

// --- 가격 해시 가드 ---
// 핵심 가격이 직전 성공 실행과 같으면(주말·휴일 가능성) 생성을 건너뛴다.
// FORCE_REGENERATE는 파일 중복 가드뿐 아니라 이 가드도 우회한다.

export type PriceHashAction = "proceed" | "skip";

export function decidePriceHashGuard(input: {
  priceHash: string;
  lastHash: string | null;
  force: boolean;
}): PriceHashAction {
  if (input.force) return "proceed";
  if (input.lastHash !== null && input.lastHash.trim() === input.priceHash) return "skip";
  return "proceed";
}

export function readLastDataHash(hashPath: string): string | null {
  if (!fs.existsSync(hashPath)) return null;
  return fs.readFileSync(hashPath, "utf-8").trim();
}

// --- 발행 묶음 저장 ---
// 순서: HTML → 인덱스 → 가격 해시(마지막).
// 해시는 리포트가 실제로 저장된 뒤에만 기록한다 — 생성·저장 실패 후 같은 작업
// 디렉터리에서 재시도할 때 해시 가드가 "동일 데이터"로 오판해 리포트 없이
// exit 0 하던 문제(F08) 방지.

export interface MarketReportBundle {
  date: string; // YYYY-MM-DD
  html: string;
  headline: string;
  subline: string;
  priceHash: string;
  generatedAt: string; // KST ISO 8601 (인덱스 generatedAt·lastUpdated)
}

export interface MarketBundlePaths {
  reportsDir: string;
  indexPath: string;
  hashPath: string;
}

export interface SaveBundleOptions {
  log?: (message: string) => void;
}

export interface SaveBundleResult {
  filePath: string;
  isUpdate: boolean;
  totalReports: number;
}

function loadIndexOrEmpty(indexPath: string, fallbackLastUpdated: string): ReportsIndex {
  if (fs.existsSync(indexPath)) {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  }
  return { reports: [], lastUpdated: fallbackLastUpdated };
}

export async function saveMarketReportBundle(
  bundle: MarketReportBundle,
  paths: MarketBundlePaths,
  options: SaveBundleOptions = {},
): Promise<SaveBundleResult> {
  const log = options.log ?? console.log;
  const fileName = `${bundle.date}.html`;
  const filePath = path.join(paths.reportsDir, fileName);

  // 1) 리포트 HTML
  fs.writeFileSync(filePath, bundle.html, "utf-8");
  log(`💾 리포트 저장: ${filePath}`);

  // 2) 인덱스
  const index = loadIndexOrEmpty(paths.indexPath, bundle.generatedAt);
  const meta: ReportMeta = {
    date: bundle.date,
    title: `iM AI Market Report - ${bundle.date}`,
    headline: bundle.headline,
    subline: bundle.subline,
    generatedAt: bundle.generatedAt,
    filePath: `/reports/${fileName}`,
  };
  const existingIdx = index.reports.findIndex((r) => r.date === bundle.date);
  const isUpdate = existingIdx >= 0;
  if (isUpdate) {
    index.reports[existingIdx] = meta;
    log(`🔄 기존 리포트 업데이트: ${bundle.date}`);
  } else {
    index.reports.unshift(meta);
    log(`➕ 새 리포트 추가: ${bundle.date}`);
  }
  index.lastUpdated = bundle.generatedAt;
  fs.writeFileSync(paths.indexPath, JSON.stringify(index, null, 2), "utf-8");
  log(`📁 인덱스 업데이트 완료 (총 ${index.reports.length}건)`);

  // 3) 가격 해시 — 반드시 마지막
  fs.writeFileSync(paths.hashPath, bundle.priceHash, "utf-8");

  return { filePath, isUpdate, totalReports: index.reports.length };
}
