import { test } from "node:test";
import assert from "node:assert/strict";
import { findDirectionClaimMismatches, marketDirectionAssets, etfDirectionAssets, GOLD, type DirectionAsset } from "./direction-claims";

const gold = (change: number): DirectionAsset[] => [{ label: "금", pattern: GOLD, change, minAbs: 0.3 }];

test("11-20 ETF 실문장: 금 현물 강세(입력 -1.76%) → 위반 — 같은 자산의 두 번째 언급까지 본다", () => {
  const s = "금값(Gold 3,629달러)은 견조하나 GDX 가 3.77% 하락하며 금광주 약세와 금 현물 강세가 동시에 나타났습니다.";
  assert.equal(findDirectionClaimMismatches(s, gold(-1.76)).length, 1);
  assert.deepEqual(findDirectionClaimMismatches(s, gold(+0.8)), []);
});

test("11-26 ETF 실문장: 금 현물도 강세 · 앞의 금 광산주 ETF 상승은 금의 방향이 아니다", () => {
  const s = "간밤 금 광산주 ETF( GDX )가 3.5% 넘게 올랐고 금 현물도 강세를 이어갔는데, 안전자산 선호가 나타났습니다.";
  assert.equal(findDirectionClaimMismatches(s, gold(-0.7)).length, 1);
});

test("다른 주어의 방향어는 잡지 않는다(11-03 실문장)", () => {
  const s = "S&P500은 -0.51%로 상대적으로 낙폭이 작았고, 다우존스는 유가 하락 수혜 종목이 섞이며 +0.41% 상승했습니다.";
  const assets = marketDirectionAssets({ koreaStocks: [], usStocks: [{ nameKo: "다우존스", changePercent: 0.41 }], japanStocks: [], chinaStocks: [], commodities: [], bonds: [], forex: [] });
  assert.deepEqual(findDirectionClaimMismatches(s, assets), []);
});

test("기간 비교·여부·지난 일·조건 문장은 건너뛴다(10-08·10-07·11-11 실문장)", () => {
  assert.deepEqual(findDirectionClaimMismatches("금은 1년 전 대비 +3.3% 수준으로 상승 폭이 크지 않습니다.", gold(-1.1)), []);
  const k = marketDirectionAssets({ koreaStocks: [{ nameKo: "코스피", changePercent: 4.39 }], usStocks: [], japanStocks: [], chinaStocks: [], commodities: [], bonds: [], forex: [] });
  assert.deepEqual(findDirectionClaimMismatches("코스피 반등 여부 — SK하이닉스 충격 소화", k), []);
  assert.deepEqual(findDirectionClaimMismatches("직전 거래일 코스피가 큰 폭으로 밀렸던 자리에서 나온 반등입니다.", k), []);
  assert.deepEqual(findDirectionClaimMismatches("코스피가 밀렸던 자리에서 나온 반등입니다.", k), []);
  assert.deepEqual(findDirectionClaimMismatches("금이 반등한다면 안전자산 선호가 살아난 것입니다.", gold(-1)), []);
});

test("작은 변화는 방향을 다투지 않는다 · 금리·금요일·자금의 '금'은 금이 아니다", () => {
  assert.deepEqual(findDirectionClaimMismatches("금이 소폭 올랐습니다.", gold(-0.1)), []);
  assert.deepEqual(findDirectionClaimMismatches("금리가 올랐습니다. 금요일에 자금이 올랐습니다.", gold(-2)), []);
});

test("마켓: 미 10년물 금리 방향(bp) · 국고채 10년물은 대상 아님", () => {
  const a = marketDirectionAssets({ koreaStocks: [], usStocks: [], japanStocks: [], chinaStocks: [], commodities: [], bonds: [{ symbol: "^TNX", change: -0.056 }], forex: [] });
  assert.equal(findDirectionClaimMismatches("미 10년물 금리가 0.05%p 올랐습니다.", a).length, 1);
  assert.deepEqual(findDirectionClaimMismatches("국고채 10년물 금리가 올랐습니다.", a), []);
  assert.deepEqual(findDirectionClaimMismatches("미 10년물 금리는 4.85%로 높은 수준을 유지했습니다.", a), []);
});

test("ETF: 금 ETF·금광주 ETF 상품명은 금 방향이 아니다 · 지수 별칭(S&P500·다우)", () => {
  const a = etfDirectionAssets(
    [{ nameKo: "S&P500", changePercent: -1.2 }, { nameKo: "다우", changePercent: 0.5 }],
    [{ ticker: "GLD", changePercent: -1.76 }],
    null,
  );
  assert.deepEqual(findDirectionClaimMismatches("금 ETF가 올랐습니다.", a), []);
  assert.equal(findDirectionClaimMismatches("간밤 S&P500이 1.2% 올랐습니다.", a).length, 1);
  assert.equal(findDirectionClaimMismatches("다우지수는 0.5% 하락했습니다.", a).length, 1);
});
