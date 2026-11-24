import type { PracticeContext, StoredReport } from '../types/echo';

export interface CommunicationInsightTip {
  id: string;
  area: string;
  occurrences: number;
  totalSessions: number;
  severity: 'priority' | 'moderate' | 'polish';
  evidence: string;
  actionableTip: string;
  sampleFeedback: string | null;
  practiceContext: PracticeContext;
  drillPrompt: string;
}

interface ThemeDefinition {
  id: string;
  area: string;
  keywords: RegExp;
  practiceContext: PracticeContext;
  drillPrompt: string;
  defaultTip: string;
}

const IMPROVEMENT_THEMES: ThemeDefinition[] = [
  {
    id: 'fillers',
    area: 'Filler-Word Reduction',
    keywords: /\b(filler|um|uh|like|you know|hesitat|crutch|verbal pause|fluency)\b/i,
    practiceContext: 'Stand-up Meeting',
    drillPrompt:
      'Give a 60-second summary of your recent project progress while deliberately replacing every urge to say "um" or "like" with a one-second silent pause.',
    defaultTip:
      'Pause silently for half a second whenever you transition thoughts instead of filling silence with vocalized crutches.',
  },
  {
    id: 'pace',
    area: 'Speaking Pace & Pauses',
    keywords: /\b(pace|wpm|fast|slow|rush|speed|tempo|pause|breath|cadence|dead air|speaking time)\b/i,
    practiceContext: 'Presentation',
    drillPrompt:
      'Explain your project objective and architecture aloud at a calm, conversational 150 WPM, pausing briefly after each major sentence.',
    defaultTip:
      'Aim for 140–170 WPM and insert deliberate one-second pauses at sentence boundaries so key ideas land clearly.',
  },
  {
    id: 'structure',
    area: 'Answer Structure & STAR Framing',
    keywords: /\b(structure|star|organiz|concise|rambl|opening|closing|conclusion|transition|flow|framework|hook|narrative|context)\b/i,
    practiceContext: 'Placement Interview',
    drillPrompt:
      'Answer a behavioral prompt using explicit STAR signposts: start with a 1-sentence Situation, state your Task, walk through 2 Actions, and end with a clear Result.',
    defaultTip:
      'Lead with a one-sentence headline, signpost transitions ("first", "next", "as a result"), and close every answer with the concrete outcome.',
  },
  {
    id: 'depth',
    area: 'Concrete Evidence & Technical Depth',
    keywords: /\b(example|metric|detail|depth|specific|impact|result|quantif|trade-?off|complexity|big o|technical|substance|elaborat|evidence)\b/i,
    practiceContext: 'Project Demo',
    drillPrompt:
      'Walk through one technical decision in your project, naming the exact tool, trade-off considered, and one measurable impact or benchmark.',
    defaultTip:
      'Back up every claim with one concrete example, a technical mechanism or trade-off, and a measurable result.',
  },
  {
    id: 'phrasing',
    area: 'Phrasing Precision & Vocal Clarity',
    keywords: /\b(grammar|phrasing|wording|redundan|active verb|articula|enunciat|loud|volume|project|clarity|sentence|awkward)\b/i,
    practiceContext: 'Elevator Pitch',
    drillPrompt:
      'Deliver a crisp 45-second self-introduction using short, active-voice sentences ("I built...", "I designed...") with strong vocal projection.',
    defaultTip:
      'Favor short, active-voice sentences over long run-on clauses, and remove redundant qualifiers so your core point stands out.',
  },
  {
    id: 'presence',
    area: 'Visual Presence & Eye Contact',
    keywords: /\b(eye|camera|smile|posture|presence|visual|lens|engage|expression|warmth)\b/i,
    practiceContext: 'Placement Interview',
    drillPrompt:
      'Enable Vision in Live Coach and deliver a 60-second introduction while keeping your gaze anchored near the webcam lens with a relaxed expression.',
    defaultTip:
      'Keep your eyes focused near the camera lens when emphasizing key takeaways, and open with a natural, approachable smile.',
  },
];

