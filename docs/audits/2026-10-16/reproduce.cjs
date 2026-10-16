/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS audit runner needs tsx/cjs and isolated require interception. */
// Offline audit probes. These assert observed defects at the audited revision,
// not desired behavior; keep separate from the normal regression suite.
// Run from the repository root: node docs/audits/2026-10-16/reproduce.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');
require('tsx/cjs');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dailyreport-audit-'));
const evidence = [];
const date = '2026-10-15';
class AuditExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}
class AuditDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-15T00:00:00Z'])); }
  static now() { return Date.parse('2026-10-15T00:00:00Z'); }
}
function load(relative, overrides = {}, options = {}) {
  const filename = path.join(root, relative);
  let source = fs.readFileSync(filename, 'utf8');
  if (options.entry) {
    // Intercept process.exit without allowing the script's error handler to
    // turn a simulated exit(0) into exit(1).
    const entryPattern = /main\(\)\.catch\(\((\w+)\) => \{/;
    assert.match(source, entryPattern);
    source = source.replace(entryPattern, 'globalThis.auditPromise = main().catch(($1) => { if ($1 instanceof AuditExit) throw $1;');
  }
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const nativeRequire = createRequire(filename);
  const sandboxModule = { exports: {} };
  const logs = [];
  const context = vm.createContext({
    module: sandboxModule, exports: sandboxModule.exports, __filename: filename, __dirname: path.dirname(filename),
    require: id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id),
    console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => logs.push(args.join(' '))])),
    process: { env: options.env || {}, cwd: () => options.cwd || scratch,
      argv: ['node', filename, ...(options.argv || [])], exit: code => { throw new AuditExit(code); } },
    Date: AuditDate, AuditExit, setTimeout, clearTimeout, URLSearchParams, AbortSignal, AbortController,
    fetch: options.fetch || (() => { throw new Error('Unexpected network access blocked by audit'); }),
  });
  vm.runInContext(code, context, { filename });
  return { exports: sandboxModule.exports, context, logs };
}
async function entry(file, overrides, options) {
  const run = load(file, overrides, { ...options, entry: true });
  let exit = 0;
  try { await run.context.auditPromise; } catch (error) {
    if (!(error instanceof AuditExit)) throw error;
    exit = error.code;
  }
  return { exit, logs: run.logs };
}
function dir(name) {
  const cwd = path.join(scratch, name);
  fs.mkdirSync(path.join(cwd, 'data'), { recursive: true });
  return cwd;
}
const marketData = {
  date, dayOfWeek: '목', collectedAt: `${date}T06:40:00+09:00`, collectionErrors: [],
  koreaStocks: [{ symbol: '^KS11', nameKo: '코스피', price: 3000, change: 1, changePercent: 0.1 }],
  usStocks: [{ symbol: '^GSPC', nameKo: 'S&P 500', price: 6000, change: 1, changePercent: 0.1 }],
  forex: [{ symbol: 'KRW=X', nameKo: '원/달러', rate: 1300, change: 1, changePercent: 0.1 }],
  europeStocks: [], japanStocks: [], chinaStocks: [], commodities: [], bonds: [], crypto: [],
};
const marketContent = {
  cover: { headline: '테스트 제목', subline: '테스트 서브라인' },
  bigStory: { content: [{ type: 'paragraph', text: '본문' }] },
  soWhat: [], watchPoints: [], compass: [], calendar: [], closingMessage: '마무리',
};
function marketOverrides(counters, failPreview = false, failGeneration = false) {
  return {
    '../lib/market-data': { collectAllMarketData: async () => { counters.collect++; return marketData; }, toKSTString: d => d.toISOString() },
    '../lib/context-data': { collectContextData: async () => { throw new Error('Context disabled'); } },
    '../lib/claude-client': { generateReport: async () => {
      counters.generate++;
      if (failGeneration) throw new Error('Injected generation outage');
      return { html: '<h1>테스트 제목</h1>', content: structuredClone(marketContent) };
    } },
    '../lib/narrative-memory': { getRecentEntries: () => [], saveNarrativeEntry: () => {} },
    '../lib/market/preview': { saveMarketPreviewImage: async () => {
      counters.preview++;
      if (failPreview) throw new Error('Injected Sharp failure');
      return 'mock-preview';
    } },
  };
}
async function probe(id, fn) {
  const detail = await fn();
  evidence.push({ id, detail });
  console.log(`${id}: ${detail}`);
}
async function main() {
  await probe('A01_market_preview_failure_persists', async () => {
    const cwd = dir('preview');
    const counters = { collect: 0, generate: 0, preview: 0 };
    const overrides = marketOverrides(counters, true);
    const first = await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true' } });
    assert.equal(first.exit, 0, first.logs.join('\n'));
    assert.ok(fs.existsSync(path.join(cwd, 'data/reports-index.json')));
    assert.ok(fs.existsSync(path.join(cwd, 'public/reports', `${date}.html`)));
    assert.equal(fs.existsSync(path.join(cwd, 'public/reports', `${date}-preview.png`)), false);
    const second = await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true' } });
    assert.equal(second.exit, 0);
    assert.equal(counters.generate, 1);
    assert.equal(counters.preview, 1);
    assert.equal(counters.collect, 2);
    return 'preview throws → exit 0 + HTML/index saved, PNG absent; retry exits 0 without repairing PNG (collection still runs)';
  });
  await probe('A02_market_force_does_not_bypass_hash', async () => {
    const cwd = dir('force');
    const counters = { collect: 0, generate: 0, preview: 0 };
    const overrides = marketOverrides(counters);
    await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true' } });
    const second = await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true', FORCE_REGENERATE: 'true' } });
    assert.equal(second.exit, 0);
    assert.equal(counters.generate, 1);
    assert.ok(second.logs.some(line => line.includes('이전과 동일')));
    return 'FORCE_REGENERATE=true logs regeneration intent but identical price hash skips the second generation';
  });
  await probe('A03_market_local_failed_generation_poison', async () => {
    const cwd = dir('failed-generation');
    const counters = { collect: 0, generate: 0, preview: 0 };
    const overrides = marketOverrides(counters, false, true);
    const first = await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true' } });
    const second = await entry('scripts/run.ts', overrides, { cwd, env: { DISABLE_CONTEXT: 'true' } });
    assert.equal(first.exit, 1);
    assert.equal(second.exit, 0);
    assert.equal(counters.generate, 1);
    assert.equal(fs.existsSync(path.join(cwd, 'data/reports-index.json')), false);
    return 'same workspace: failed generation writes hash; retry skips with exit 0 and no report (not persisted by a failed fresh Actions runner)';
  });
  await probe('A04_etf_survivor_denominator', async () => {
    const { validateData } = load('lib/etf/pipeline-utils.ts').exports;
    const { ALL_ETF_UNIVERSE } = require(path.join(root, 'lib/etf/universe.ts'));
    const quote = { ticker: 'SPY', name: 'SPY', market: 'US', price: 100, nav: null };
    assert.doesNotThrow(() => validateData([quote]));
    assert.doesNotThrow(() => validateData([{ ...quote, price: NaN }]));
    assert.doesNotThrow(() => validateData([{ ...quote, price: -1 }]));
    return `universe ${ALL_ETF_UNIVERSE.length}: one returned quote passes as 1/1; NaN and negative prices also pass`;
  });
  await probe('A05_etf_yahoo_failure_loses_krx_quote', async () => {
    class Yahoo { async quote() { throw new Error('Injected Yahoo outage'); } }
    const definition = { ticker: '069500.KS', name: 'KODEX 200', market: 'KR' };
    const { collectAllEtfData } = load('lib/etf/etf-data.ts', {
      'yahoo-finance2': Yahoo,
      './universe': { ALL_ETF_UNIVERSE: [definition], US_ETF_UNIVERSE: [], getEtfByTicker: () => definition },
      './fetcher': { fetchJson: async url => url.includes('etf_bydd_trd') ? { OutBlock_1: [{ BAS_DD: '20261014', ISU_CD: '069500', ISU_NM: 'KODEX 200', TDD_CLSPRC: '100', NAV: '100' }] } : null },
    }, { env: { KRX_AUTH_KEY: 'audit-placeholder' } }).exports;
    const data = await collectAllEtfData(date);
    assert.equal(data.krx.session, 'prev-session');
    assert.equal(data.quotes.length, 0);
    return 'valid previous-session KRX row + Yahoo outage → zero quotes; merge cannot create a quote missing from Yahoo';
  });
  await probe('A06_etf_macro_failure_is_fulfilled', async () => {
    class Yahoo { async quote() { throw new Error('Injected macro outage'); } }
    const { collectMacroContext } = load('lib/etf/market-context.ts', {
      'yahoo-finance2': Yahoo, './fetcher': { fetchJson: async () => null },
    }).exports;
    const [result] = await Promise.allSettled([collectMacroContext()]);
    assert.equal(result.status, 'fulfilled');
    assert.ok(Object.values(result.value).every(value => value === null));
    return 'every macro source fails → fulfilled object with all-null values; outer rejection-based failedSources misses macro outage';
  });
  await probe('A07_etf_fallback_calls_failed_api_again', async () => {
    const cwd = dir('etf-fallback');
    let primaryCalls = 0, rawCalls = 0;
    const quote = { ticker: 'SPY', name: 'SPY', market: 'US', price: 100, nav: null };
    const run = await entry('scripts/run-etf.ts', {
      '../lib/etf/etf-data': { collectAllEtfData: async () => ({ quotes: [quote], flows: [], investorFlows: [], krx: { basDd: null, session: 'none' } }) },
      '../lib/etf/market-context': { collectMacroContext: async () => ({}) },
      '../lib/etf/news': { collectNews: async () => [] },
      '../lib/etf/claude-client': {
        generateMorningReport: async () => { primaryCalls++; throw new Error('Injected Anthropic outage'); },
        generateMorningReportRaw: async () => { rawCalls++; throw new Error('Injected Anthropic outage'); },
        validateMorningReport: () => {},
      },
      '../lib/etf/pipeline-utils': { validateData: () => {}, loadJson: (_, fallback) => fallback, saveJson: () => {}, updateReportsIndex: () => {} },
      '../lib/etf/renderer': { renderMorningHtml: () => { throw new Error('Rendering must not be reached'); } },
    }, { cwd });
    assert.equal(run.exit, 1);
    assert.equal(primaryCalls, 2);
    assert.equal(rawCalls, 1);
    return 'two API failures → fallback makes a third API call → exit 1; Tier 1 is a prose-validation fallback, not an API outage fallback';
  });
  await probe('A08_market_hard_violation_fail_open', async () => {
    let calls = 0;
    const content = structuredClone(marketContent);
    content.cover.subline = '내일(09/15, 화) 발표';
    class Anthropic {
      constructor() { this.messages = { stream: async () => { calls++; return { finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify(content) }] }) }; } }; }
    }
    const { generateReport } = load('lib/claude-client.ts', {
      '@anthropic-ai/sdk': Anthropic,
      './report-renderer': { renderReport: () => '<html>mock-rendered</html>' },
    }).exports;
    const result = await generateReport(marketData);
    assert.equal(calls, 3);
    assert.equal(result.content.cover.subline, content.cover.subline);
    return 'out-of-window date hard violation returned by API on all three attempts → invalid content still rendered and returned successfully';
  });
  await probe('A09_delivery_resolves_report_sha_but_polls_head', async () => {
    const cwd = dir('delivery');
    const urls = [];
    const run = await entry('scripts/delivery-state.ts', {}, {
      cwd, argv: ['resolve', 'market'], env: { GITHUB_REPOSITORY: 'audit/repo' },
      fetch: async url => {
        urls.push(url);
        return { ok: true, json: async () => url.includes('/commits?')
          ? [{ sha: 'report-sha', commit: { message: `Daily Market Report - ${date} (KST)` } }]
          : { statuses: [{ context: 'telegram/market', state: 'failure' }] } };
      },
    });
    assert.equal(run.exit, 0);
    assert.ok(run.logs.includes('  output sha=report-sha'));
    assert.ok(run.logs.includes('  output action=send'));
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/daily-report.yml'), 'utf8');
    const headPolls = workflow.match(/SHA=\$\(git rev-parse HEAD\)/g) || [];
    assert.equal(headPolls.length, 2);
    return 'resolve selects report-sha for retry; both deployment polling steps independently assign SHA from current checkout HEAD';
  });
  await probe('A10_delivery_lookup_error_exits_green', async () => {
    const run = await entry('scripts/delivery-state.ts', {}, {
      cwd: dir('unknown'), argv: ['resolve', 'market'], env: { GITHUB_REPOSITORY: 'audit/repo' },
      fetch: async () => { throw new Error('Injected GitHub status outage'); },
    });
    assert.equal(run.exit, 0);
    assert.ok(run.logs.includes('  output action=unknown'));
    return 'GitHub status lookup failure → action=unknown + warning, exit 0; no failure email is guaranteed by this path';
  });
  await probe('A11_etf_body_read_timeout_cleared_early', async () => {
    let signal;
    const { fetchJson } = load('lib/etf/fetcher.ts', {}, {
      fetch: async (_, options) => {
        signal = options.signal;
        return { ok: true, json: async () => { await new Promise(resolve => setTimeout(resolve, 60)); return { done: true }; } };
      },
    }).exports;
    const result = await fetchJson('https://audit.invalid/body-stall', {}, 10);
    assert.equal(result.done, true);
    assert.equal(signal.aborted, false);
    return '10ms timeout + response headers immediately + body delayed 60ms → successful result, signal never aborted; body read is outside timeout';
  });
  await probe('A12_cross_kind_git_push_race', async () => {
    const cwd = dir('git-race');
    const git = (at, ...args) => execFileSync('git', args, { cwd: at, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = path.join(cwd, 'origin.git');
    git(cwd, 'init', '--bare', '--initial-branch=main', origin);
    for (const name of ['market', 'etf']) {
      git(cwd, 'clone', origin, name);
      const clone = path.join(cwd, name);
      git(clone, 'config', 'user.name', 'Audit');
      git(clone, 'config', 'user.email', 'audit@example.invalid');
    }
    const market = path.join(cwd, 'market'), etf = path.join(cwd, 'etf');
    fs.writeFileSync(path.join(market, 'seed.txt'), 'seed');
    git(market, 'add', '.'); git(market, 'commit', '-m', 'seed'); git(market, 'push', 'origin', 'main');
    git(etf, 'pull', 'origin', 'main');
    for (const [at, name] of [[market, 'market'], [etf, 'etf']]) {
      fs.writeFileSync(path.join(at, `${name}.txt`), name);
      git(at, 'add', '.'); git(at, 'commit', '-m', name);
      git(at, 'pull', '--rebase', 'origin', 'main');
    }
    git(market, 'push', 'origin', 'main');
    let rejected = false;
    try { git(etf, 'push', 'origin', 'main'); } catch (error) {
      rejected = /rejected|fetch first|non-fast-forward/.test(error.stderr.toString());
    }
    assert.equal(rejected, true);
    return 'two kinds each commit + pull before either pushes → market push succeeds, ETF push rejected; separate per-kind concurrency does not serialize publication';
  });
  await probe('A13_etf_invented_return_passes_quality', async () => {
    const { validateMorningReportQuality } = load('lib/etf/report-quality.ts').exports;
    const report = {
      cover: { headline: 'SOXX 99.99% 상승', subline: '미 반도체 ETF의 간밤 흐름' },
      overnightBrief: { narrative: '반도체 ETF 수익률을 살펴봅니다.', krImpact: 'SOXX 흐름을 국내 KODEX 반도체와 비교합니다.' },
      usEtfHighlights: { topMover: { ticker: 'SOXX', reason: 'SOXX가 99.99% 상승했습니다.' }, bottomMover: { ticker: 'SPY', reason: 'SPY는 보합입니다.' }, sectorNarrative: '업종별 거래대금 차이를 관찰합니다.' },
      todayWatch: { items: [
        { title: '개장', body: 'KODEX 반도체의 NAV를 비교합니다.' },
        { title: '환율', body: 'USD/KRW와 국내 ETF 가격을 대조합니다.' },
        { title: '체결', body: 'ETF 거래대금을 살펴 체결 조건을 분리합니다.' },
      ] }, closingLine: '각 상품의 기준시점을 함께 읽습니다.',
    };
    const data = { date, news: [], quotes: [{ ticker: 'SOXX', name: 'SOXX', market: 'US', price: 100, changePercent: 1 }] };
    assert.doesNotThrow(() => validateMorningReportQuality(report, data, { dataCoverage: { hasRealFlowData: false } }));
    return 'input SOXX changePercent=1, generated headline/body claim +99.99%; quality validator accepts both';
  });
  await probe('A14_deployment_api_error_aborts_retry_loop', async () => {
    const cwd = dir('poll-shell');
    const bin = path.join(cwd, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/bash\necho audit-head\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho attempt >> "$AUDIT_CALLS"\necho "simulated HTTP 503" >&2\nexit 1\n', { mode: 0o755 });
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/daily-report.yml'), 'utf8');
    const start = workflow.indexOf('          SHA=$(git rev-parse HEAD)');
    const end = workflow.indexOf('\n      - name: Send Telegram notification', start);
    assert.ok(start >= 0 && end > start);
    const script = workflow.slice(start, end).split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
    const counter = path.join(cwd, 'calls');
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, AUDIT_CALLS: counter, GITHUB_REPOSITORY: 'audit/repo' },
    });
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 1);
    assert.equal(result.stdout.includes('재시도'), false);
    return 'actual polling shell under bash -e -o pipefail: first gh 503 exits immediately, only one call; documented 60-iteration retry never runs';
  });
  console.log(JSON.stringify({ baseline: 'e5f8ef0aa4e22e724d968860f10bb0568452ca72', passed: evidence.length, evidence }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});
