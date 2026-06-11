// HTML 엔티티 디코더.
//
// scripts/run.ts 의 extractHeadlineFromHtml 이 생성된 리포트 HTML에서
// 정규식으로 헤드라인/서브라인 텍스트를 추출할 때, HTML 엔티티(&amp; 등)가
// 그대로 남아 reports-index.json 에 저장된다. 이 값이 링크 프리뷰 PNG에
// 렌더되면 "S&amp;P" 처럼 깨져 보인다(텔레그램 caption·웹페이지는 브라우저가
// 디코드해 정상). 추출 직후 이 함수로 디코드해 데이터를 정규화한다.

const NAMED_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * 흔한 HTML 엔티티를 평문으로 디코드한다.
 * &amp; 는 반드시 마지막에 처리해 이중 디코딩("&amp;lt;" → "&lt;")을 막는다.
 */
export function decodeHtmlEntities(input: string): string {
  let out = input;
  for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // 숫자 엔티티: &#39; &#x27; 등 (작은따옴표가 대표적)
  out = out.replace(/&#0*39;/g, "'").replace(/&#x0*27;/gi, "'");
  // &amp; 는 가장 마지막
  out = out.split("&amp;").join("&");
  return out;
}