function getReportFeedbackLines(report: StoredReport): string[] {
  if (report.kind === 'live') {
    const lines: string[] = [];
    if (report.aiFeedback?.areasForImprovement) {
      lines.push(...report.aiFeedback.areasForImprovement);
    }
    return lines;
  }

  const lines: string[] = [];
  if (report.evaluation?.priorityGaps) {
    lines.push(...report.evaluation.priorityGaps);
  }
  if (report.evaluation?.questionEvaluations) {
    for (const q of report.evaluation.questionEvaluations) {
      if (q.feedback) lines.push(q.feedback);
    }
  }
  return lines;
}

export function deriveDynamicCommunicationTips(
  reports: StoredReport[]
): CommunicationInsightTip[] {
  if (reports.length === 0) return [];

  const totalSessions = reports.length;

  // Aggregate quantitative context across all stored reports
  const fillerWordCounts = new Map<string, number>();
  let wpmSum = 0;
  let wpmCount = 0;
  let fastCount = 0;
  let slowCount = 0;
  let highFillerSessions = 0;
  let visionSessions = 0;
  let lowEyeSessions = 0;
  let lowSmileSessions = 0;

  for (const r of reports) {
    const m = r.kind === 'live' ? r.metrics : r.aggregateMetrics;
    if (m.wpm > 0) {
      wpmSum += m.wpm;
      wpmCount += 1;
      if (m.wpm > 175) fastCount += 1;
      if (m.wpm < 125) slowCount += 1;
    }
    if (m.fillerRatePerMin >= 4 || m.fillerCount >= 4) {
      highFillerSessions += 1;
    }
    for (const f of m.topFillers ?? []) {
      fillerWordCounts.set(f.word, (fillerWordCounts.get(f.word) ?? 0) + f.count);
    }
    if (m.visionEnabled) {
      visionSessions += 1;
      if (m.eyeContactPct < 60) lowEyeSessions += 1;
      if (m.smilePct < 20) lowSmileSessions += 1;
    }
  }

  const avgWpm = wpmCount > 0 ? Math.round(wpmSum / wpmCount) : 0;
  const topFillerEntry = Array.from(fillerWordCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  // Count how many distinct sessions exhibit each theme (via AI feedback OR metrics/scores)
  const scoredThemes = IMPROVEMENT_THEMES.map((theme) => {
    let sessionHits = 0;
    let textHits = 0;
    let sampleFeedback: string | null = null;

    for (const r of reports) {
      const lines = getReportFeedbackLines(r);
      const matchedLine = lines.find((line) => theme.keywords.test(line));
      if (matchedLine) {
        textHits += 1;
        if (!sampleFeedback) {
          sampleFeedback = matchedLine;
        }
      }

      const scores = r.kind === 'live' ? r.scores : r.speechScores;
      const metrics = r.kind === 'live' ? r.metrics : r.aggregateMetrics;

      let metricHit = false;
      if (theme.id === 'fillers' && (scores.clarity < 75 || metrics.fillerRatePerMin >= 4)) {
        metricHit = true;
      } else if (
        theme.id === 'pace' &&
        (scores.delivery < 75 || (metrics.wpm > 0 && (metrics.wpm < 125 || metrics.wpm > 175)))
      ) {
        metricHit = true;
      } else if (theme.id === 'structure' && scores.structure < 75) {
        metricHit = true;
      } else if (
        theme.id === 'presence' &&
        (scores.presence < 70 || (metrics.visionEnabled && metrics.eyeContactPct < 60))
      ) {
        metricHit = true;
      } else if (
        theme.id === 'depth' &&
        r.kind === 'interview' &&
        r.evaluation &&
        r.evaluation.questionEvaluations.some((q) => q.depth < 72)
      ) {
        metricHit = true;
      }

      if (matchedLine || metricHit) {
        sessionHits += 1;
      }
    }

    // Build personalized, data-grounded evidence and actionable tip
    let evidence = `Flagged in ${sessionHits} of ${totalSessions} ${
      totalSessions === 1 ? 'session' : 'sessions'
    }`;
    let actionableTip = theme.defaultTip;

    if (theme.id === 'fillers') {
      if (topFillerEntry) {
        evidence = `"${topFillerEntry[0]}" appeared ${topFillerEntry[1]}× across your sessions (${highFillerSessions} high-filler ${
          highFillerSessions === 1 ? 'run' : 'runs'
        })`;
        actionableTip = `Watch specifically for "${topFillerEntry[0]}" at sentence starts—hold a crisp 0.5-second silent pause instead to immediately lift Clarity.`;
      }
    } else if (theme.id === 'pace') {
      if (slowCount >= fastCount && avgWpm > 0 && avgWpm < 130) {
        evidence = `Average pace is ${avgWpm} WPM across stored sessions (below 140–170 WPM target)`;
        actionableTip =
          'Connect consecutive clauses with shorter gaps and project slight forward momentum to move from deliberate pacing into an energetic 145–160 WPM rhythm.';
      } else if (fastCount > slowCount && avgWpm > 170) {
        evidence = `Average pace is ${avgWpm} WPM across stored sessions (above 140–170 WPM target)`;
        actionableTip =
          'Slow down by ~15% on technical terms and take a full breath after each key claim so listeners can absorb your points.';
      } else if (avgWpm > 0) {
        evidence = `Pacing/pause balance flagged in ${sessionHits} of ${totalSessions} sessions (avg ${avgWpm} WPM)`;
      }
    } else if (theme.id === 'presence') {
      if (visionSessions > 0 && (lowEyeSessions > 0 || lowSmileSessions > 0)) {
        evidence = `Visual cues flagged in ${sessionHits} of ${totalSessions} sessions (${visionSessions} camera-tracked)`;
        actionableTip =
          lowEyeSessions >= lowSmileSessions
            ? 'Position your prompt near the top of your screen right beneath the webcam lens so your gaze stays aligned while thinking.'
            : 'Relax your jaw and open your first sentence with a subtle smile—MediaPipe tracks warmth alongside eye contact for Presence.';
      } else {
        evidence = `Presence flagged in ${sessionHits} of ${totalSessions} sessions (camera off in most runs)`;
        actionableTip =
          'Turn Vision ON during your next Live Coach session to get real-time eye contact and smile feedback—all processing stays locally in your browser.';
      }
    } else if (theme.id === 'structure') {
      const avgStruct = Math.round(
        reports.reduce(
          (acc, r) => acc + (r.kind === 'live' ? r.scores.structure : r.speechScores.structure),
          0
        ) / totalSessions
      );
      evidence = `Structure averaged ${avgStruct}/100 and appeared in ${sessionHits} of ${totalSessions} sessions`;
    } else if (theme.id === 'depth') {
      evidence = `Mentioned in ${sessionHits} of ${totalSessions} session reviews`;
    } else if (theme.id === 'phrasing') {
      evidence = `Highlighted in ${sessionHits} of ${totalSessions} coaching reports`;
    }

    const ratio = sessionHits / totalSessions;
    const severity: CommunicationInsightTip['severity'] =
      ratio >= 0.6 ? 'priority' : ratio >= 0.35 ? 'moderate' : 'polish';

    return {
      tip: {
        id: theme.id,
        area: theme.area,
        occurrences: sessionHits,
        totalSessions,
        severity,
        evidence,
        actionableTip,
        sampleFeedback,
        practiceContext: theme.practiceContext,
        drillPrompt: theme.drillPrompt,
      },
      sortScore: sessionHits * 10 + textHits * 3,
    };
  });

  return scoredThemes
    .filter((item) => item.tip.occurrences > 0)
    .sort((a, b) => b.sortScore - a.sortScore)
    .slice(0, 3)
    .map((item) => item.tip);
}
