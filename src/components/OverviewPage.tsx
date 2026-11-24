import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Camera,
  Check,
  FileText,
  Gauge,
  Lightbulb,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  Volume2,
} from 'lucide-react';
import { deriveDynamicCommunicationTips } from '../utils/insights';
import type { AppView, PracticeContext, StoredReport } from '../types/echo';

interface OverviewPageProps {
  reports: StoredReport[];
  aiConfigured: boolean | null;
  onStartLiveWithContext: (context: PracticeContext, topic?: string) => void;
  onStartInterviewWithRole: (role?: string) => void;
  onNavigate: (view: AppView) => void;
  onOpenReport: (report: StoredReport) => void;
}

const WEEKLY_GOAL_STORAGE_KEY = 'echo_weekly_practice_goal_v1';

const CONTEXT_OPTIONS: {
  context: PracticeContext;
  duration: string;
  summary: string;
}[] = [
  {
    context: 'Placement Interview',
    duration: '1–2 min',
    summary: 'Behavioral and technical answers with STAR feedback',
  },
  {
    context: 'Presentation',
    duration: '2–4 min',
    summary: 'Classroom seminars, slides, and audience pacing',
  },
  {
    context: 'Stand-up Meeting',
    duration: '45–90 sec',
    summary: 'Concise daily status updates without filler words',
  },
  {
    context: 'Project Demo',
    duration: '2–3 min',
    summary: 'Explaining architecture, trade-offs, and results',
  },
  {
    context: 'Elevator Pitch',
    duration: '60 sec',
    summary: 'Sharp self-introduction and personal value proposition',
  },
];

const QUICK_INTERVIEW_ROLES: {
  role: string;
  focus: string;
}[] = [
  { role: 'Software Engineer', focus: 'DSA, system thinking & STAR teamwork' },
  { role: 'Frontend Developer', focus: 'UI architecture, performance & debugging' },
  { role: 'Backend Developer', focus: 'APIs, data modeling & reliability' },
  { role: 'Data Analyst', focus: 'Metrics, SQL reasoning & storytelling' },
  { role: 'Product Manager', focus: 'Prioritization, user trade-offs & execution' },
];

type PromptCategory = 'Behavioral (STAR)' | 'Technical Explain' | 'Presentation Hook' | 'Quick Pitch';

interface PracticePromptCard {
  id: string;
  category: PromptCategory;
  context: PracticeContext;
  prompt: string;
  structureHint: string;
  targetSec: string;
}

const PROMPT_DECK: PracticePromptCard[] = [
  {
    id: 'beh-1',
    category: 'Behavioral (STAR)',
    context: 'Placement Interview',
    prompt:
      'Tell me about a challenging bug or project roadblock you faced recently, how you diagnosed it, and what changed as a result.',
    structureHint: 'Situation (15s) · Task (10s) · Action (45s) · Measurable Result (20s)',
    targetSec: '90 sec',
  },
  {
    id: 'beh-2',
    category: 'Behavioral (STAR)',
    context: 'Placement Interview',
    prompt:
      'Describe a time you had to learn an unfamiliar technology quickly to meet a tight deadline.',
    structureHint: 'Context → Learning Strategy → Execution → Final Outcome',
    targetSec: '90 sec',
  },
  {
    id: 'beh-3',
    category: 'Behavioral (STAR)',
    context: 'Placement Interview',
    prompt:
      'Share an example of when you received tough feedback on your work and how you responded.',
    structureHint: 'Feedback Context → Openness → Concrete Revision → Impact',
    targetSec: '75 sec',
  },
  {
    id: 'tech-1',
    category: 'Technical Explain',
    context: 'Project Demo',
    prompt:
      'Walk through the architecture of your proudest software project and explain one key engineering trade-off you made.',
    structureHint: 'Problem → High-Level Flow → Key Trade-off → Outcome',
    targetSec: '2 min',
  },
  {
    id: 'tech-2',
    category: 'Technical Explain',
    context: 'Project Demo',
    prompt:
      'Explain how a REST API differs from a WebSocket connection and when you would choose each in a real web application.',
    structureHint: 'Plain Definition → Real-World Analogy → Concrete Use Cases',
    targetSec: '90 sec',
  },
  {
    id: 'pres-1',
    category: 'Presentation Hook',
    context: 'Presentation',
    prompt:
      'Open your project presentation by stating the real-world problem, why existing approaches fall short, and what your solution delivers.',
    structureHint: 'Hook Question → Gap in Existing Tools → Your Solution in 1 Sentence',
    targetSec: '60 sec',
  },
  {
    id: 'pres-2',
    category: 'Presentation Hook',
    context: 'Presentation',
    prompt:
      'Summarize the main results, limitations, and future scope of your capstone project to a panel of faculty reviewers.',
    structureHint: 'Core Result → Honest Limitation → Clear Next Milestone',
    targetSec: '90 sec',
  },
  {
    id: 'pitch-1',
    category: 'Quick Pitch',
    context: 'Elevator Pitch',
    prompt:
      'Introduce yourself in 60 seconds: your academic background, your strongest technical skills, a project you built, and the role you are targeting.',
    structureHint: 'Present Role → Proof Project → Future Goal',
    targetSec: '60 sec',
  },
  {
    id: 'pitch-2',
    category: 'Quick Pitch',
    context: 'Stand-up Meeting',
    prompt:
      'Deliver a crisp daily stand-up: what you shipped yesterday, your top focus today, and one dependency you need help resolving.',
    structureHint: 'Completed → Today’s Priority → Blocker / Ask',
    targetSec: '45 sec',
  },
];

