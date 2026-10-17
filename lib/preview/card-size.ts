// 링크 미리보기 카드 PNG 크기(1080×1350, spec §4) — og:image:width/height가 쓰는 값.
// 부수 효과·import 없는 모듈로 둔다: Next 페이지(report-preview → page.tsx)가 이 값을 쓰면서
// 카드 렌더러(data-card.ts → sharp)를 끌어오지 않게 한다.
export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350
