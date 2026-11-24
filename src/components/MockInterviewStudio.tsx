import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Camera,
  CameraOff,
  CheckCircle2,
  Edit3,
  HelpCircle,
  Loader2,
  Mic,
  Square,
} from 'lucide-react';
import { useSpeechSession } from '../hooks/useSpeechSession';
import { useVisionAnalysis } from '../hooks/useVisionAnalysis';
import {
  calculateComponentScores,
  detectFillers,
  formatDuration,
  generateLiveNudges,
  splitTranscriptWithFillers,
} from '../utils/scoring';
import { postJson } from '../utils/api';
import type {
  LiveMetrics,
  MockInterviewAnswer,
  MockInterviewEvaluation,
  MockInterviewQuestion,
  MockInterviewReport,
} from '../types/echo';

interface MockInterviewStudioProps {
  initialRole?: string;
  onInterviewComplete: (report: MockInterviewReport) => void;
}

const PRESET_ROLES = [
  'Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Data Analyst',
  'Machine Learning Engineer',
  'Product Manager',
];

const DIFFICULTIES = ['Entry / Placement', 'Intermediate', 'Senior / Advanced'];

const FOCUS_AREAS = [
  'Mixed Behavioral & Technical',
  'Behavioral (STAR)',
  'Technical Concepts',
  'Project Deep-Dive',
];

