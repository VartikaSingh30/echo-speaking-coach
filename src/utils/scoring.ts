import type {
  ComponentScores,
  FillerCountItem,
  LiveMetrics,
  LiveNudge,
} from '../types/echo';

// Multi-word fillers checked before single-word fillers to avoid double counting
export const FILLER_PHRASES = [
  'you know',
  'i mean',
  'kind of',
  'sort of',
  'so yeah',
  'like um',
  'umm',
  'uhh',
  'um',
  'uh',
  'er',
  'ah',
  'basically',
  'actually',
  'literally',
  'like',
];

const TRANSITION_MARKERS = [
  'first',
  'firstly',
  'second',
  'secondly',
  'third',
  'finally',
  'however',
  'therefore',
  'because',
  'for example',
  'for instance',
  'as a result',
  'consequently',
  'in addition',
  'specifically',
  'ultimately',
  'to summarize',
  'in conclusion',
  'overall',
  'next',
  'then',
  'after that',
];

const EXAMPLE_MARKERS = [
  'for example',
  'for instance',
  'such as',
  'in my project',
  'at my',
  'when i',
  'we built',
  'i built',
  'i led',
  'i implemented',
  'i designed',
  'reduced',
  'improved',
  'increased',
  'percent',
  '%',
];

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function detectFillers(text: string): {
  total: number;
  breakdown: FillerCountItem[];
} {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) {
    return { total: 0, breakdown: [] };
  }

  const counts = new Map<string, number>();
  let masked = normalized;

  for (const phrase of FILLER_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const matches = masked.match(regex);
    if (matches && matches.length > 0) {
      const canonical = phrase === 'umm' ? 'um' : phrase === 'uhh' ? 'uh' : phrase;
      counts.set(canonical, (counts.get(canonical) ?? 0) + matches.length);
      masked = masked.replace(regex, ' ');
    }
  }

  const breakdown: FillerCountItem[] = Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  const total = breakdown.reduce((sum, item) => sum + item.count, 0);
  return { total, breakdown };
}

export interface TranscriptSegmentPart {
  text: string;
  isFiller: boolean;
}

export function splitTranscriptWithFillers(text: string): TranscriptSegmentPart[] {
  if (!text) return [];
  const pattern = FILLER_PHRASES.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('|');
  const regex = new RegExp(`(\\b(?:${pattern})\\b)`, 'gi');
  const rawParts = text.split(regex);
  const fillerSet = new Set(FILLER_PHRASES.map((p) => p.toLowerCase()));

  return rawParts
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      isFiller: fillerSet.has(part.toLowerCase()),
    }));
}

export function calculateWpm(wordCount: number, durationSec: number): number {
  if (wordCount <= 0 || durationSec < 2) return 0;
  const minutes = durationSec / 60;
  return Math.round(wordCount / minutes);
}

export function calculateFillerRatePerMin(fillerCount: number, durationSec: number): number {
  if (fillerCount <= 0 || durationSec < 2) return 0;
  const minutes = durationSec / 60;
  return Number((fillerCount / minutes).toFixed(1));
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

/**
 * Implements Echo's documented scoring model (Report Sections 3.5 & 4.6):
 * - Delivery (D): Pace relative to documented ~160 WPM target + healthy speaking/pause balance
 * - Clarity (C): Filler-word rate per minute and filler-word density
 * - Presence (P): Exact documented formula P = 0.60E + 0.40M (when camera active)
 * - Structure (S): Transcript length, sentence coherence, transitions, examples, opening
 * - Overall (T): T = 0.30D + 0.25C + 0.25P + 0.20S
 */
export function calculateComponentScores(
  transcript: string,
  metrics: LiveMetrics
): ComponentScores {
  const words = countWords(transcript);

  // 1. Delivery Score (D) — centered on ~160 WPM reference target (135-175 optimal band)
  let paceScore = 50;
  if (metrics.wpm > 0) {
    const diff = Math.abs(metrics.wpm - 160);
    if (diff <= 18) {
      paceScore = 96 - diff * 0.4;
    } else if (diff <= 45) {
      paceScore = 88 - (diff - 18) * 1.1;
    } else {
      paceScore = Math.max(25, 58 - (diff - 45) * 0.8);
    }
  } else if (words > 0) {
    // Manual typed/pasted fallback with no live audio timer
    paceScore = 76;
  }

  // Speaking ratio & pauses component (ideal active speaking ratio ~55%-85%)
  let pauseBalanceScore = 78;
  if (metrics.durationSec >= 10 && metrics.speakingRatio > 0) {
    if (metrics.speakingRatio >= 50 && metrics.speakingRatio <= 85) {
      pauseBalanceScore = 92;
    } else if (metrics.speakingRatio > 85) {
      // Very little pausing / rushing
      pauseBalanceScore = Math.max(60, 92 - (metrics.speakingRatio - 85) * 1.6);
    } else {
      // Long silences
      pauseBalanceScore = Math.max(40, 92 - (50 - metrics.speakingRatio) * 1.1);
    }
  }
  const delivery = clampScore(0.72 * paceScore + 0.28 * pauseBalanceScore);

  // 2. Clarity Score (C) — based on filler-word rate & ratio
  const ratePenalty = metrics.fillerRatePerMin * 7.2;
  const ratioPenalty = metrics.fillerRatioPct * 4.5;
  const clarity =
    words === 0
      ? 0
      : clampScore(100 - Math.max(ratePenalty, ratioPenalty));

  // 3. Presence Score (P) — exact documented formula P = 0.60E + 0.40M
  const presence = metrics.visionEnabled
    ? clampScore(0.6 * metrics.eyeContactPct + 0.4 * metrics.smilePct)
    : clampScore(Math.min(82, Math.max(58, 65 + (metrics.speakingRatio > 40 ? 10 : 0))));

  // 4. Structure Score (S) — length, sentence coherence, transitions, examples, opening
  const lower = transcript.toLowerCase();
  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => countWords(s) >= 3);

  // Length adequacy (0-28 pts)
  const lengthPts =
    words >= 90 ? 28 : words >= 45 ? 22 : words >= 20 ? 15 : Math.min(12, words * 0.6);

  // Sentence coherence & pacing (0-22 pts)
  let coherencePts = 12;
  if (sentences.length >= 3) {
    const avgWordsPerSentence = words / sentences.length;
    if (avgWordsPerSentence >= 8 && avgWordsPerSentence <= 26) {
      coherencePts = 22;
    } else {
      coherencePts = 16;
    }
  } else if (words >= 35) {
    // Web Speech API often omits punctuation; credit reasonable length
    coherencePts = 16;
  }

  // Transitions (0-20 pts)
  const transitionHits = TRANSITION_MARKERS.filter((m) => lower.includes(m)).length;
  const transitionPts = Math.min(20, 6 + transitionHits * 4.5);

  // Concrete examples / metrics (0-18 pts)
  const exampleHits = EXAMPLE_MARKERS.filter((m) => lower.includes(m)).length;
  const hasNumbers = /\b\d+(?:\.\d+)?%?\b/.test(transcript);
  const examplePts = Math.min(18, 4 + exampleHits * 4.5 + (hasNumbers ? 5 : 0));

  // Clear opening (0-12 pts)
  const firstTenWords = lower.split(/\s+/).slice(0, 10).join(' ');
  const startsWithFiller = /^(um|uh|like|so yeah|basically)\b/.test(firstTenWords.trim());
  const openingPts = words >= 12 ? (startsWithFiller ? 6 : 12) : 4;

  const structure =
    words === 0
      ? 0
      : clampScore(lengthPts + coherencePts + transitionPts + examplePts + openingPts);

  // 5. Overall Score (T) = 0.30D + 0.25C + 0.25P + 0.20S
  const overall = clampScore(
    0.3 * delivery + 0.25 * clarity + 0.25 * presence + 0.2 * structure
  );

  return {
    delivery,
    clarity,
    presence,
    structure,
    overall,
    visionUsed: metrics.visionEnabled,
  };
}

