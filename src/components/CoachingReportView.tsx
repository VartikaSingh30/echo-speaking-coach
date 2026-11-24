import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  formatDuration,
  splitTranscriptWithFillers,
} from '../utils/scoring';
import { exportReportAsMarkdown } from '../utils/storage';
import { postJson } from '../utils/api';
import type {
  AICoachingFeedback,
  MockInterviewEvaluation,
  StoredReport,
} from '../types/echo';

interface CoachingReportViewProps {
  report: StoredReport;
  onBack: () => void;
  onReportUpdated: (updated: StoredReport) => void;
  onStartNewLive: () => void;
  onStartNewInterview: () => void;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90">
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="9"
        />
        <circle
          cx="66"
          cy="66"
          r={radius}
          fill="none"
          stroke={score >= 75 ? '#10B981' : score >= 55 ? '#F59E0B' : '#EF4444'}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono tabular-nums text-3xl font-bold text-white">{score}</span>
        <span className="text-[11px] text-[#83988C]">{label}</span>
      </div>
    </div>
  );
}

export function CoachingReportView({
  report,
  onBack,
  onReportUpdated,
  onStartNewLive,
  onStartNewInterview,
}: CoachingReportViewProps) {
  const [retrying, setRetrying] = useState(false);

  const handleDownloadMarkdown = () => {
    const md = exportReportAsMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-report-${report.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRetryAI = async () => {
    setRetrying(true);
    try {
      if (report.kind === 'live') {
        const result = await postJson<{ feedback: AICoachingFeedback }>('/api/coaching/report', {
          context: report.context,
          topic: report.topic,
          transcript: report.transcript,
          metrics: report.metrics,
          scores: report.scores,
        });
        if (result.ok && result.data?.feedback) {
          onReportUpdated({
            ...report,
            aiFeedback: result.data.feedback,
            aiError: undefined,
          });
        } else {
          onReportUpdated({
            ...report,
            aiError: result.error || 'Could not regenerate AI coaching report.',
          });
        }
      } else {
        const result = await postJson<{ evaluation: MockInterviewEvaluation }>(
          '/api/interview/evaluate',
          {
            role: report.role,
            difficulty: report.difficulty,
            focus: report.focus,
            answers: report.answers,
          }
        );
        if (result.ok && result.data?.evaluation) {
          onReportUpdated({
            ...report,
            evaluation: result.data.evaluation,
            aiError: undefined,
          });
        } else {
          onReportUpdated({
            ...report,
            aiError: result.error || 'Could not regenerate mock interview evaluation.',
          });
        }
      }
    } finally {
      setRetrying(false);
    }
  };

  const scores = report.kind === 'live' ? report.scores : report.speechScores;
  const metrics = report.kind === 'live' ? report.metrics : report.aggregateMetrics;

  const componentRows = [
    {
      name: 'Delivery (D)',
      weight: '30%',
      score: scores.delivery,
      detail: `${metrics.wpm} WPM · ${metrics.speakingRatio}% active speech`,
    },
    {
      name: 'Clarity (C)',
      weight: '25%',
      score: scores.clarity,
      detail: `${metrics.fillerCount} fillers (${metrics.fillerRatePerMin}/min)`,
    },
    {
      name: 'Presence (P)',
      weight: '25%',
      score: scores.presence,
      detail: scores.visionUsed
        ? `0.60 × ${metrics.eyeContactPct}% eye + 0.40 × ${metrics.smilePct}% smile`
        : 'Camera off — audio-only baseline',
    },
    {
      name: 'Structure (S)',
      weight: '20%',
      score: scores.structure,
      detail: `${metrics.wordCount} words · transitions, opening & specificity`,
    },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-8">
      {/* Top Action Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[#95A99E] hover:text-white cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0D1411] px-3.5 py-2 text-xs font-medium text-[#DCE7E0] hover:bg-[#141F1A] cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export Markdown
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#0D1411] px-3.5 py-2 text-xs font-medium text-[#DCE7E0] hover:bg-[#141F1A] cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / Save PDF
          </button>
          <button
            type="button"
            onClick={report.kind === 'live' ? onStartNewLive : onStartNewInterview}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#04120B] hover:bg-emerald-400 cursor-pointer"
          >
            {report.kind === 'live' ? 'New Live Session' : 'New Mock Interview'}
          </button>
        </div>
      </div>

      {/* Report Header */}
      <div className="space-y-2">
        <div className="text-xs text-[#82978B]">
          {report.kind === 'live' ? `Live Coaching · ${report.context}` : `Mock Interview · ${report.difficulty} · ${report.focus}`}
          <span aria-hidden="true"> · </span>
          {new Date(report.createdAt).toLocaleString()}
        </div>
        <h1 className="font-display text-3xl font-bold text-white tracking-tight">
          {report.kind === 'live' ? report.topic : `${report.role} Mock Interview Report`}
        </h1>
      </div>

      {/* AI Error Banner with Retry */}
      {report.aiError && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-100">AI Feedback Unavailable</p>
              <p className="mt-0.5">{report.aiError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetryAI}
            disabled={retrying}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 cursor-pointer whitespace-nowrap shrink-0"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Retry AI Analysis
          </button>
        </div>
      )}

      {/* Score Overview Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 rounded-xl border border-white/[0.09] bg-[#0C120F] p-6">
        <div className="lg:col-span-4 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-white/[0.08] pb-6 lg:pb-0 lg:pr-6 space-y-3 text-center">
          <ScoreRing
            score={
              report.kind === 'interview' && report.evaluation
                ? report.evaluation.overallRubricScore
                : scores.overall
            }
            label={
              report.kind === 'interview' && report.evaluation
                ? 'Rubric Score'
                : 'Overall Score'
            }
          />
          {report.kind === 'interview' && report.evaluation ? (
            <div className="space-y-1">
              <div className="text-sm font-semibold text-emerald-300">
                {report.evaluation.readinessLevel}
              </div>
              <p className="text-xs text-[#8EA397] max-w-xs">
                Practice readiness indicator — not equivalent to an employer hiring decision.
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#7E9287] max-w-xs">
              Formula: T = 0.30D + 0.25C + 0.25P + 0.20S. Scores are directional coaching
              indicators.
            </p>
          )}
        </div>

        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-white">
              Speaking Component Breakdown
            </h2>
            <span className="font-mono tabular-nums text-xs text-[#83988C]">
              Duration {formatDuration(metrics.durationSec)} · {metrics.wordCount} words ·{' '}
              {metrics.wpm} WPM
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {componentRows.map((row) => (
              <div
                key={row.name}
                className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-4 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#E2ECE6]">
                    {row.name}{' '}
                    <span className="text-[#72877C] font-normal">({row.weight})</span>
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {row.score}/100
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={`h-full rounded-full ${
                      row.score >= 75
                        ? 'bg-emerald-400'
                        : row.score >= 55
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                    }`}
                    style={{ width: `${row.score}%` }}
                  />
                </div>
                <div className="text-[11px] text-[#7D9186]">{row.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LIVE COACHING AI SECTIONS */}
      {report.kind === 'live' && report.aiFeedback && (
        <>
          {/* Executive Summary + Strengths / Improvements */}
          <section className="space-y-6">
            <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-2">
              <h2 className="font-display text-base font-semibold text-white">
                Coach Summary
              </h2>
              <p className="text-sm text-[#C7D6CE] leading-relaxed">
                {report.aiFeedback.summary}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-3">
                <h3 className="font-display text-base font-semibold text-emerald-300">
                  Key Strengths
                </h3>
                <ul className="space-y-2.5 text-sm text-[#D1DFD7]">
                  {report.aiFeedback.strengths.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-3">
                <h3 className="font-display text-base font-semibold text-amber-300">
                  Areas for Improvement
                </h3>
                <ul className="space-y-2.5 text-sm text-[#D1DFD7]">
                  {report.aiFeedback.areasForImprovement.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="font-mono text-xs text-amber-400 mt-0.5 shrink-0">
                        0{idx + 1}.
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* English & Phrasing Coaching */}
          {report.aiFeedback.englishCoaching.length > 0 && (
            <section className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  English &amp; Clarity Refinements
                </h2>
                <p className="text-xs text-[#80958A] mt-0.5">
                  Targeted phrasing upgrades drawn directly from your spoken transcript
                </p>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {report.aiFeedback.englishCoaching.map((tip, idx) => (
                  <div key={idx} className="py-4 first:pt-1 last:pb-1 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border border-white/[0.06] bg-[#080C0A] p-3">
                        <div className="text-[11px] text-[#7D9186] mb-1">Original Phrasing</div>
                        <p className="text-[#B8C7BF]">&ldquo;{tip.original}&rdquo;</p>
                      </div>
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                        <div className="text-[11px] text-emerald-400 mb-1">Suggested Upgrade</div>
                        <p className="text-[#E7F3EC]">&ldquo;{tip.improved}&rdquo;</p>
                      </div>
                    </div>
                    <p className="text-xs text-[#8FA499]">{tip.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* STAR Structured Answer Suggestion */}
          <section className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-5">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                STAR-Format Structured Answer
              </h2>
              <p className="text-xs text-[#80958A] mt-0.5">
                How to organize this response clearly into Situation, Task, Action, and Result
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {[
                { label: 'Situation', text: report.aiFeedback.starSuggestion.situation },
                { label: 'Task', text: report.aiFeedback.starSuggestion.task },
                { label: 'Action', text: report.aiFeedback.starSuggestion.action },
                { label: 'Result', text: report.aiFeedback.starSuggestion.result },
              ].map((block) => (
                <div
                  key={block.label}
                  className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-4 space-y-1.5"
                >
                  <div className="text-xs font-semibold text-emerald-400">{block.label}</div>
                  <p className="text-xs text-[#CEDBD3] leading-relaxed">{block.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-white/[0.08] bg-[#080C0A] p-4 space-y-1.5">
              <div className="text-xs font-semibold text-white">
                Polished Spoken Version (Practice Reading Aloud)
              </div>
              <p className="text-sm text-[#DDE8E1] leading-relaxed">
                {report.aiFeedback.starSuggestion.polishedAnswer}
              </p>
            </div>
          </section>

          {/* 7-Day Improvement Plan */}
          <section className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-400" />
              <h2 className="font-display text-base font-semibold text-white">
                7-Day Personalized Improvement Plan
              </h2>
            </div>

            <div className="divide-y divide-white/[0.06]">
              {report.aiFeedback.sevenDayPlan.map((step) => (
                <div
                  key={step.day}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-5"
                >
                  <div className="font-mono tabular-nums text-xs font-semibold text-emerald-400 w-24 shrink-0">
                    Day {step.day} · {step.durationMinutes}m
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-white">{step.focus}</div>
                    <p className="text-xs text-[#95A99E] leading-relaxed">{step.exercise}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* LIVE COACHING TRANSCRIPT & FILLER BREAKDOWN */}
      {report.kind === 'live' && (
        <section className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-white">
              Annotated Transcript
            </h2>
            <span className="text-xs text-[#7F9489]">
              {report.metrics.fillerCount} detected fillers highlighted
            </span>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-[#080C0A] p-4 text-sm leading-relaxed text-[#D8E4DD]">
            {splitTranscriptWithFillers(report.transcript).map((part, idx) =>
              part.isFiller ? (
                <mark
                  key={idx}
                  className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-200 font-medium"
                >
                  {part.text}
                </mark>
              ) : (
                <span key={idx}>{part.text}</span>
              )
            )}
          </div>

          {report.metrics.topFillers.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#91A59A]">
              <span className="font-medium text-white">Filler Breakdown:</span>
              {report.metrics.topFillers.map((item) => (
                <span key={item.word} className="font-mono tabular-nums">
                  &ldquo;{item.word}&rdquo; × {item.count}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* MOCK INTERVIEW RUBRIC SECTIONS */}
      {report.kind === 'interview' && (
        <>
          {report.evaluation && (
            <section className="space-y-6">
              <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-2">
                <h2 className="font-display text-base font-semibold text-white">
                  Readiness Summary
                </h2>
                <p className="text-sm text-[#C9D8D0] leading-relaxed">
                  {report.evaluation.readinessSummary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-3">
                  <h3 className="font-display text-base font-semibold text-emerald-300">
                    Top Strengths
                  </h3>
                  <ul className="space-y-2 text-sm text-[#D1DFD7]">
                    {report.evaluation.topStrengths.map((s, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-3">
                  <h3 className="font-display text-base font-semibold text-amber-300">
                    Priority Gaps to Close
                  </h3>
                  <ul className="space-y-2 text-sm text-[#D1DFD7]">
                    {report.evaluation.priorityGaps.map((g, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="font-mono text-xs text-amber-400 mt-0.5 shrink-0">
                          0{idx + 1}.
                        </span>
                        <span>{g}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* Question-by-Question Rubric Evaluations */}
          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold text-white">
              Question-by-Question Evaluation
            </h2>

            {report.answers.map((ans, idx) => {
              const rubric = report.evaluation?.questionEvaluations[idx];
              return (
                <div
                  key={ans.questionId}
                  className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-[#82978B]">
                        Question {idx + 1} · {ans.category} · {ans.targetCompetency}
                      </div>
                      <h3 className="font-display text-base font-semibold text-white mt-1">
                        {ans.question}
                      </h3>
                    </div>
                    {rubric && (
                      <div className="font-mono tabular-nums text-lg font-bold text-emerald-400 shrink-0">
                        {rubric.overallQuestionScore}/100
                      </div>
                    )}
                  </div>

                  {rubric && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: 'Relevance', val: rubric.relevance },
                        { label: 'Clarity', val: rubric.clarity },
                        { label: 'Structure', val: rubric.structure },
                        { label: 'Depth', val: rubric.depth },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-lg border border-white/[0.06] bg-[#080C0A] px-3 py-2.5 flex items-center justify-between text-xs"
                        >
                          <span className="text-[#889D91]">{metric.label}</span>
                          <span className="font-mono tabular-nums font-semibold text-white">
                            {metric.val}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-white/[0.06] bg-[#080C0A] p-4 space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-[#82978B]">
                        <span>Your Response</span>
                        <span className="font-mono tabular-nums">
                          {ans.wpm} WPM · {ans.fillerCount} fillers · {formatDuration(ans.durationSec)}
                        </span>
                      </div>
                      <p className="text-sm text-[#D6E3DC] leading-relaxed">{ans.answer}</p>
                    </div>

                    {rubric && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-4 space-y-1.5">
                        <div className="text-xs font-medium text-emerald-400">
                          Suggested Model Answer
                        </div>
                        <p className="text-sm text-[#E2EFE7] leading-relaxed">
                          {rubric.modelAnswer}
                        </p>
                      </div>
                    )}
                  </div>

                  {rubric && (
                    <p className="text-xs text-[#9DB0A5] leading-relaxed">
                      <span className="font-semibold text-white">Rubric Notes: </span>
                      {rubric.feedback}
                    </p>
                  )}
                </div>
              );
            })}
          </section>

          {/* Interview Practice Plan */}
          {report.evaluation && report.evaluation.practicePlan.length > 0 && (
            <section className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-400" />
                <h2 className="font-display text-base font-semibold text-white">
                  Focused Interview Preparation Plan
                </h2>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {report.evaluation.practicePlan.map((step) => (
                  <div
                    key={step.day}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-5"
                  >
                    <div className="font-mono tabular-nums text-xs font-semibold text-emerald-400 w-24 shrink-0">
                      Day {step.day} · {step.durationMinutes}m
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-white">{step.focus}</div>
                      <p className="text-xs text-[#95A99E] leading-relaxed">{step.exercise}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
