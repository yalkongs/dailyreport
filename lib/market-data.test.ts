import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMODITIES, CRYPTO, HISTORICAL_SYMBOLS } from "./market-data";

// 회귀 가드: "시장 체온"(renderMarketPulse)은 commodities·crypto 전체를 표시하지만
// 스파크라인은 HISTORICAL_SYMBOLS 에서만 생성된다. 둘이 어긋나면 스파크라인이 누락된다
// (2026-05: 브렌트유·은·이더리움 누락 사고). 새 commodity·crypto 추가 시 이 테스트가 잡는다.
test("모든 commodity·crypto 심볼은 HISTORICAL_SYMBOLS 에 있어야 한다 (스파크라인 누락 방지)", () => {
  const hist = new Set(HISTORICAL_SYMBOLS.map((h) => h.symbol));
  const missing = [...COMMODITIES, ...CRYPTO]
    .filter((d) => !hist.has(d.symbol))
    .map((d) => `${d.nameKo}(${d.symbol})`);
  assert.deepEqual(missing, [], "HISTORICAL_SYMBOLS 누락 → 시장 체온 스파크라인 누락");
});
