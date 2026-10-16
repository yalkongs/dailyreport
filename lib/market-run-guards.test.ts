import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  decideDuplicateGuard,
  decidePriceHashGuard,
  readLastDataHash,
  retryOnce,
  saveMarketReportBundle,
} from "./market-run-guards";
import type { ReportsIndex } from "./types";

const DATE = "2026-10-16";
const silent = () => {};
// 프리뷰 렌더러 스텁 — 실제 sharp 렌더 없이 경로만 돌려준다.
const okPreview = async (date: string) => `/tmp/${date}-preview.png`;

// 임시 작업 디렉터리 — 실제 data/·public/는 절대 건드리지 않는다.
function tmpWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "market-run-guards-"));
  const reportsDir = path.join(root, "public", "reports");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    root,
    paths: {
      reportsDir,
      indexPath: path.join(dataDir, "reports-index.json"),
      hashPath: path.join(dataDir, "last-data-hash.txt"),
    },
  };
}

function bundle(overrides: Partial<Parameters<typeof saveMarketReportBundle>[0]> = {}) {
  return {
    date: DATE,
    html: "<html><body>report</body></html>",
    headline: "헤드라인",
    subline: "서브라인",
    priceHash: "NEW_HASH",
    generatedAt: "2026-10-16T06:10:00+09:00",
    ...overrides,
  };
}

// --- F08: 가격 해시 가드 판정 ---

test("가격 해시: 이전과 같고 강제 아님 → skip", () => {
  assert.equal(decidePriceHashGuard({ priceHash: "A", lastHash: "A", force: false }), "skip");
  // 파일 끝 개행 등 공백 차이는 같은 해시로 본다
  assert.equal(decidePriceHashGuard({ priceHash: "A", lastHash: "A\n", force: false }), "skip");
});

test("가격 해시: 이전과 같아도 FORCE_REGENERATE면 → proceed", () => {
  assert.equal(decidePriceHashGuard({ priceHash: "A", lastHash: "A", force: true }), "proceed");
});

test("가격 해시: 이전 해시가 없거나 다르면 → proceed", () => {
  assert.equal(decidePriceHashGuard({ priceHash: "A", lastHash: null, force: false }), "proceed");
  assert.equal(decidePriceHashGuard({ priceHash: "A", lastHash: "B", force: false }), "proceed");
});

test("readLastDataHash: 파일이 없으면 null, 있으면 trim한 내용", () => {
  const { paths } = tmpWorkspace();
  assert.equal(readLastDataHash(paths.hashPath), null);
  fs.writeFileSync(paths.hashPath, "HASH\n", "utf-8");
  assert.equal(readLastDataHash(paths.hashPath), "HASH");
});

// --- F08: 해시는 HTML·인덱스 저장이 끝난 뒤에만 기록 ---

test("저장 성공 → HTML·인덱스 저장 후 해시 기록", async () => {
  const { paths } = tmpWorkspace();
  fs.writeFileSync(paths.hashPath, "OLD_HASH", "utf-8");

  const result = await saveMarketReportBundle(bundle(), paths, { renderPreview: okPreview, log: silent });

  assert.equal(fs.readFileSync(path.join(paths.reportsDir, `${DATE}.html`), "utf-8"), bundle().html);
  const index = JSON.parse(fs.readFileSync(paths.indexPath, "utf-8")) as ReportsIndex;
  assert.equal(index.reports.length, 1);
  assert.deepEqual(index.reports[0], {
    date: DATE,
    title: `iM AI Market Report - ${DATE}`,
    headline: "헤드라인",
    subline: "서브라인",
    generatedAt: "2026-10-16T06:10:00+09:00",
    filePath: `/reports/${DATE}.html`,
  });
  assert.equal(index.lastUpdated, "2026-10-16T06:10:00+09:00");
  assert.equal(fs.readFileSync(paths.hashPath, "utf-8"), "NEW_HASH");
  assert.equal(result.filePath, path.join(paths.reportsDir, `${DATE}.html`));
  assert.equal(result.isUpdate, false);
});

test("같은 날짜 재저장 → 인덱스 항목 교체(중복 추가 없음)", async () => {
  const { paths } = tmpWorkspace();
  await saveMarketReportBundle(bundle(), paths, { renderPreview: okPreview, log: silent });
  const result = await saveMarketReportBundle(bundle({ headline: "새 헤드라인" }), paths, { renderPreview: okPreview, log: silent });

  const index = JSON.parse(fs.readFileSync(paths.indexPath, "utf-8")) as ReportsIndex;
  assert.equal(index.reports.length, 1);
  assert.equal(index.reports[0].headline, "새 헤드라인");
  assert.equal(result.isUpdate, true);
});

test("저장 전 실패(HTML 쓰기 실패) → 해시 파일 그대로", async () => {
  const { paths } = tmpWorkspace();
  fs.writeFileSync(paths.hashPath, "OLD_HASH", "utf-8");
  // 리포트 경로를 디렉터리로 막아 HTML 쓰기를 실패시킨다
  fs.mkdirSync(path.join(paths.reportsDir, `${DATE}.html`));

  await assert.rejects(saveMarketReportBundle(bundle(), paths, { renderPreview: okPreview, log: silent }));

  assert.equal(fs.readFileSync(paths.hashPath, "utf-8"), "OLD_HASH");
  assert.equal(fs.existsSync(paths.indexPath), false);
});