export function generateLiveNudges(
  metrics: LiveMetrics,
  isRecording: boolean
): LiveNudge[] {
  if (!isRecording) {
    return [
      {
        id: 'idle',
        tone: 'neutral',
        label: 'Ready',
        message: 'Start your session to receive real-time pacing, filler, and visual presence cues.',
      },
    ];
  }

  const nudges: LiveNudge[] = [];

  if (metrics.durationSec >= 6 && metrics.wpm > 0) {
    if (metrics.wpm > 180) {
      nudges.push({
        id: 'pace-fast',
        tone: 'caution',
        label: 'Pace High',
        message: `Speaking at ${metrics.wpm} WPM — slow down slightly and breathe between ideas.`,
      });
    } else if (metrics.wpm < 115) {
      nudges.push({
        id: 'pace-slow',
        tone: 'caution',
        label: 'Pace Low',
        message: `Speaking at ${metrics.wpm} WPM — pick up momentum toward 140–170 WPM.`,
      });
    } else {
      nudges.push({
        id: 'pace-good',
        tone: 'positive',
        label: 'Steady Pace',
        message: `Great tempo (${metrics.wpm} WPM) — right inside the conversational target range.`,
      });
    }
  }

  if (metrics.fillerRatePerMin >= 6) {
    const top = metrics.topFillers[0]?.word ?? 'filler words';
    nudges.push({
      id: 'filler-high',
      tone: 'caution',
      label: 'Filler Alert',
      message: `High filler rate (${metrics.fillerRatePerMin}/min, mostly "${top}") — pause silently instead.`,
    });
  } else if (metrics.wordCount >= 25 && metrics.fillerCount <= 1) {
    nudges.push({
      id: 'filler-clean',
      tone: 'positive',
      label: 'Clean Delivery',
      message: 'Minimal filler words detected — keep using crisp pauses.',
    });
  }

  if (metrics.visionEnabled && metrics.durationSec >= 5) {
    if (metrics.eyeContactPct < 48) {
      nudges.push({
        id: 'eye-low',
        tone: 'caution',
        label: 'Eye Contact',
        message: 'Bring your gaze back toward the camera lens to strengthen visual engagement.',
      });
    } else if (metrics.eyeContactPct >= 70) {
      nudges.push({
        id: 'eye-good',
        tone: 'positive',
        label: 'Strong Presence',
        message: 'Consistent camera eye contact — you look attentive and composed.',
      });
    }
  }

  if (metrics.durationSec >= 5 && metrics.loudnessDb < -44) {
    nudges.push({
      id: 'volume-low',
      tone: 'caution',
      label: 'Projection',
      message: 'Microphone level is quiet — speak slightly louder or move closer to your mic.',
    });
  }

  if (nudges.length === 0) {
    nudges.push({
      id: 'keep-going',
      tone: 'positive',
      label: 'On Track',
      message: 'Listening closely — keep speaking naturally and structure your key points.',
    });
  }

  return nudges.slice(0, 3);
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
