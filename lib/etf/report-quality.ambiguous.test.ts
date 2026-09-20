import { test } from "node:test";
import assert from "node:assert/strict";
import { assessAmbiguousMarketWords } from "./report-quality";
import type { MorningReport } from "./types";

// '지수/증시/시장' 단독 표기 규칙의 적용 범위 (2026-09-21).
// 커버(헤드라인·서브라인)는 독자가 가장 먼저 보는 자리라 hard, 본문은 기록 전용.
// 최근 25회 실행에서 기각 17건이 전부 본문 쪽이었고("해외 지수 추종 ETF", "시장 주도권",
// "지수 상승분" 같은 자연스러운 표현), 그 결과 1회차 실패 68%·서사 없는 축소판 발송 28%였다.
function report(cover: { headline: string; subline: string }, body: string[]): MorningReport {
  return {
    cover,
    overnightBrief: { narrative: body[0] ?? "", krImpact: body[1] ?? "" },
    usEtfHighlights: {
      topMover: { ticker: "SPY", reason: body[2] ?? "" },
      bottomMover: { ticker: "QQQ", reason: "" },
      sectorNarrative: body[3] ?? "",
    },
    todayWatch: { items: [{ title: "T", body: body[4] ?? "" }] },
    closingLine: "",
    narrativeNotes: { bigPicture: body[5] ?? "" },
  } as unknown as MorningReport;
}

const CLEAN_COVER = { headline: "미 반도체 2.7% 상승, 국내는 엇갈려", subline: "간밤 나스닥이 1.7% 올랐습니다." };

test("본문에 시장 미특정 표현이 여러 번 나와도 커버가 깨끗하면 위반이 아니다 (실제 기각 사례)", () => {
  const r = assessAmbiguousMarketWords(
    report(CLEAN_COVER, [
      "반도체가 끌어올린 상승이었고, 지수 전체의 온도는 미지근합니다.",
      "방어 섹터도 버텨주는 그림이 나와야 오늘 지수 ETF의 신호가 탄탄해집니다.",
      "반도체 섹터가 시장 주도권을 되찾았다고 읽기에는 아직 이릅니다.",
      "환율 손실이 지수 상승분을 갉아먹는 결과가 될 수 있습니다.",
    ]),
  );
  assert.deepEqual(r.coverHits, []);
  assert.equal(r.bodyCount, 4);
});

test("본문 건수는 3에서 잘리지 않고 전부 센다 — 표본만 3개로 제한", () => {
  const r = assessAmbiguousMarketWords(
    report(CLEAN_COVER, [
      "지수 전체의 온도는 미지근합니다.",
      "오늘 지수 ETF의 신호가 관건입니다.",
      "시장 주도권은 아직 불분명합니다.",
      "지수 상승분을 갉아먹는 결과입니다.",
      "증시 분위기를 더 지켜봐야 합니다.",
    ]),
  );
  assert.equal(r.bodyCount, 5);
  assert.equal(r.bodySamples.length, 3);
});

test("커버의 미특정 표현은 여전히 위반으로 잡힌다", () => {
  const r = assessAmbiguousMarketWords(
    report({ headline: "지수 급락, 방어주가 버텼다", subline: "간밤 나스닥이 내렸습니다." }, []),
  );
  assert.equal(r.coverHits.length, 1);
});

test("커버에 시장 수식어가 있으면 통과, 그리고 커버는 본문 건수에 넣지 않는다", () => {
  const r = assessAmbiguousMarketWords(
    report({ headline: "미 증시 소폭 반등", subline: "국내 증시는 엇갈렸습니다." }, []),
  );
  assert.deepEqual(r.coverHits, []);
  assert.equal(r.bodyCount, 0);
});

// 참고: 탐지 정규식은 조사가 붙은 형태("시장의", "지수가")를 잡지 않는다 — 뒤에 한글이 오면
// 제외하는 lookahead 때문. 이 테스트들은 현재 탐지 범위(띄어 쓴 단독형) 안에서만 검증한다.
test("서브라인만 위반이어도 커버 위반이다", () => {
  const r = assessAmbiguousMarketWords(
    report({ headline: "코스피 3% 상승", subline: "오늘은 시장 방향이 관건입니다." }, []),
  );
  assert.equal(r.coverHits.length, 1);
  assert.equal(r.bodyCount, 0);
});
