/**
 * 히스토리컬 데이터를 기반으로 pulse-card 내부에 삽입할 미니 스파크라인 SVG를 생성합니다.
 * 스케일을 정확히 반영합니다.
 */
import type { HistoricalComparison } from "./types";

interface ChartPoint {
  value: number;
}

/**
 * 미니 스파크라인 SVG 생성 (pulse-card 좌측에 삽입용)
 */
function generateSparkline(points: ChartPoint[], isUp: boolean): string {
  if (points.length < 2) return "";

  const W = 72;
  const H = 28;
  const pad = 2;
  const chartW = W - pad * 2;
  const chartH = H - pad * 2;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || rawMax * 0.05 || 1;
  const margin = range * 0.1;
  const yMin = rawMin - margin;
  const yMax = rawMax + margin;

  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * chartW;
    const y = pad + chartH - ((p.value - yMin) / (yMax - yMin)) * chartH;
    return { x, y };
  });

  const polyPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const areaPath = [
    `M ${coords[0].x.toFixed(1)} ${(pad + chartH).toFixed(1)}`,
    `L ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`,
    ...coords.slice(1).map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`),
    `L ${coords[coords.length - 1].x.toFixed(1)} ${(pad + chartH).toFixed(1)}`,
    "Z",
  ].join(" ");

  const color = isUp ? "#D32F2F" : "#1565C0";
  const uid = `sp${Math.random().toString(36).slice(2, 8)}`;

  return `<svg width="72" height="28" viewBox="0 0 ${W} ${H}" style="display:block"><defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.2"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs><path d="${areaPath}" fill="url(#${uid})"/><polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${coords[coords.length - 1].x.toFixed(1)}" cy="${coords[coords.length - 1].y.toFixed(1)}" r="2" fill="${color}"/></svg>`;
}

/**
 * 히스토리컬 데이터에서 nameKo → 스파크라인 SVG 맵을 생성
 */
export function buildSparklineMap(data: HistoricalComparison[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!data || data.length === 0) return map;

  for (const item of data) {
    const points: ChartPoint[] = [];
    if (item.oneYearAgo != null) points.push({ value: item.oneYearAgo });
    if (item.threeMonthsAgo != null) points.push({ value: item.threeMonthsAgo });
    if (item.oneMonthAgo != null) points.push({ value: item.oneMonthAgo });
    if (item.oneWeekAgo != null) points.push({ value: item.oneWeekAgo });
    points.push({ value: item.current });

    if (points.length >= 3) {
      const isUp = points[points.length - 1].value >= points[0].value;
      const svg = generateSparkline(points, isUp);
      if (svg) {
        map.set(item.nameKo, svg);
      }
    }
  }

  return map;
}

/**
 * 리포트 HTML의 pulse-card에 스파크라인을 주입합니다.
 *
 * 전략: pulse-card 내부의 .label 텍스트를 찾아 매칭.
 * 매칭된 카드의 .label 바로 앞에 스파크라인 SVG를 삽입하고,
 * pulse-card에 flex 레이아웃을 적용합니다.
 */
export function injectSparklines(html: string, data: HistoricalComparison[]): string {
  const sparkMap = buildSparklineMap(data);
  if (sparkMap.size === 0) return html;

  // <!-- HISTORICAL_CHARTS --> 플레이스홀더 제거
  html = html.replace(/<!--\s*HISTORICAL_CHARTS\s*-->/g, "");

  // 모든 .label 태그를 순회하며 sparkMap과 매칭
  // 정확 매칭 우선, 부분 매칭(label이 name을 포함 또는 name이 label을 포함) 허용
  const labelRegex = /(<div\s+class="label"[^>]*>)\s*([^<]+)\s*(<\/div>)/g;

  html = html.replace(labelRegex, (match, openTag, labelText, closeTag) => {
    const trimmed = labelText.trim();

    // 1. 정확 매칭
    let svg = sparkMap.get(trimmed);

    // 2. 부분 매칭: sparkMap 키가 label을 포함하거나, label이 키를 포함
    if (!svg) {
      for (const [name, sparkSvg] of sparkMap) {
        if (name.includes(trimmed) || trimmed.includes(name)) {
          svg = sparkSvg;
          break;
        }
      }
    }

    if (!svg) return match;

    return `<div style="flex-shrink:0">${svg}</div><div style="flex:1;min-width:0">${openTag}${labelText}${closeTag}`;
  });

  // 스파크라인이 삽입된 pulse-card에 flex 레이아웃 추가
  // 스파크라인 div가 삽입된 카드를 찾아 flex 스타일 적용
  html = html.replace(
    /(<div\s+class="pulse-card[^"]*")(\s*>)\s*<div style="flex-shrink:0">/g,
    (_, cardOpen, close) => {
      return `${cardOpen} style="display:flex;align-items:center;gap:8px"${close}<div style="flex-shrink:0">`;
    }
  );

  // 스파크라인이 있는 카드에서 내부 content div를 닫기
  // 현재: ...change</div> 바로 뒤의 </div>가 pulse-card 닫힘
  // 삽입 후: <div style="flex:1">..label..value..change..</div></div> 가 되어야 함
  // flex:1 div의 닫기 태그를 change div 뒤에 추가
  html = html.replace(
    /(<div style="flex:1;min-width:0">[\s\S]*?<div class="change[^"]*"[^>]*>[^<]*<\/div>)\s*(<\/div>)/g,
    (_, content, closingDiv) => {
      return `${content}</div>${closingDiv}`;
    }
  );

  return html;
}

// 하위 호환용 — 더 이상 별도 chart-card를 생성하지 않음
export function generateHistoricalCharts(): string {
  return "";
}