export function MockInterviewStudio({
  initialRole,
  onInterviewComplete,
}: MockInterviewStudioProps) {
  const [stage, setStage] = useState<'setup' | 'active' | 'evaluating'>('setup');
  const [role, setRole] = useState(
    initialRole && PRESET_ROLES.includes(initialRole) ? initialRole : 'Software Engineer'
  );
  const [customRole, setCustomRole] = useState(
    initialRole && !PRESET_ROLES.includes(initialRole) ? initialRole : ''
  );
  const [difficulty, setDifficulty] = useState('Entry / Placement');
  const [focus, setFocus] = useState('Mixed Behavioral & Technical');
  const [questionCount, setQuestionCount] = useState<number>(3);

  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MockInterviewQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<MockInterviewAnswer[]>([]);
  const [showHint, setShowHint] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const speech = useSpeechSession();
  const vision = useVisionAnalysis(speech.state.isRecording && !speech.state.isPaused);

  const effectiveRole = customRole.trim() || role;
  const currentQuestion = questions[currentIdx] ?? null;

  const liveMetrics: LiveMetrics = useMemo(() => {
    const eyeVal =
      vision.state.avgEyeContactPct > 0
        ? vision.state.avgEyeContactPct
        : vision.state.eyeContactPct;
    const smileVal =
      vision.state.avgSmilePct > 0
        ? vision.state.avgSmilePct
        : vision.state.smilePct;

    return {
      durationSec: speech.state.durationSec,
      wordCount: speech.state.wordCount,
      wpm: speech.state.wpm,
      fillerCount: speech.state.fillerCount,
      fillerRatePerMin: speech.state.fillerRatePerMin,
      fillerRatioPct: speech.state.fillerRatioPct,
      topFillers: speech.state.topFillers,
      loudnessDb: speech.state.loudnessDb,
      speakingRatio: speech.state.speakingRatio,
      pauseCount: speech.state.pauseCount,
      visionEnabled: vision.state.enabled && vision.state.modelReady,
      eyeContactPct: eyeVal,
      smilePct: smileVal,
    };
  }, [speech.state, vision.state]);

  const nudges = useMemo(
    () => generateLiveNudges(liveMetrics, speech.state.isRecording),
    [liveMetrics, speech.state.isRecording]
  );

  const transcriptParts = useMemo(
    () => splitTranscriptWithFillers(speech.state.finalTranscript),
    [speech.state.finalTranscript]
  );

  const handleGenerateQuestions = async () => {
    setErrorMsg(null);
    setLoadingQuestions(true);

    const result = await postJson<{ questions: MockInterviewQuestion[] }>(
      '/api/interview/questions',
      {
        role: effectiveRole,
        difficulty,
        focus,
        count: questionCount,
      }
    );
    setLoadingQuestions(false);

    if (!result.ok) {
      setErrorMsg(result.error || 'Could not generate interview questions.');
      return;
    }
    const generated = result.data?.questions;
    if (!Array.isArray(generated) || generated.length === 0) {
      setErrorMsg('No questions were returned by the AI service. Please try again.');
      return;
    }

    setQuestions(generated);
    setAnswers([]);
    setCurrentIdx(0);
    setShowHint(false);
    setEditMode(false);
    speech.reset();
    vision.resetAverages();
    setStage('active');
  };

  const handleSubmitCurrentAnswer = async () => {
    if (!currentQuestion) return;
    setErrorMsg(null);

    const responseText = speech.state.fullTranscript.trim();
    if (responseText.length < 8) {
      setErrorMsg(
        'Please record or type an answer before moving to the next question.'
      );
      return;
    }

    const answerRecord: MockInterviewAnswer = {
      questionId: currentQuestion.id,
      question: currentQuestion.question,
      category: currentQuestion.category,
      targetCompetency: currentQuestion.targetCompetency,
      answer: responseText,
      durationSec: speech.state.durationSec,
      wordCount: speech.state.wordCount,
      wpm: speech.state.wpm,
      fillerCount: speech.state.fillerCount,
      eyeContactPct:
        vision.state.avgEyeContactPct > 0
          ? vision.state.avgEyeContactPct
          : vision.state.eyeContactPct,
      smilePct:
        vision.state.avgSmilePct > 0
          ? vision.state.avgSmilePct
          : vision.state.smilePct,
      visionEnabled: vision.state.enabled && vision.state.modelReady,
    };

    speech.stop();
    const updatedAnswers = [...answers, answerRecord];
    setAnswers(updatedAnswers);

    if (currentIdx + 1 < questions.length) {
      setCurrentIdx((idx) => idx + 1);
      setShowHint(false);
      setEditMode(false);
      speech.reset();
      vision.resetAverages();
      return;
    }

    // Final question submitted — evaluate full mock interview via server Gemini route
    vision.stopVision();
    setStage('evaluating');

    const totalDuration = updatedAnswers.reduce((s, a) => s + a.durationSec, 0);
    const totalWords = updatedAnswers.reduce((s, a) => s + a.wordCount, 0);
    const combinedTranscript = updatedAnswers.map((a) => a.answer).join(' ');
    const { total: totalFillers, breakdown: topFillers } = detectFillers(combinedTranscript);
    const avgWpm =
      totalDuration >= 3
        ? Math.round(totalWords / (totalDuration / 60))
        : 0;
    const fillerRatePerMin =
      totalDuration >= 3
        ? Number((totalFillers / (totalDuration / 60)).toFixed(1))
        : 0;
    const visionSamples = updatedAnswers.filter((a) => a.visionEnabled);
    const visionEnabled = visionSamples.length > 0;
    const avgEye = visionEnabled
      ? Math.round(
          visionSamples.reduce((s, a) => s + a.eyeContactPct, 0) / visionSamples.length
        )
      : 0;
    const avgSmile = visionEnabled
      ? Math.round(
          visionSamples.reduce((s, a) => s + a.smilePct, 0) / visionSamples.length
        )
      : 0;

    const aggregateMetrics: LiveMetrics = {
      durationSec: totalDuration,
      wordCount: totalWords,
      wpm: avgWpm,
      fillerCount: totalFillers,
      fillerRatePerMin,
      fillerRatioPct:
        totalWords > 0 ? Number(((totalFillers / totalWords) * 100).toFixed(1)) : 0,
      topFillers,
      loudnessDb: -28,
      speakingRatio: 68,
      pauseCount: updatedAnswers.length * 2,
      visionEnabled,
      eyeContactPct: avgEye,
      smilePct: avgSmile,
    };

    const speechScores = calculateComponentScores(combinedTranscript, aggregateMetrics);

    let evaluation: MockInterviewEvaluation | null = null;
    let aiError: string | undefined;

    const evalResult = await postJson<{ evaluation: MockInterviewEvaluation }>(
      '/api/interview/evaluate',
      {
        role: effectiveRole,
        difficulty,
        focus,
        answers: updatedAnswers,
      }
    );
    if (!evalResult.ok || !evalResult.data?.evaluation) {
      aiError = evalResult.error || 'Unable to complete rubric evaluation right now.';
    } else {
      evaluation = evalResult.data.evaluation;
    }

    const report: MockInterviewReport = {
      id: `interview-${Date.now()}`,
      kind: 'interview',
      createdAt: new Date().toISOString(),
      role: effectiveRole,
      difficulty,
      focus,
      answers: updatedAnswers,
      aggregateMetrics,
      speechScores,
      evaluation,
      aiError,
    };

    onInterviewComplete(report);
  };

  if (stage === 'evaluating') {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center space-y-4">
        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto" />
        <h1 className="font-display text-2xl font-bold text-white">
          Evaluating Your Mock Interview
        </h1>
        <p className="text-sm text-[#8FA499] leading-relaxed">
          Scoring all {answers.length} answers against the Echo rubric (Relevance, Clarity,
          Structure, and Technical/Role Depth) and preparing tailored model answers.
        </p>
      </div>
    );
  }

  if (stage === 'setup') {
    return (
      <div className="mx-auto max-w-[1040px] px-6 py-10 space-y-8">
        <div className="space-y-2 pb-6 border-b border-white/[0.08]">
          <p className="text-xs text-[#84988D]">
            Role-Specific Practice · Rubric-Based Evaluation · Readiness Indicator
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Mock Interview Setup
          </h1>
          <p className="text-sm text-[#9DB0A5] max-w-2xl">
            Configure your target role and difficulty. Echo generates spoken interview questions,
            tracks your live delivery metrics while you answer, and scores each response against a
            four-part rubric.
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 sm:p-8 space-y-7">
          {/* Role Selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-white block">Target Role</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {PRESET_ROLES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setRole(preset);
                    setCustomRole('');
                  }}
                  className={`rounded-lg border px-3.5 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                    role === preset && !customRole.trim()
                      ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-200'
                      : 'border-white/[0.08] bg-[#080C0A] text-[#A8B9B0] hover:border-white/[0.18] hover:text-white'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              placeholder="Or type a custom role (e.g., Cloud Security Intern, Android Developer)..."
              className="w-full rounded-lg border border-white/[0.09] bg-[#070B09] px-3.5 py-2.5 text-sm text-white placeholder-[#5D7267] focus:border-emerald-500/60 focus:outline-none"
            />
          </div>

          {/* Difficulty & Focus */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-sm font-semibold text-white block">Difficulty Level</label>
              <div className="space-y-2">
                {DIFFICULTIES.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setDifficulty(lvl)}
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                      difficulty === lvl
                        ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-200'
                        : 'border-white/[0.08] bg-[#080C0A] text-[#A8B9B0] hover:border-white/[0.18] hover:text-white'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold text-white block">Interview Focus</label>
              <div className="space-y-2">
                {FOCUS_AREAS.map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => setFocus(area)}
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-left text-xs font-medium transition-colors cursor-pointer ${
                      focus === area
                        ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-200'
                        : 'border-white/[0.08] bg-[#080C0A] text-[#A8B9B0] hover:border-white/[0.18] hover:text-white'
                    }`}
                  >
                    {area}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Number of Questions & Launch */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 border-t border-white/[0.08]">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[#8FA499]">Interview Length:</span>
              <div className="flex items-center gap-1 rounded-lg bg-[#080C0A] p-1 border border-white/[0.08]">
                {[3, 5].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setQuestionCount(cnt)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      questionCount === cnt
                        ? 'bg-[#17241D] text-white'
                        : 'text-[#84988D] hover:text-white'
                    }`}
                  >
                    {cnt} Questions
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerateQuestions}
              disabled={loadingQuestions}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {loadingQuestions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Questions...
                </>
              ) : (
                <>
                  <Briefcase className="h-4 w-4" />
                  Start Mock Interview
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Mock Interview Studio
  return (
    <div className="mx-auto max-w-[1360px] px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#83988C]">
            <span>{effectiveRole}</span>
            <span aria-hidden="true">·</span>
            <span>{difficulty}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-emerald-400">
              Question {currentIdx + 1} of {questions.length}
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white mt-1">
            Mock Interview Session
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => vision.toggleVision()}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium cursor-pointer transition-colors whitespace-nowrap ${
              vision.state.enabled
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-white/[0.12] bg-[#0D1411] text-[#A4B5AC] hover:text-white'
            }`}
          >
            {vision.state.enabled ? (
              <Camera className="h-3.5 w-3.5" />
            ) : (
              <CameraOff className="h-3.5 w-3.5" />
            )}
            {vision.state.enabled ? 'Vision: ON' : 'Vision: OFF'}
          </button>

          <button
            type="button"
            onClick={() => {
              speech.reset();
              vision.stopVision();
              setStage('setup');
            }}
            className="rounded-lg border border-white/[0.1] px-3.5 py-2 text-xs font-medium text-[#9DB0A5] hover:text-white cursor-pointer whitespace-nowrap"
          >
            Exit Session
          </button>
        </div>
      </div>

      {/* Progress Stepper */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {questions.map((q, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div
              key={q.id}
              className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${
                active
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                  : done
                  ? 'border-white/[0.08] bg-[#0C120F] text-emerald-300'
                  : 'border-white/[0.06] bg-[#090D0B] text-[#697D72]'
              }`}
            >
              <span className="truncate font-medium">Q{idx + 1} · {q.category}</span>
              {done && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
            </div>
          );
        })}
      </div>

      {(errorMsg || speech.state.micError || vision.state.cameraError) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="space-y-1">
            {errorMsg && <p>{errorMsg}</p>}
            {speech.state.micError && <p>{speech.state.micError}</p>}
            {vision.state.cameraError && <p>{vision.state.cameraError}</p>}
          </div>
        </div>
      )}

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative overflow-hidden rounded-xl border border-white/[0.09] bg-[#090E0B]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] bg-[#0B110E] text-xs">
              <div className="flex items-center gap-3 text-[#91A59A]">
                <span className="inline-flex items-center gap-1.5 font-medium text-white">
                  {speech.state.isRecording && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
                    />
                  )}
                  {speech.state.isRecording ? 'Recording Answer' : 'Ready to Answer'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Audio &amp; vision stay private in your browser</span>
              </div>
              <span className="font-mono tabular-nums text-[#DCE7E0]">
                {formatDuration(speech.state.durationSec)}
              </span>
            </div>

            <div className="relative aspect-[16/10] w-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.09)_0%,rgba(7,11,9,0.96)_72%)] flex items-center justify-center overflow-hidden">
              {vision.state.enabled ? (
                <>
                  <video
                    ref={vision.videoRef}
                    playsInline
                    muted
                    className="h-full w-full object-cover -scale-x-100"
                  />
                  <canvas
                    ref={vision.canvasRef}
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  />
                </>
              ) : (
                <div className="flex flex-col items-center gap-5 px-6 text-center">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/[0.06]">
                    <Mic
                      className={`h-8 w-8 ${
                        speech.state.isRecording ? 'text-emerald-400' : 'text-[#6A8074]'
                      }`}
                    />
                  </div>
                  <div className="flex h-9 items-end justify-center gap-1">
                    {speech.state.audioLevels.map((lvl, idx) => (
                      <div
                        key={idx}
                        className="w-1.5 rounded-full bg-emerald-400/75 transition-transform duration-75 origin-bottom"
                        style={{
                          height: '32px',
                          transform: `scaleY(${Math.max(0.1, lvl)})`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-5 divide-x divide-white/[0.07] border-t border-white/[0.07] bg-[#0B110E] text-center">
              <div className="px-2 py-2.5">
                <div className="text-[11px] text-[#7D9186]">Loudness</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-white mt-0.5">
                  {liveMetrics.loudnessDb} dB
                </div>
              </div>
              <div className="px-2 py-2.5">
                <div className="text-[11px] text-[#7D9186]">Pace</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-white mt-0.5">
                  {liveMetrics.wpm} WPM
                </div>
              </div>
              <div className="px-2 py-2.5">
                <div className="text-[11px] text-[#7D9186]">Fillers</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-white mt-0.5">
                  {liveMetrics.fillerCount}
                </div>
              </div>
              <div className="px-2 py-2.5">
                <div className="text-[11px] text-[#7D9186]">Eye Contact</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-white mt-0.5">
                  {vision.state.enabled ? `${liveMetrics.eyeContactPct}%` : '—'}
                </div>
              </div>
              <div className="px-2 py-2.5">
                <div className="text-[11px] text-[#7D9186]">Smile</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-white mt-0.5">
                  {vision.state.enabled ? `${liveMetrics.smilePct}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0C120F] px-4 py-3">
            <div className="flex items-center gap-2.5">
              {!speech.state.isRecording ? (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    speech.start();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer"
                >
                  <Mic className="h-4 w-4" />
                  {speech.state.fullTranscript ? 'Continue Recording' : 'Start Answering'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={speech.stop}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-500/12 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-500/20 transition-colors cursor-pointer"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop Recording
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleSubmitCurrentAnswer}
              disabled={speech.state.fullTranscript.trim().length < 8}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E9F3ED] px-4 py-2.5 text-sm font-semibold text-[#06120B] hover:bg-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {currentIdx + 1 < questions.length ? (
                <>
                  Submit &amp; Next Question
                  <ArrowRight className="h-4 w-4" />
                </>
              ) : (
                'Finish & Evaluate Interview'
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Current Question + Coaching + Transcript */}
        <div className="lg:col-span-5 space-y-4">
          {currentQuestion && (
            <div className="rounded-xl border border-emerald-500/25 bg-[#0D1612] p-5 space-y-3">
              <div className="flex items-center justify-between text-xs text-[#88A295]">
                <span>
                  {currentQuestion.category} · {currentQuestion.targetCompetency}
                </span>
                <button
                  type="button"
                  onClick={() => setShowHint((h) => !h)}
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  {showHint ? 'Hide Hint' : 'Coaching Hint'}
                </button>
              </div>
              <p className="font-display text-base font-semibold text-white leading-snug">
                {currentQuestion.question}
              </p>
              {showHint && (
                <p className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-3 text-xs text-[#A8BCB1] leading-relaxed">
                  {currentQuestion.hint}
                </p>
              )}
            </div>
          )}

          {/* Nudges */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-4 space-y-2">
            <div className="text-xs font-medium text-[#84998E]">Live Coaching Cues</div>
            {nudges.slice(0, 2).map((nudge) => (
              <div
                key={nudge.id}
                className="rounded-lg border border-white/[0.06] bg-[#080C0A] px-3 py-2 text-xs text-[#C7D5CD]"
              >
                <span
                  className={`font-semibold mr-1.5 ${
                    nudge.tone === 'positive'
                      ? 'text-emerald-400'
                      : nudge.tone === 'caution'
                      ? 'text-amber-300'
                      : 'text-[#96ABA0]'
                  }`}
                >
                  {nudge.label}:
                </span>
                {nudge.message}
              </div>
            ))}
          </div>

          {/* Live Answer Transcript */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">Your Answer</h2>
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-[#8FA499] hover:text-white cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {editMode ? 'View Highlighted' : 'Edit / Type Answer'}
              </button>
            </div>

            {editMode ? (
              <textarea
                rows={7}
                value={speech.state.fullTranscript}
                onChange={(e) => speech.setManualTranscript(e.target.value)}
                placeholder="Type or refine your spoken interview answer..."
                className="w-full rounded-lg border border-white/[0.1] bg-[#070B09] p-3 text-sm text-[#E5EFE9] placeholder-[#5B6F64] leading-relaxed focus:border-emerald-500/60 focus:outline-none"
              />
            ) : (
              <div className="min-h-[160px] max-h-[240px] overflow-y-auto rounded-lg border border-white/[0.06] bg-[#080C0A] p-3.5 text-sm leading-relaxed text-[#DCE7E0]">
                {speech.state.fullTranscript ? (
                  <p>
                    {transcriptParts.map((part, idx) =>
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
                    {speech.state.interimTranscript && (
                      <span className="text-[#7E9287] italic">
                        {' '}
                        {speech.state.interimTranscript}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[#667B70]">
                    Click &ldquo;Start Answering&rdquo; and speak your response, or use &ldquo;Edit
                    / Type Answer&rdquo;.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