const PROMPT_CATEGORIES: PromptCategory[] = [
  'Behavioral (STAR)',
  'Technical Explain',
  'Presentation Hook',
  'Quick Pitch',
];

function getReportScore(report: StoredReport): number {
  if (report.kind === 'live') return report.scores.overall;
  return report.evaluation?.overallRubricScore ?? report.speechScores.overall;
}

function getReportWpm(report: StoredReport): number {
  if (report.kind === 'live') return report.metrics.wpm;
  return report.aggregateMetrics.wpm;
}

function getReportFillerRate(report: StoredReport): number {
  if (report.kind === 'live') return report.metrics.fillerRatePerMin;
  return report.aggregateMetrics.fillerRatePerMin;
}

function getReportScoresObj(report: StoredReport) {
  return report.kind === 'live' ? report.scores : report.speechScores;
}

export function OverviewPage({
  reports,
  aiConfigured,
  onStartLiveWithContext,
  onStartInterviewWithRole,
  onNavigate,
  onOpenReport,
}: OverviewPageProps) {
  // Interactive Hero Quick Launcher Tab
  const [launcherTab, setLauncherTab] = useState<'live' | 'interview'>('live');

  // Interactive Prompt Deck State
  const [promptCategory, setPromptCategory] = useState<PromptCategory>('Behavioral (STAR)');
  const [promptOffset, setPromptOffset] = useState(0);

  // Interactive Trend Metric Selector
  const [trendMetric, setTrendMetric] = useState<'score' | 'wpm' | 'fillers'>('score');

  // Interactive Weekly Goal (persisted in browser localStorage)
  const [weeklyGoal, setWeeklyGoal] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(WEEKLY_GOAL_STORAGE_KEY));
      return saved === 3 || saved === 5 || saved === 7 ? saved : 5;
    } catch {
      return 5;
    }
  });

  // Live 10-second Web Audio Microphone Sound Check
  const [micTesting, setMicTesting] = useState(false);
  const [micLevelPct, setMicLevelPct] = useState(0);
  const [micDb, setMicDb] = useState(-60);
  const [micCheckError, setMicCheckError] = useState<string | null>(null);
  const [micVerified, setMicVerified] = useState(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micRafRef = useRef<number | null>(null);

  const stopMicCheck = () => {
    if (micRafRef.current !== null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (micCtxRef.current) {
      micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }
    setMicTesting(false);
    setMicLevelPct(0);
    setMicDb(-60);
  };

  useEffect(() => {
    return () => {
      stopMicCheck();
    };
  }, []);

  const toggleMicCheck = async () => {
    if (micTesting) {
      stopMicCheck();
      return;
    }
    setMicCheckError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micCtxRef.current = ctx;

      setMicTesting(true);
      const data = new Float32Array(analyser.fftSize);
      let lastTick = 0;

      const tick = (now: number) => {
        micRafRef.current = requestAnimationFrame(tick);
        if (now - lastTick < 65) return;
        lastTick = now;

        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const db = rms > 0.0001 ? Math.max(-60, Math.min(0, Math.round(20 * Math.log10(rms)))) : -60;
        const pct = Math.min(100, Math.max(0, Math.round(((db + 60) / 55) * 100)));
        setMicDb(db);
        setMicLevelPct(pct);
        if (db > -40) {
          setMicVerified(true);
        }
      };

      micRafRef.current = requestAnimationFrame(tick);
    } catch {
      setMicCheckError('Microphone permission denied or no mic detected.');
      stopMicCheck();
    }
  };

  const handleSetWeeklyGoal = (goal: number) => {
    setWeeklyGoal(goal);
    try {
      window.localStorage.setItem(WEEKLY_GOAL_STORAGE_KEY, String(goal));
    } catch {
      // Ignore storage error
    }
  };

  // Filtered Prompts
  const categoryPrompts = useMemo(
    () => PROMPT_DECK.filter((p) => p.category === promptCategory),
    [promptCategory]
  );
  const activePrompt = categoryPrompts[promptOffset % categoryPrompts.length] ?? PROMPT_DECK[0];

  // Aggregate Real Metrics
  const totalSessions = reports.length;
  const avgScore =
    totalSessions > 0
      ? Math.round(reports.reduce((acc, r) => acc + getReportScore(r), 0) / totalSessions)
      : null;
  const wpmList = reports.map(getReportWpm).filter((v) => v > 0);
  const avgWpm =
    wpmList.length > 0
      ? Math.round(wpmList.reduce((acc, v) => acc + v, 0) / wpmList.length)
      : null;
  const avgFillers =
    totalSessions > 0
      ? (reports.reduce((acc, r) => acc + getReportFillerRate(r), 0) / totalSessions).toFixed(1)
      : null;

  // Component averages across all sessions
  const componentAverages = useMemo(() => {
    if (reports.length === 0) return null;
    const totals = reports.reduce(
      (acc, r) => {
        const s = getReportScoresObj(r);
        acc.delivery += s.delivery;
        acc.clarity += s.clarity;
        acc.presence += s.presence;
        acc.structure += s.structure;
        return acc;
      },
      { delivery: 0, clarity: 0, presence: 0, structure: 0 }
    );
    const n = reports.length;
    return [
      {
        key: 'delivery',
        label: 'Delivery',
        weight: '30%',
        value: Math.round(totals.delivery / n),
        tip: 'Keep a steady 140–170 WPM cadence with deliberate pauses.',
      },
      {
        key: 'clarity',
        label: 'Clarity',
        weight: '25%',
        value: Math.round(totals.clarity / n),
        tip: 'Replace "um", "uh", and "like" with brief silent pauses.',
      },
      {
        key: 'presence',
        label: 'Presence',
        weight: '25%',
        value: Math.round(totals.presence / n),
        tip: 'Enable Vision in Live Coach to practice camera eye contact and warmth.',
      },
      {
        key: 'structure',
        label: 'Structure',
        weight: '20%',
        value: Math.round(totals.structure / n),
        tip: 'Use STAR framing and explicit transitions ("first", "as a result").',
      },
    ];
  }, [reports]);

  const weakestComponent = useMemo(() => {
    if (!componentAverages) return null;
    return [...componentAverages].sort((a, b) => a.value - b.value)[0];
  }, [componentAverages]);

  // Last 7 days session count & daily activity
  const last7Days = useMemo(() => {
    const days: { key: string; label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
      const count = reports.filter((r) => r.createdAt.slice(0, 10) === key).length;
      days.push({ key, label, count });
    }
    return days;
  }, [reports]);

  const sessionsThisWeek = last7Days.reduce((s, d) => s + d.count, 0);
  const goalPct = Math.min(100, Math.round((sessionsThisWeek / weeklyGoal) * 100));

  // Trend chart series (last 8 sessions chronological)
  const trendSeries = useMemo(() => {
    const slice = [...reports].slice(0, 8).reverse();
    return slice.map((r, idx) => {
      const value =
        trendMetric === 'score'
          ? getReportScore(r)
          : trendMetric === 'wpm'
          ? getReportWpm(r)
          : getReportFillerRate(r);
      return {
        id: r.id,
        idx: idx + 1,
        label: new Date(r.createdAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        value,
      };
    });
  }, [reports, trendMetric]);

  const trendMax =
    trendMetric === 'score'
      ? 100
      : trendMetric === 'wpm'
      ? Math.max(200, ...trendSeries.map((p) => p.value))
      : Math.max(8, ...trendSeries.map((p) => p.value));

  const dynamicTips = useMemo(() => deriveDynamicCommunicationTips(reports), [reports]);

  return (
    <div className="relative overflow-x-clip">
      {/* Subtle Studio Spotlight Atmosphere */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] bg-[radial-gradient(ellipse_75%_55%_at_25%_0%,rgba(16,185,129,0.11)_0%,rgba(7,11,9,0)_72%)]"
      />

      <div className="relative mx-auto max-w-[1360px] px-6 py-10 space-y-12">
        {/* HERO SECTION */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Hero Column */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-7">
            <div className="space-y-4">
              <p className="text-xs font-medium text-emerald-400">
                Real-Time Speaking Studio · Browser Speech &amp; On-Device Vision · Free Stack
              </p>
              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.08] max-w-2xl [text-wrap:balance]">
                Speak clearly, pace with confidence, and ace every interview.
              </h1>
              <p className="text-base text-[#A3B5AB] leading-relaxed max-w-xl">
                Echo listens live in your browser to measure speaking pace, filler-word rate, vocal
                projection, and optional on-device eye contact and smile cues—then turns every
                practice run into a structured AI coaching report or rubric-scored mock interview.
              </p>
            </div>

            <div className="space-y-4">
              {/* Primary Action Row */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onStartLiveWithContext('Placement Interview')}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-[#04120B] transition-colors duration-150 hover:bg-emerald-400 cursor-pointer whitespace-nowrap"
                >
                  <Mic className="h-4 w-4" />
                  Start Live Coaching
                </button>
                <button
                  type="button"
                  onClick={() => onStartInterviewWithRole()}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.14] bg-[#0F1713] px-5 py-3 text-sm font-medium text-[#E4EFE8] transition-colors duration-150 hover:bg-[#16211C] hover:border-white/[0.24] cursor-pointer whitespace-nowrap"
                >
                  <Briefcase className="h-4 w-4 text-emerald-400" />
                  Launch Mock Interview
                </button>
                <button
                  type="button"
                  onClick={toggleMicCheck}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-medium transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                    micTesting
                      ? 'border-emerald-500/45 bg-emerald-500/12 text-emerald-200'
                      : 'border-white/[0.1] bg-[#0B110E] text-[#9EB2A7] hover:text-white hover:border-white/[0.2]'
                  }`}
                >
                  {micTesting ? (
                    <>
                      <MicOff className="h-3.5 w-3.5 text-emerald-400" />
                      Stop Mic Check
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                      {micVerified ? 'Mic Ready · Test Again' : 'Quick Mic Check'}
                    </>
                  )}
                </button>
              </div>

              {/* Interactive Live Mic Sound-Check Bar (shown when active or on error) */}
              {(micTesting || micCheckError) && (
                <div className="rounded-lg border border-white/[0.09] bg-[#0B110E] px-4 py-3 max-w-xl space-y-2">
                  {micCheckError ? (
                    <p className="text-xs text-amber-300">{micCheckError}</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#C8D7CE] font-medium">
                          {micVerified
                            ? 'Microphone signal verified — ready for live transcription'
                            : 'Speak a test phrase to check your microphone level...'}
                        </span>
                        <span className="font-mono tabular-nums text-emerald-400">
                          {micDb} dB
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all duration-75"
                          style={{ width: `${micLevelPct}%` }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {aiConfigured === false && (
                <p className="text-xs text-amber-300/90">
                  Note: Server GEMINI_API_KEY is not configured yet. Live transcription, metrics,
                  and MediaPipe visual analysis work immediately; add GEMINI_API_KEY in Settings
                  &gt; Secrets to enable AI reports and mock interviews.
                </p>
              )}
            </div>
          </div>

          {/* Right Hero Anchor: Interactive 2-Tab Studio Quick Launcher */}
          <div className="lg:col-span-5 rounded-xl border border-white/[0.1] bg-[#0C1310] p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
                <h2 className="font-display text-base font-semibold text-white">
                  Quick Launch Studio
                </h2>
                <div className="flex items-center gap-1 rounded-lg bg-[#070B09] p-1 border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setLauncherTab('live')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      launcherTab === 'live'
                        ? 'bg-[#17241D] text-white'
                        : 'text-[#83978C] hover:text-white'
                    }`}
                  >
                    Live Coach
                  </button>
                  <button
                    type="button"
                    onClick={() => setLauncherTab('interview')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      launcherTab === 'interview'
                        ? 'bg-[#17241D] text-white'
                        : 'text-[#83978C] hover:text-white'
                    }`}
                  >
                    Mock Interview
                  </button>
                </div>
              </div>

              {launcherTab === 'live' ? (
                <div className="divide-y divide-white/[0.06] mt-1">
                  {CONTEXT_OPTIONS.map((opt) => (
                    <button
                      key={opt.context}
                      type="button"
                      onClick={() => onStartLiveWithContext(opt.context)}
                      className="group w-full flex items-center justify-between gap-4 py-3 text-left transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#E8F1EC] group-hover:text-emerald-300 transition-colors">
                            {opt.context}
                          </span>
                          <span className="font-mono text-[11px] text-[#6E8277]">
                            {opt.duration}
                          </span>
                        </div>
                        <div className="text-xs text-[#7E9287] mt-0.5 truncate">{opt.summary}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[#5D7267] group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-white/[0.06] mt-1">
                  {QUICK_INTERVIEW_ROLES.map((item) => (
                    <button
                      key={item.role}
                      type="button"
                      onClick={() => onStartInterviewWithRole(item.role)}
                      className="group w-full flex items-center justify-between gap-4 py-3 text-left transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#E8F1EC] group-hover:text-emerald-300 transition-colors">
                          {item.role}
                        </div>
                        <div className="text-xs text-[#7E9287] mt-0.5 truncate">{item.focus}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[#5D7267] group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 mt-2 border-t border-white/[0.07] flex items-center justify-between text-xs text-[#7C9085]">
              <span>Weighted Scoring: 30% D · 25% C · 25% P · 20% S</span>
              <button
                type="button"
                onClick={() => onNavigate('about')}
                className="text-emerald-400 hover:text-emerald-300 cursor-pointer whitespace-nowrap"
              >
                Methodology
              </button>
            </div>
          </div>
        </section>

        {/* 4-COLUMN KPI SUMMARY STRIP */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-5 border-y border-white/[0.08] py-6">
          <div className="space-y-1">
            <div className="text-xs text-[#7F9489]">Completed Sessions</div>
            <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-white">
              {totalSessions}
            </div>
            <div className="text-xs text-[#697D72]">
              {sessionsThisWeek} in the last 7 days · Stored locally
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-[#7F9489]">Average Score</div>
            <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-emerald-400">
              {avgScore !== null ? `${avgScore}/100` : '—'}
            </div>
            <div className="text-xs text-[#697D72]">Directional coaching indicator</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-[#7F9489]">Average Pace</div>
            <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-white">
              {avgWpm !== null ? `${avgWpm} WPM` : '—'}
            </div>
            <div className="text-xs text-[#697D72]">Optimal band 140–170 WPM</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-[#7F9489]">Avg Filler Rate</div>
            <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-white">
              {avgFillers !== null ? `${avgFillers}/min` : '—'}
            </div>
            <div className="text-xs text-[#697D72]">Aim below 4 fillers per minute</div>
          </div>
        </section>

        {/* INTERACTIVE DAILY WARM-UP & SPEAKING PROMPT DECK */}
        <section className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 sm:p-7 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Guided Practice Prompt Deck
              </h2>
              <p className="text-xs text-[#83988C] mt-0.5">
                Pick a category, shuffle a realistic prompt, and jump straight into Live Coach
                pre-loaded with that topic
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[#070B09] p-1 border border-white/[0.08]">
              {PROMPT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setPromptCategory(cat);
                    setPromptOffset(0);
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    promptCategory === cat
                      ? 'bg-[#17241D] text-white'
                      : 'text-[#83978C] hover:text-[#DCE7E0]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#080C0A] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#84998E]">
                <span className="text-emerald-400 font-medium">{activePrompt.context}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">Target {activePrompt.targetSec}</span>
                <span aria-hidden="true">·</span>
                <span>{activePrompt.structureHint}</span>
              </div>
              <p className="font-display text-lg sm:text-xl font-semibold text-white leading-snug">
                &ldquo;{activePrompt.prompt}&rdquo;
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setPromptOffset((n) => n + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0E1512] px-3.5 py-2.5 text-xs font-medium text-[#CBD9D1] hover:text-white hover:border-white/[0.22] transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Next Prompt
              </button>
              <button
                type="button"
                onClick={() => onStartLiveWithContext(activePrompt.context, activePrompt.prompt)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                Practice This Prompt
              </button>
            </div>
          </div>
        </section>

        {/* PERFORMANCE HUB: ANALYTICS & RECENT SESSIONS + SKILL MASTERY & WEEKLY GOAL */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left (7 cols): Progression Chart + Recent Sessions */}
          <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Performance Progression &amp; History
                </h2>
                <p className="text-xs text-[#7F9489] mt-0.5">
                  Track how your score, pacing, and filler habits evolve over sessions
                </p>
              </div>
              {reports.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer whitespace-nowrap self-start sm:self-auto"
                >
                  Open full history
                </button>
              )}
            </div>

            {trendSeries.length >= 2 ? (
              <div className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-md bg-[#0E1512] p-0.5 border border-white/[0.07]">
                    {(
                      [
                        { id: 'score', label: 'Score' },
                        { id: 'wpm', label: 'Pace (WPM)' },
                        { id: 'fillers', label: 'Fillers/min' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTrendMetric(m.id)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                          trendMetric === m.id
                            ? 'bg-[#192820] text-white'
                            : 'text-[#82978B] hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono tabular-nums text-xs text-emerald-400">
                    Latest: {trendSeries[trendSeries.length - 1].value}
                    {trendMetric === 'score'
                      ? '/100'
                      : trendMetric === 'wpm'
                      ? ' WPM'
                      : '/min'}
                  </span>
                </div>

                <svg viewBox="0 0 420 96" className="w-full h-24 overflow-visible">
                  <defs>
                    <linearGradient id="echoTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <line x1="8" y1="20" x2="412" y2="20" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <line x1="8" y1="54" x2="412" y2="54" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <polygon
                    fill="url(#echoTrendFill)"
                    points={`8,82 ${trendSeries
                      .map((pt, idx) => {
                        const x = (idx / Math.max(1, trendSeries.length - 1)) * 404 + 8;
                        const y = 78 - Math.min(1, pt.value / Math.max(1, trendMax)) * 62;
                        return `${x},${y}`;
                      })
                      .join(' ')} 412,82`}
                  />
                  <polyline
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={trendSeries
                      .map((pt, idx) => {
                        const x = (idx / Math.max(1, trendSeries.length - 1)) * 404 + 8;
                        const y = 78 - Math.min(1, pt.value / Math.max(1, trendMax)) * 62;
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                  {trendSeries.map((pt, idx) => {
                    const x = (idx / Math.max(1, trendSeries.length - 1)) * 404 + 8;
                    const y = 78 - Math.min(1, pt.value / Math.max(1, trendMax)) * 62;
                    return (
                      <g key={pt.id}>
                        <circle
                          cx={x}
                          cy={y}
                          r="4"
                          fill="#070B09"
                          stroke="#10B981"
                          strokeWidth="2"
                        />
                        <text
                          x={x}
                          y="94"
                          textAnchor="middle"
                          fill="#6E8277"
                          fontSize="9"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {pt.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="rounded-lg border border-white/[0.06] bg-[#080C0A] px-4 py-3.5 text-xs text-[#84998E] flex items-center justify-between gap-3">
                <span>
                  {reports.length === 1
                    ? 'Complete one more session to unlock your multi-session Score, Pace, and Filler progression chart.'
                    : 'Your score, WPM, and filler progression chart will appear after two completed sessions.'}
                </span>
                <button
                  type="button"
                  onClick={() => onStartLiveWithContext('Placement Interview')}
                  className="text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap cursor-pointer"
                >
                  Record session
                </button>
              </div>
            )}

            {reports.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.1] bg-[#090E0B] p-8 text-center space-y-3">
                <FileText className="h-6 w-6 text-[#5B7065] mx-auto" />
                <div className="text-sm font-medium text-[#D6E2DB]">No practice reports yet</div>
                <p className="text-xs text-[#7F9489] max-w-sm mx-auto">
                  Complete a live coaching session or mock interview to view your annotated
                  transcript, STAR rewrite, and 7-day plan here.
                </p>
                <button
                  type="button"
                  onClick={() => onStartLiveWithContext('Placement Interview')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-4 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 cursor-pointer"
                >
                  Run First Session
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {reports.slice(0, 5).map((report) => {
                  const score = getReportScore(report);
                  const title =
                    report.kind === 'live'
                      ? `${report.context} — ${report.topic}`
                      : `Mock Interview · ${report.role}`;
                  const meta =
                    report.kind === 'live'
                      ? `${report.metrics.wpm} WPM · ${report.metrics.fillerCount} fillers · ${new Date(
                          report.createdAt
                        ).toLocaleDateString()}`
                      : `${report.difficulty} · ${report.answers.length} questions · ${new Date(
                          report.createdAt
                        ).toLocaleDateString()}`;

                  return (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => onOpenReport(report)}
                      className="w-full flex items-center justify-between gap-4 py-3.5 text-left group cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#E5EFE9] truncate group-hover:text-emerald-300 transition-colors">
                          {title}
                        </div>
                        <div className="text-xs text-[#7D9186] mt-0.5">{meta}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono tabular-nums text-sm font-semibold text-emerald-400">
                          {score}/100
                        </span>
                        <ArrowRight className="h-4 w-4 text-[#586D62] group-hover:text-emerald-400 transition-colors" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right (5 cols): Skill Mastery Breakdown + Weekly Practice Goal */}
          <div className="lg:col-span-5 space-y-6">
            {/* Skill Mastery Breakdown */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-white">
                  Skill Breakdown
                </h2>
                <span className="text-xs text-[#7E9287]">
                  {reports.length > 0 ? `Avg of ${reports.length}` : 'Weighted rubric'}
                </span>
              </div>

              {componentAverages ? (
                <>
                  <div className="space-y-3.5">
                    {componentAverages.map((comp) => (
                      <div key={comp.key} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#DCE7E0] font-medium">
                            {comp.label}{' '}
                            <span className="text-[#72867B] font-normal">({comp.weight})</span>
                          </span>
                          <span className="font-mono tabular-nums font-semibold text-white">
                            {comp.value}/100
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                          <div
                            className={`h-full rounded-full ${
                              comp.value >= 75
                                ? 'bg-emerald-400'
                                : comp.value >= 55
                                ? 'bg-amber-400'
                                : 'bg-rose-400'
                            }`}
                            style={{ width: `${comp.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {weakestComponent && (
                    <div className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-3.5 space-y-1">
                      <div className="text-xs font-semibold text-emerald-400">
                        Recommended Focus: {weakestComponent.label}
                      </div>
                      <p className="text-xs text-[#95A99E] leading-relaxed">
                        {weakestComponent.tip}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[#84998E] leading-relaxed">
                  Echo scores every session across Delivery (30%), Clarity (25%), Presence (25%),
                  and Structure (20%). Complete your first run to see your personal skill profile
                  and top growth area.
                </p>
              )}
            </div>

            {/* Interactive Weekly Practice Goal Tracker */}
            <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-emerald-400" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Weekly Practice Goal
                  </h2>
                </div>
                <div className="flex items-center gap-1 rounded-md bg-[#070B09] p-0.5 border border-white/[0.08]">
                  {[3, 5, 7].map((goal) => (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => handleSetWeeklyGoal(goal)}
                      className={`px-2 py-0.5 rounded font-mono text-[11px] cursor-pointer transition-colors ${
                        weeklyGoal === goal
                          ? 'bg-[#17241D] text-white'
                          : 'text-[#7C9186] hover:text-white'
                      }`}
                    >
                      {goal}/wk
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono tabular-nums text-lg font-semibold text-white">
                    {sessionsThisWeek} / {weeklyGoal}{' '}
                    <span className="font-sans text-xs font-normal text-[#83988C]">
                      sessions this week
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-xs text-emerald-400">
                    {goalPct}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-200"
                    style={{ width: `${goalPct}%` }}
                  />
                </div>
              </div>

              {/* 7-Day Activity Strip */}
              <div className="grid grid-cols-7 gap-2 pt-1">
                {last7Days.map((day) => {
                  const active = day.count > 0;
                  return (
                    <div key={day.key} className="flex flex-col items-center gap-1.5">
                      <div
                        className={`flex h-8 w-full items-center justify-center rounded-md border font-mono text-xs ${
                          active
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-white/[0.06] bg-[#080C0A] text-[#55695E]'
                        }`}
                      >
                        {active ? <Check className="h-3.5 w-3.5" /> : '·'}
                      </div>
                      <span className="text-[11px] text-[#758A7F]">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* DYNAMIC ACTIONABLE COMMUNICATION TIPS (DERIVED FROM ALL STORED REPORTS) */}
        <section className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 sm:p-7 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/[0.07]">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                <Lightbulb className="h-3.5 w-3.5" />
                <span>Personalized Coaching Insights</span>
              </div>
              <h2 className="font-display text-lg font-semibold text-white">
                Actionable Tips From Your Past Sessions
              </h2>
              <p className="text-xs text-[#83988C]">
                {reports.length > 0
                  ? `Synthesized dynamically from recurring improvement areas and metrics across all ${reports.length} stored ${
                      reports.length === 1 ? 'report' : 'reports'
                    }`
                  : 'Complete a speaking session to unlock data-driven tips tailored to your recurring habits'}
              </p>
            </div>

            {reports.length > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer whitespace-nowrap self-start sm:self-auto"
              >
                Review source reports
              </button>
            )}
          </div>

          {dynamicTips.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.1] bg-[#080C0A] p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <div className="text-sm font-medium text-[#DCE7E0]">
                  {reports.length === 0
                    ? 'No recurring patterns detected yet'
                    : 'All core dimensions are currently above target thresholds'}
                </div>
                <p className="text-xs text-[#7E9287] leading-relaxed">
                  {reports.length === 0
                    ? 'Once you finish a Live Coaching session or Mock Interview, Echo scans your AI feedback and speech metrics to surface your highest-impact habits to practice next.'
                    : 'Keep challenging yourself with harder Mock Interview roles or longer Presentation runs to uncover deeper areas for polish.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  reports.length === 0
                    ? onStartLiveWithContext('Placement Interview')
                    : onStartInterviewWithRole()
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Play className="h-3.5 w-3.5" />
                {reports.length === 0 ? 'Start First Session' : 'Try Mock Interview'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {dynamicTips.map((tip, index) => (
                <div
                  key={tip.id}
                  className="rounded-xl border border-white/[0.08] bg-[#080C0A] p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono tabular-nums text-emerald-400 font-medium">
                        0{index + 1}.{' '}
                        {tip.severity === 'priority'
                          ? 'Top Priority'
                          : tip.severity === 'moderate'
                          ? 'Recurring Pattern'
                          : 'Refinement'}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-[#7D9186]">
                        {tip.occurrences}/{tip.totalSessions}{' '}
                        {tip.totalSessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h3 className="font-display text-base font-semibold text-white">
                        {tip.area}
                      </h3>
                      <div className="text-xs text-[#7E9287]">{tip.evidence}</div>
                    </div>

                    <p className="text-xs text-[#CEDBD3] leading-relaxed">{tip.actionableTip}</p>

                    {tip.sampleFeedback && (
                      <div className="pt-2.5 border-t border-white/[0.06] text-[11px] text-[#889D91] leading-relaxed">
                        <span className="text-[#A8BCB1] font-medium">From your report: </span>
                        &ldquo;{tip.sampleFeedback}&rdquo;
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onStartLiveWithContext(tip.practiceContext, tip.drillPrompt)}
                    className="w-full inline-flex items-center justify-between rounded-lg border border-white/[0.1] bg-[#0E1612] px-3.5 py-2.5 text-xs font-medium text-[#DDE8E1] hover:border-emerald-500/40 hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    <span>Practice targeted drill</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SPEAKING PLAYBOOK & PRIVACY STRIP */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
          <div className="rounded-xl border border-white/[0.08] bg-[#0B110E] p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Gauge className="h-3.5 w-3.5" />
              <span>Pacing &amp; Deliberate Pauses</span>
            </div>
            <h3 className="font-display text-sm font-semibold text-white">
              Aim for 140–170 WPM
            </h3>
            <p className="text-xs text-[#899E93] leading-relaxed">
              Speaking slightly slower with one-second pauses between ideas increases comprehension
              and eliminates filler vocalizations like &ldquo;um&rdquo; and &ldquo;uh&rdquo;.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#0B110E] p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Camera className="h-3.5 w-3.5" />
              <span>On-Device Visual Presence</span>
            </div>
            <h3 className="font-display text-sm font-semibold text-white">
              Zero Video Uploaded
            </h3>
            <p className="text-xs text-[#899E93] leading-relaxed">
              MediaPipe FaceLandmarker runs locally in your browser tab via WebAssembly to estimate
              camera eye contact and smiling cues privately.
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#0B110E] p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>100% Free &amp; Open-Source Stack</span>
            </div>
            <h3 className="font-display text-sm font-semibold text-white">
              Built for Independent Practice
            </h3>
            <p className="text-xs text-[#899E93] leading-relaxed">
              Combines browser Web Speech &amp; Web Audio APIs, localStorage history, and server-side
              free-tier Gemini AI coaching with full Markdown &amp; PDF export.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
