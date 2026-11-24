export type AppView = 'overview' | 'live' | 'interview' | 'reports' | 'report-detail' | 'about';

export type PracticeContext =
  | 'Placement Interview'
  | 'Presentation'
  | 'Stand-up Meeting'
  | 'Project Demo'
  | 'Elevator Pitch';

export interface FillerCountItem {
  word: string;
  count: number;
}

export interface LiveMetrics {
  durationSec: number;
  wordCount: number;
  wpm: number;
  fillerCount: number;
  fillerRatePerMin: number;
  fillerRatioPct: number;
  topFillers: FillerCountItem[];
  loudnessDb: number;
  speakingRatio: number; // % of time actively speaking
  pauseCount: number;
  visionEnabled: boolean;
  eyeContactPct: number;
  smilePct: number;
}

export interface ComponentScores {
  delivery: number; // D (0-100) — weight 0.30
  clarity: number; // C (0-100) — weight 0.25
  presence: number; // P (0-100) — weight 0.25 (0.60E + 0.40M)
  structure: number; // S (0-100) — weight 0.20
  overall: number; // T = 0.30D + 0.25C + 0.25P + 0.20S
  visionUsed: boolean;
}

export interface EnglishCoachingTip {
  original: string;
  improved: string;
  reason: string;
}

export interface StarSuggestion {
  situation: string;
  task: string;
  action: string;
  result: string;
  polishedAnswer: string;
}

export interface PracticePlanDay {
  day: number;
  focus: string;
  exercise: string;
  durationMinutes: number;
}

export interface AICoachingFeedback {
  summary: string;
  strengths: string[];
  areasForImprovement: string[];
  englishCoaching: EnglishCoachingTip[];
  starSuggestion: StarSuggestion;
  sevenDayPlan: PracticePlanDay[];
}

export interface LiveSessionReport {
  id: string;
  kind: 'live';
  createdAt: string;
  context: PracticeContext;
  topic: string;
  transcript: string;
  metrics: LiveMetrics;
  scores: ComponentScores;
  aiFeedback: AICoachingFeedback | null;
  aiError?: string;
}

export interface MockInterviewQuestion {
  id: string;
  question: string;
  category: string;
  targetCompetency: string;
  hint: string;
}

export interface MockInterviewAnswer {
  questionId: string;
  question: string;
  category: string;
  targetCompetency: string;
  answer: string;
  durationSec: number;
  wordCount: number;
  wpm: number;
  fillerCount: number;
  eyeContactPct: number;
  smilePct: number;
  visionEnabled: boolean;
}

export interface QuestionRubricEvaluation {
  questionIndex: number;
  relevance: number;
  clarity: number;
  structure: number;
  depth: number;
  overallQuestionScore: number;
  feedback: string;
  modelAnswer: string;
}

export interface MockInterviewEvaluation {
  readinessLevel: string;
  readinessSummary: string;
  overallRubricScore: number;
  questionEvaluations: QuestionRubricEvaluation[];
  topStrengths: string[];
  priorityGaps: string[];
  practicePlan: PracticePlanDay[];
}

export interface MockInterviewReport {
  id: string;
  kind: 'interview';
  createdAt: string;
  role: string;
  difficulty: string;
  focus: string;
  answers: MockInterviewAnswer[];
  aggregateMetrics: LiveMetrics;
  speechScores: ComponentScores;
  evaluation: MockInterviewEvaluation | null;
  aiError?: string;
}

export type StoredReport = LiveSessionReport | MockInterviewReport;

export interface LiveNudge {
  id: string;
  tone: 'positive' | 'caution' | 'neutral';
  label: string;
  message: string;
}
