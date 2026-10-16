// Offline diagnostic of the actual strategy function, not a production regression test.
// Run at repository root: node docs/audits/2026-10-16/content/regime-check.cjs
// Reduced inputs: report-observed US/macro values, re-queried IWM/HYG history,
// and explicitly synthetic KR returns. This does not replay the original 100 quotes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('tsx/cjs');
const root = path.resolve(__dirname, '../../../..');
const { buildMorningStrategyInput } = require(path.join(root, 'lib/etf/morning-strategy.ts'));
const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'yahoo-history.json'), 'utf8'));
function historicalReturn(symbol) {
  const rows = history.find(q => q.symbol === symbol).quotes;
  const close = day => rows.find(q => q.date.slice(0, 10) === day).close;
  return (close('2026-10-15') / close('2026-10-14') - 1) * 100;
}
function quote(ticker, changePercent, market = 'US') {
  return { ticker, name: ticker, market, changePercent, price: 100,
    premiumDiscount: null, nav: null, tradingValue: null };
}
const core = {
  date: '2026-10-16',
  quotes: [quote('SPY', 0.28), quote('QQQ', -0.13), quote('IWM', historicalReturn('IWM')),
    quote('HYG', historicalReturn('HYG')), quote('TLT', 1.37), quote('SOXX', -0.91),
    quote('XLE', -1.58), quote('GLD', 1.79), quote('SLV', 3.39)],
  macro: { vix: 16.46, moveIndex: 102.49, usdKrw: 1341, dxy: 102, us10y: 5.09, wti: 96.1 },
  news: [], flows: [],
};
const results = [0, -40].map(move => {
  const input = { ...core, quotes: [...core.quotes, quote('091160.KS', move, 'KR'), quote('069500.KS', move, 'KR')] };
  const output = buildMorningStrategyInput(input);
  assert.equal(output.regime.label, 'risk_on');
  assert.equal(output.regime.confidence, 65);
  assert.equal(output.executiveSummary.tacticalStance, '공격');
  return { scenario: `synthetic-KR-${move}pct`, regime: output.regime, executiveSummary: output.executiveSummary };
});
const source = fs.readFileSync(path.join(root, 'lib/etf/morning-strategy.ts'));
const evidence = { scope: 'Reduced observed US/macro inputs and synthetic KR counterfactuals; not original full generation input.',
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  inputs: core, results };
fs.writeFileSync(path.join(__dirname, 'regime-check-result.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(results.map(r => ({ scenario: r.scenario, regime: r.regime.label,
  confidence: r.regime.confidence, stance: r.executiveSummary.tacticalStance })), null, 2));
