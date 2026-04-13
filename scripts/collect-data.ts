import { collectAllMarketData } from "../lib/market-data";

async function main() {
  const data = await collectAllMarketData();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("❌ 데이터 수집 실패:", err);
  process.exit(1);
});
