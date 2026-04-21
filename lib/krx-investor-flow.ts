/**
 * DEPRECATED — KRX 투자자별 매매동향 수집기
 *
 * 2026-04-21 확인: KRX OpenAPI 공식 서비스 목록(OPPINFO004.cmd)에는
 * "투자자별 매매동향" 엔드포인트가 존재하지 않는다. 이 모듈의 이전
 * 구현(sto/stk_bydd_trd 호출)은 종목별 일별 시세 엔드포인트를 잘못
 * 지목해 INVST_TP_NM 필드를 파싱하려 했으며, 응답에 해당 필드 자체가
 * 없어 도입 이후 내내 실측 데이터 없이 0으로 채워졌거나 401로 실패했다.
 *
 * 호출부(lib/context-data.ts)의 안정성을 위해 import 경로와 반환 타입을
 * 유지한 채 null 즉시 반환으로 축소한다. 이로써 매 실행마다 15초의
 * 타임아웃 대기도 사라진다.
 *
 * 대체 데이터 소스 후보 (미검증, 향후 과제):
 *  - data.go.kr 공공데이터포털의 한국거래소 API
 *  - finance.naver.com 스크래핑 (구조 변경 리스크 큼)
 *  - KRX MDCSTAT OTP 경로 (현재 "LOGOUT" 응답으로 차단 중)
 */

import type { InvestorFlow } from "./types";

export async function collectInvestorFlow(): Promise<InvestorFlow | null> {
  return null;
}
