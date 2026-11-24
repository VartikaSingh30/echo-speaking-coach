import type { StoredReport } from '../types/echo';

const STORAGE_KEY = 'echo_speaking_coach_reports_v1';

export function loadReports(): StoredReport[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredReport[];
  } catch {
    return [];
  }
}

export function saveReport(report: StoredReport): StoredReport[] {
  const existing = loadReports().filter((r) => r.id !== report.id);
  const updated = [report, ...existing].slice(0, 50);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage quota errors gracefully
  }
  return updated;
}

export function deleteReportById(id: string): StoredReport[] {
  const updated = loadReports().filter((r) => r.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
  return updated;
}

export function clearAllReports(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function exportReportAsMarkdown(report: StoredReport): string {
  const dateStr = new Date(report.createdAt).toLocaleString();

  if (report.kind === 'live') {
    const lines: string[] = [
      `# Echo Coaching Report — ${report.context}`,
      `Date: ${dateStr}`,
      `Topic: ${report.topic}`,
      '',
      `## Overall Score: ${report.scores.overall} / 100`,
      `- Delivery (30%): ${report.scores.delivery}/100`,
      `- Clarity (25%): ${report.scores.clarity}/100`,
      `- Presence (25%): ${report.scores.presence}/100${report.scores.visionUsed ? '' : ' (audio-only baseline)'}`,
      `- Structure (20%): ${report.scores.structure}/100`,
      '',
      `## Session Metrics`,
      `- Duration: ${Math.round(report.metrics.durationSec)}s`,
      `- Words Spoken: ${report.metrics.wordCount}`,
      `- Speaking Pace: ${report.metrics.wpm} WPM`,
      `- Filler Words: ${report.metrics.fillerCount} (${report.metrics.fillerRatePerMin}/min)`,
      `- Active Speaking Time: ${Math.round(report.metrics.speakingRatio)}%`,
    ];

    if (report.metrics.visionEnabled) {
      lines.push(`- Eye Contact Estimate: ${Math.round(report.metrics.eyeContactPct)}%`);
      lines.push(`- Smile Estimate: ${Math.round(report.metrics.smilePct)}%`);
    }

    if (report.aiFeedback) {
      lines.push('', '## AI Executive Summary', report.aiFeedback.summary, '');
      lines.push('## Strengths');
      report.aiFeedback.strengths.forEach((s) => lines.push(`- ${s}`));
      lines.push('', '## Areas for Improvement');
      report.aiFeedback.areasForImprovement.forEach((a) => lines.push(`- ${a}`));
      lines.push('', '## STAR-Format Suggestion');
      lines.push(`- **Situation:** ${report.aiFeedback.starSuggestion.situation}`);
      lines.push(`- **Task:** ${report.aiFeedback.starSuggestion.task}`);
      lines.push(`- **Action:** ${report.aiFeedback.starSuggestion.action}`);
      lines.push(`- **Result:** ${report.aiFeedback.starSuggestion.result}`);
      lines.push('', '**Polished Spoken Rewrite:**', report.aiFeedback.starSuggestion.polishedAnswer);
      lines.push('', '## 7-Day Improvement Plan');
      report.aiFeedback.sevenDayPlan.forEach((d) =>
        lines.push(`- **Day ${d.day} (${d.durationMinutes} min) — ${d.focus}:** ${d.exercise}`)
      );
    }

    lines.push('', '## Transcript', report.transcript || '(Empty)');
    return lines.join('\n');
  }

  // Mock Interview report
  const lines: string[] = [
    `# Echo Mock Interview Report — ${report.role}`,
    `Date: ${dateStr}`,
    `Difficulty: ${report.difficulty} · Focus: ${report.focus}`,
    '',
  ];

  if (report.evaluation) {
    lines.push(
      `## Readiness Indicator: ${report.evaluation.readinessLevel} (${report.evaluation.overallRubricScore}/100)`,
      report.evaluation.readinessSummary,
      '',
      '## Top Strengths',
      ...report.evaluation.topStrengths.map((s) => `- ${s}`),
      '',
      '## Priority Gaps',
      ...report.evaluation.priorityGaps.map((g) => `- ${g}`),
      ''
    );
  }

  lines.push('## Question-by-Question Review');
  report.answers.forEach((ans, idx) => {
    const evalItem = report.evaluation?.questionEvaluations[idx];
    lines.push(
      '',
      `### Q${idx + 1}: ${ans.question}`,
      `Pace: ${ans.wpm} WPM · Fillers: ${ans.fillerCount} · Duration: ${Math.round(ans.durationSec)}s`,
      `**Your Answer:** ${ans.answer || '(No answer)'}`
    );
    if (evalItem) {
      lines.push(
        `**Rubric Scores:** Relevance ${evalItem.relevance} · Clarity ${evalItem.clarity} · Structure ${evalItem.structure} · Depth ${evalItem.depth}`,
        `**Feedback:** ${evalItem.feedback}`,
        `**Suggested Model Answer:** ${evalItem.modelAnswer}`
      );
    }
  });

  return lines.join('\n');
}