test("인덱스 갱신 실패 → 해시 파일 그대로(재시도가 해시 가드에 막히지 않음)", async () => {
  const { paths } = tmpWorkspace();
  // 해시 파일이 아예 없던 상태도 유지돼야 한다
  fs.mkdirSync(paths.indexPath); // 인덱스 경로를 디렉터리로 막아 쓰기 실패

  await assert.rejects(saveMarketReportBundle(bundle(), paths, { renderPreview: okPreview, log: silent }));

  assert.equal(fs.existsSync(paths.hashPath), false);
});

// --- F03: 중복 실행 가드 판정 (HTML·인덱스·PNG 조합) ---

test("중복 가드: HTML·인덱스 중 하나라도 없으면 → proceed", () => {
  for (const previewExists of [true, false]) {
    for (const force of [true, false]) {
      assert.equal(decideDuplicateGuard({ htmlExists: false, indexEntryExists: false, previewExists, force }), "proceed");
      assert.equal(decideDuplicateGuard({ htmlExists: true, indexEntryExists: false, previewExists, force }), "proceed");
      assert.equal(decideDuplicateGuard({ htmlExists: false, indexEntryExists: true, previewExists, force }), "proceed");
    }
  }
});

test("중복 가드: HTML·인덱스·PNG 모두 있으면 → skip", () => {
  assert.equal(decideDuplicateGuard({ htmlExists: true, indexEntryExists: true, previewExists: true, force: false }), "skip");
});

test("중복 가드: HTML·인덱스는 있는데 PNG만 없으면 → repair-png (AI 재호출 없이 PNG만 복구)", () => {
  assert.equal(decideDuplicateGuard({ htmlExists: true, indexEntryExists: true, previewExists: false, force: false }), "repair-png");
});

test("중복 가드: FORCE_REGENERATE면 PNG 유무와 무관하게 → proceed (전체 재생성이 PNG도 다시 만든다)", () => {
  assert.equal(decideDuplicateGuard({ htmlExists: true, indexEntryExists: true, previewExists: true, force: true }), "proceed");
  assert.equal(decideDuplicateGuard({ htmlExists: true, indexEntryExists: true, previewExists: false, force: true }), "proceed");
});

// --- F03: 1회 재시도 ---

test("retryOnce: 첫 시도 성공 → 1회만 호출", async () => {
  let calls = 0;
  const value = await retryOnce(async () => { calls++; return "ok"; });
  assert.equal(value, "ok");
  assert.equal(calls, 1);
});

test("retryOnce: 1회 실패 후 성공 → 2회 호출, onRetry에 첫 오류 전달", async () => {
  let calls = 0;
  const seen: unknown[] = [];
  const value = await retryOnce(
    async () => { calls++; if (calls === 1) throw new Error("first"); return "ok"; },
    (err) => seen.push(err),
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
  assert.equal((seen[0] as Error).message, "first");
});

test("retryOnce: 2회 모두 실패 → 두 번째 오류로 reject", async () => {
  let calls = 0;
  await assert.rejects(
    retryOnce(async () => { calls++; throw new Error(`fail-${calls}`); }),
    /fail-2/,
  );
  assert.equal(calls, 2);
});

// --- F03: 발행 묶음 순서 HTML → PNG → 인덱스 → 해시 ---

test("프리뷰 PNG는 HTML 저장 뒤·인덱스 갱신 전에 헤드라인·서브라인으로 생성", async () => {
  const { paths } = tmpWorkspace();
  const seen: Array<{ args: string[]; htmlExists: boolean; indexExists: boolean }> = [];
  const result = await saveMarketReportBundle(bundle(), paths, {
    log: silent,
    renderPreview: async (date, headline, subline) => {
      seen.push({
        args: [date, headline, subline],
        htmlExists: fs.existsSync(path.join(paths.reportsDir, `${DATE}.html`)),
        indexExists: fs.existsSync(paths.indexPath),
      });
      return "/tmp/preview.png";
    },
  });
  assert.deepEqual(seen, [{ args: [DATE, "헤드라인", "서브라인"], htmlExists: true, indexExists: false }]);
  assert.equal(result.previewPath, "/tmp/preview.png");
});

test("프리뷰 PNG 1회 실패 후 재시도 성공 → 인덱스·해시 정상 기록", async () => {
  const { paths } = tmpWorkspace();
  let calls = 0;
  await saveMarketReportBundle(bundle(), paths, {
    log: silent,
    renderPreview: async () => { calls++; if (calls === 1) throw new Error("sharp 실패"); return "/tmp/p.png"; },
  });
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(paths.indexPath), true);
  assert.equal(fs.readFileSync(paths.hashPath, "utf-8"), "NEW_HASH");
});

test("프리뷰 PNG 2회 실패 → reject(비정상 종료), 인덱스·해시 미기록 — 미완성 결과가 완료로 고착되지 않음", async () => {
  const { paths } = tmpWorkspace();
  fs.writeFileSync(paths.hashPath, "OLD_HASH", "utf-8");
  let calls = 0;
  await assert.rejects(
    saveMarketReportBundle(bundle(), paths, {
      log: silent,
      renderPreview: async () => { calls++; throw new Error("sharp 실패"); },
    }),
    /sharp 실패/,
  );
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(paths.indexPath), false);
  assert.equal(fs.readFileSync(paths.hashPath, "utf-8"), "OLD_HASH");
});
