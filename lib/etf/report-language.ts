// lib/report-language.ts
import type { MorningReport } from './types'

export function neutralizeInvestmentLanguage(text: string): string {
  return text
    .replaceAll('일반적인 매수 검토 대상', '일반 장기투자 점검 대상')
    .replaceAll('일반 매수 검토 대상', '일반 장기투자 점검 대상')
    .replaceAll('매수 검토', '거래 전 점검')
    .replaceAll('신규 진입', '추가 편입 판단')
    .replaceAll('신규 비중 확대', '추가 노출 확대')
    .replaceAll('신규 위험자산 확대', '추가 위험자산 노출 확대')
    .replaceAll('분할 접근', '단계적 판단')
    .replaceAll('선호 ETF군', '확인 우선 ETF군')
    .replaceAll('비중 확대', '노출 확대 판단')
}

export function polishKoreanReportText(text: string): string {
  return neutralizeInvestmentLanguage(text)
    .replace(/(^|[.!?]\s+)(중립·선별 국면)\./g, '$1$2입니다.')
    .replace(/(^|[.!?]\s+)(위험자산 선호 국면)\./g, '$1$2입니다.')
    .replace(/(^|[.!?]\s+)(방어 우위 국면)\./g, '$1$2입니다.')
}

function neutralizeOptional(value: string | undefined): string | undefined {
  return typeof value === 'string' ? neutralizeInvestmentLanguage(value) : value
}

export function normalizeMorningReportLanguage(report: MorningReport): MorningReport {
  const normalized: MorningReport = {
    ...report,
    cover: {
      headline: neutralizeInvestmentLanguage(report.cover.headline),
      subline: neutralizeInvestmentLanguage(report.cover.subline),
    },
    overnightBrief: {
      narrative: neutralizeInvestmentLanguage(report.overnightBrief.narrative),
      krImpact: neutralizeInvestmentLanguage(report.overnightBrief.krImpact),
    },
    usEtfHighlights: {
      topMover: {
        ...report.usEtfHighlights.topMover,
        reason: neutralizeInvestmentLanguage(report.usEtfHighlights.topMover.reason),
      },
      bottomMover: {
        ...report.usEtfHighlights.bottomMover,
        reason: neutralizeInvestmentLanguage(report.usEtfHighlights.bottomMover.reason),
      },
      sectorNarrative: neutralizeInvestmentLanguage(report.usEtfHighlights.sectorNarrative),
    },
    todayWatch: {
      items: report.todayWatch.items.map(item => ({
        title: neutralizeInvestmentLanguage(item.title),
        body: neutralizeInvestmentLanguage(item.body),
      })),
    },
    closingLine: neutralizeInvestmentLanguage(report.closingLine),
  }

  // Tier 2: narrativeNotes 의 모든 문자열 필드도 동일 규칙 적용
  // (새 필드로 "매수 후보" 같은 금지 어휘가 우회되지 않도록)
  if (report.narrativeNotes) {
    const n = report.narrativeNotes
    normalized.narrativeNotes = {
      storySpine: n.storySpine && {
        act1: neutralizeOptional(n.storySpine.act1),
        act2: neutralizeOptional(n.storySpine.act2),
        act3: neutralizeOptional(n.storySpine.act3),
      },
      characters: n.characters && {
        primary: neutralizeOptional(n.characters.primary),
        gate: neutralizeOptional(n.characters.gate),
        alternative: neutralizeOptional(n.characters.alternative),
        warning: neutralizeOptional(n.characters.warning),
      },
      resolutions: n.resolutions && {
        connect: neutralizeOptional(n.resolutions.connect),
        delay: neutralizeOptional(n.resolutions.delay),
        overheat: neutralizeOptional(n.resolutions.overheat),
      },
      checklist: n.checklist && {
        actions: n.checklist.actions?.map(s => neutralizeInvestmentLanguage(s)),
        avoids: n.checklist.avoids?.map(s => neutralizeInvestmentLanguage(s)),
      },
      strategyProse: n.strategyProse?.map(s => ({
        group: s.group,
        rationale: neutralizeOptional(s.rationale),
        actionGuide: neutralizeOptional(s.actionGuide),
        avoid: neutralizeOptional(s.avoid),
      })),
    }
  }

  return normalized
}
