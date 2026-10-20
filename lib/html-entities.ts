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

// 문자 참조 풀이용 이름 표 — 흔한 것만. 모르는 이름은 그대로 둔다.
const NAMED_REFERENCES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "­",
  zwsp: "​", ZeroWidthSpace: "​", zwnj: "‌", zwj: "‍", NewLine: "\n", Tab: "\t",
  hellip: "…", middot: "·", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/**
 * 이름·10진·16진 문자 참조를 **한 번만** 푼다("&amp;nbsp;" → "&nbsp;") — Ruling 37c.
 * 권유 검사가 화면에 보이는 글자로 보게 한다("매수&nbsp;하세요" → "매수 하세요"). 모르는 이름, 0·서러게이트·범위 밖 코드는 그대로 둔다.
 */
export function decodeCharacterReferences(input: string): string {
  return input.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (ref, dec, hex, name) => {
    if (name !== undefined) return Object.prototype.hasOwnProperty.call(NAMED_REFERENCES, name) ? NAMED_REFERENCES[name] : ref;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!(code > 0) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ref;
    return String.fromCodePoint(code);
  });
}

/**
 * 인라인 강조 태그(<strong> 등)를 제거해 평문으로 만든다.
 *
 * 프롬프트(claude-client.ts)는 본문 텍스트에서 핵심 수치를 <strong>로 감싸도록
 * 지시한다. 이 마크업은 **웹 본문 볼드 렌더 전용**이며, 그 외 소비자
 * (서브라인·OG 프리뷰 이미지·메타 description·reports-index)는 HTML을 그리지
 * 못해 태그가 리터럴로 노출된다(2026-06-16 Sonnet 4.6 전환 후 서브라인에서 발생).
 * 평문 컨텍스트로 보내기 전 이 함수로 강조 태그만 벗긴다. 태그 외 stray '<'·'>'는
 * 건드리지 않으므로(부등호 등 보존) 호출부의 escapeHtml/escapeXml이 안전하게 처리.
 */
export function stripEmphasisTags(input: string): string {
  return input.replace(/<\/?(?:strong|b|em|i|u|mark)(?:\s[^>]*)?>/gi, "");
}
