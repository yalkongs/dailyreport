# TODOS

Eng Review에서 도출된 후속 작업 목록.
우선순위: P1(즉시) > P2(1주 내) > P3(백로그)

---

## P2: Parser Unit Tests

RSS 파서(정규식 기반)와 KRX OTP 응답 파서에 대한 유닛 테스트 작성.
실제 응답 스냅샷을 fixture로 저장하고, 포맷 변경 시 빠르게 감지.

- [ ] `test/news-collector.test.ts` — Google News / 연합뉴스 RSS 파싱 테스트
- [ ] `test/krx-investor-flow.test.ts` — KRX OTP JSON 응답 파싱 테스트
- [ ] `test/economic-calendar.test.ts` — econdb.com 응답 파싱 테스트
- [ ] 각 테스트에 "응답 포맷 변경" 엣지 케이스 포함

## P3: Stale-Data Cache / Fallback

컨텍스트 데이터 소스가 3일 연속 실패 시, 마지막 성공 데이터를 캐시하여 fallback으로 사용.
현재는 실패 시 해당 섹션이 빈 값으로 전달됨.

- [ ] `data/context-cache.json` — 마지막 성공 응답 저장
- [ ] 캐시 TTL 정책 결정 (예: 7일 초과 시 캐시도 무효)
- [ ] 캐시 데이터 사용 시 Claude 프롬프트에 "[N일 전 데이터]" 라벨 추가

## P3: Data Licensing Review

무료 API들의 이용약관/라이선스 확인. 상업적 사용 가능 여부, 출처 표기 요구사항 점검.

- [ ] FRED API — Terms of Use 확인
- [ ] KRX — 데이터 재배포 조건 확인
- [ ] ECOS API — 한국은행 이용약관 확인
- [ ] econdb.com — 무료 티어 제한사항 확인
- [ ] CNN Fear & Greed — 비공식 API, 법적 리스크 평가
- [ ] Google News RSS — 상업적 사용 조건 확인
