import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CameraOff,
  Edit3,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { useSpeechSession } from '../hooks/useSpeechSession';
import { useVisionAnalysis } from '../hooks/useVisionAnalysis';
import {
  calculateComponentScores,
  formatDuration,
  generateLiveNudges,
  splitTranscriptWithFillers,
} from '../utils/scoring';
import { postJson } from '../utils/api';
import type {
  AICoachingFeedback,
  LiveMetrics,
  LiveSessionReport,
  PracticeContext,
} from '../types/echo';

interface LiveCoachStudioProps {
  initialContext: PracticeContext;
  initialTopic?: string;
  onReportComplete: (report: LiveSessionReport) => void;
}

const CONTEXTS: PracticeContext[] = [
  'Placement Interview',
  'Presentation',
  'Stand-up Meeting',
  'Project Demo',
  'Elevator Pitch',
];

const CONTEXT_PROMPTS: Record<PracticeContext, string[]> = {
  'Placement Interview': [
    'Tell me about a challenging technical problem you solved recently and how you approached it.',
    'Describe a time you disagreed with a teammate and how you resolved it.',
    'Walk me through your favorite software project and the trade-offs you made.',
  ],
  Presentation: [
    'Introduce your project objective, architecture, and key outcomes to a panel of reviewers.',
    'Explain a complex technical concept in two minutes to a non-technical stakeholder.',
  ],
  'Stand-up Meeting': [
    'Share what you completed yesterday, what you are working on today, and any blockers.',
    'Give a concise sprint demo update highlighting one shipped feature and one risk.',
  ],
  'Project Demo': [
    'Walk through the user problem, live workflow, and architecture of your latest application.',
    'Explain how you tested your system and what you would improve in the next version.',
  ],
  'Elevator Pitch': [
    'Introduce yourself, your core strengths, and the kind of engineering role you are targeting in 60 seconds.',
    'Pitch your capstone project idea and why it matters to students and job seekers.',
  ],
};

export function LiveCoachStudio({
  initialContext,
  initialTopic,
  onReportComplete,
}: LiveCoachStudioProps) {
  const [context, setContext] = useState<PracticeContext>(initialContext);
  const [topic, setTopic] = useState<string>(
    initialTopic?.trim() || CONTEXT_PROMPTS[initialContext][0]
  );
  const [editMode, setEditMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const speech = useSpeechSession();
  const vision = useVisionAnalysis(speech.state.isRecording && !speech.state.isPaused);

  const handleContextChange = (nextContext: PracticeContext) => {
    setContext(nextContext);
    setTopic(CONTEXT_PROMPTS[nextContext][0]);
  };

  const liveMetrics: LiveMetrics = useMemo(() => {
    const eyeVal =
      speech.state.isRecording && vision.state.avgEyeContactPct > 0
        ? vision.state.avgEyeContactPct
        : vision.state.eyeContactPct;
    const smileVal =
      speech.state.isRecording && vision.state.avgSmilePct > 0
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
    () => generateLiveNudges(liveMetrics, speech.state.isRecording && !speech.state.isPaused),
    [liveMetrics, speech.state.isRecording, speech.state.isPaused]
  );

  const transcriptParts = useMemo(
    () => splitTranscriptWithFillers(speech.state.finalTranscript),
    [speech.state.finalTranscript]
  );

  const handleStart = async () => {
    setSubmitError(null);
    vision.resetAverages();
    await speech.start();
  };

  const handleReset = () => {
    setSubmitError(null);
    speech.reset();
    vision.resetAverages();
  };

  const handleEndAndAnalyze = async () => {
    setSubmitError(null);
    const snapshotTranscript = speech.state.fullTranscript.trim();
    const snapshotMetrics: LiveMetrics = {
      ...liveMetrics,
      eyeContactPct:
        vision.state.avgEyeContactPct > 0
          ? vision.state.avgEyeContactPct
          : vision.state.eyeContactPct,
      smilePct:
        vision.state.avgSmilePct > 0
          ? vision.state.avgSmilePct
          : vision.state.smilePct,
    };

    speech.stop();

    if (snapshotTranscript.length < 15) {
      setSubmitError(
        'Speak for a few seconds (or type/paste a short response in the transcript editor) before generating a coaching report.'
      );
      return;
    }

    const scores = calculateComponentScores(snapshotTranscript, snapshotMetrics);
    setGenerating(true);

    let aiFeedback: AICoachingFeedback | null = null;
    let aiError: string | undefined;

    const result = await postJson<{ feedback: AICoachingFeedback }>('/api/coaching/report', {
      context,
      topic,
      transcript: snapshotTranscript,
      metrics: snapshotMetrics,
      scores,
    });

    if (!result.ok || !result.data?.feedback) {
      aiError = result.error || 'Unable to generate AI coaching feedback right now.';
    } else {
      aiFeedback = result.data.feedback;
    }
    setGenerating(false);

    const report: LiveSessionReport = {
      id: `live-${Date.now()}`,
      kind: 'live',
      createdAt: new Date().toISOString(),
      context,
      topic,
      transcript: snapshotTranscript,
      metrics: snapshotMetrics,
      scores,
      aiFeedback,
      aiError,
    };

    vision.stopVision();
    onReportComplete(report);
  };

  const paceStatus =
    liveMetrics.wpm === 0
      ? { label: 'Waiting', color: 'text-[#7F9489]' }
      : liveMetrics.wpm > 180
      ? { label: 'Fast', color: 'text-amber-400' }
      : liveMetrics.wpm < 120
      ? { label: 'Slow', color: 'text-amber-400' }
      : { label: 'Optimal', color: 'text-emerald-400' };

  const paceBarPct = Math.min(100, Math.max(0, (liveMetrics.wpm / 220) * 100));
  const fillerBarPct = Math.min(100, (liveMetrics.fillerRatePerMin / 10) * 100);
  const loudnessPct = Math.min(100, Math.max(0, ((liveMetrics.loudnessDb + 60) / 60) * 100));

  return (
    <div className="mx-auto max-w-[1360px] px-6 py-7 space-y-6">
      {/* Studio Header & Context Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <div>
          <h1 className="font-display text-2xl font-bold text-white tracking-tight">
            Live Coaching Studio
          </h1>
          <p className="text-xs text-[#83988C] mt-1">
            Browser Web Speech transcription · Web Audio loudness · Optional on-device MediaPipe vision (no video uploaded)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-[#0D1411] p-1 border border-white/[0.08] overflow-x-auto">
            {CONTEXTS.map((ctx) => (
              <button
                key={ctx}
                type="button"
                disabled={speech.state.isRecording}
                onClick={() => handleContextChange(ctx)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-50 ${
                  context === ctx
                    ? 'bg-[#17241D] text-white'
                    : 'text-[#84988D] hover:text-[#D9E6DF]'
                }`}
              >
                {ctx}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => vision.toggleVision()}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
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
            {vision.state.loadingModel
              ? 'Loading Vision...'
              : vision.state.enabled
              ? 'Vision: ON'
              : 'Vision: OFF'}
          </button>
        </div>
      </div>

      {/* Topic / Prompt Bar */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-4 flex flex-col md:flex-row md:items-center gap-3">
        <label
          htmlFor="live-topic-input"
          className="text-xs font-medium text-[#84998E] whitespace-nowrap shrink-0"
        >
          Practice Prompt
        </label>
        <input
          id="live-topic-input"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Enter what you are practicing..."
          className="w-full rounded-lg border border-white/[0.08] bg-[#070B09] px-3 py-2 text-sm text-[#ECF2EE] placeholder-[#5A6E63] focus:border-emerald-500/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            const list = CONTEXT_PROMPTS[context];
            const nextIdx = (list.indexOf(topic) + 1) % list.length;
            setTopic(list[nextIdx]);
          }}
          className="rounded-lg border border-white/[0.1] bg-[#101814] px-3 py-2 text-xs font-medium text-[#B8C7BF] hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          Cycle Prompt
        </button>
      </div>

      {/* Error Banners */}
      {(speech.state.micError || vision.state.cameraError || submitError) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="space-y-1">
            {submitError && <p>{submitError}</p>}
            {speech.state.micError && <p>{speech.state.micError}</p>}
            {vision.state.cameraError && <p>{vision.state.cameraError}</p>}
          </div>
        </div>
      )}

      {/* Main Studio Grid (Figure 5.1 layout: Left Stage + Right Live Coaching Rail) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative overflow-hidden rounded-xl border border-white/[0.09] bg-[#090E0B]">
            {/* Top Stage Status Strip */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] bg-[#0B110E]">
              <div className="flex items-center gap-3 text-xs text-[#91A59A]">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#DCE7E0]">
                  {speech.state.isRecording && !speech.state.isPaused && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
                    />
                  )}
                  {speech.state.isRecording
                    ? speech.state.isPaused
                      ? 'Paused'
                      : 'Listening'
                    : 'Ready'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Mic: {speech.state.isRecording ? 'Active' : 'Idle'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Vision:{' '}
                  {vision.state.enabled
                    ? vision.state.faceDetected
                      ? 'Face tracked'
                      : vision.state.loadingModel
                      ? 'Loading model'
                      : 'Camera on'
                    : 'Off'}
                </span>
              </div>
              <div className="font-mono tabular-nums text-xs font-medium text-[#D6E3DC]">
                {formatDuration(speech.state.durationSec)}
              </div>
            </div>

            {/* Center Visual Viewport (Camera + MediaPipe OR Acoustic Ring Visualizer) */}
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#070B09]/90 via-[#070B09]/35 to-transparent" />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-6 px-6 text-center">
                  {/* Responsive Web Audio Acoustic Ring */}
                  <div
                    className="relative flex h-36 w-36 items-center justify-center rounded-full border border-emerald-500/25 transition-transform duration-150"
                    style={{
                      transform: `scale(${
                        speech.state.isRecording && !speech.state.isPaused
                          ? 1 + (loudnessPct / 100) * 0.16
                          : 1
                      })`,
                    }}
                  >
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-500/[0.07]">
                      <Mic
                        className={`h-8 w-8 transition-colors ${
                          speech.state.isRecording && !speech.state.isPaused
                            ? 'text-emerald-400'
                            : 'text-[#6D8377]'
                        }`}
                      />
                    </div>
                  </div>

                  {/* Real-Time Frequency Energy Bars */}
                  <div
                    aria-hidden="true"
                    className="flex h-10 items-end justify-center gap-1"
                  >
                    {speech.state.audioLevels.map((lvl, idx) => (
                      <div
                        key={idx}
                        className="w-1.5 rounded-full bg-emerald-400/75 transition-transform duration-75 origin-bottom"
                        style={{
                          height: '36px',
                          transform: `scaleY(${Math.max(0.1, lvl)})`,
                        }}
                      />
                    ))}
                  </div>

                  <p className="text-xs text-[#7E9287] max-w-xs">
                    {speech.state.isRecording
                      ? 'Audio analysis active. Enable Vision above for optional local eye-contact and smile tracking.'
                      : 'Press Start Session to begin live speech transcription and pacing analysis.'}
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Telemetry Strip (Exact Figure 5.1 Metrics) */}
            <div className="grid grid-cols-5 divide-x divide-white/[0.07] border-t border-white/[0.07] bg-[#0B110E] text-center">
              <div className="px-2 py-3">
                <div className="text-[11px] text-[#7D9186]">Loudness</div>
                <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white mt-0.5">
                  {liveMetrics.loudnessDb} dB
                </div>
              </div>
              <div className="px-2 py-3">
                <div className="text-[11px] text-[#7D9186]">Speaking</div>
                <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white mt-0.5">
                  {liveMetrics.speakingRatio}%
                </div>
              </div>
              <div className="px-2 py-3">
                <div className="text-[11px] text-[#7D9186]">Words</div>
                <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white mt-0.5">
                  {liveMetrics.wordCount}
                </div>
              </div>
              <div className="px-2 py-3">
                <div className="text-[11px] text-[#7D9186]">Eye Contact</div>
                <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white mt-0.5">
                  {vision.state.enabled ? `${liveMetrics.eyeContactPct}%` : '—'}
                </div>
              </div>
              <div className="px-2 py-3">
                <div className="text-[11px] text-[#7D9186]">Smile</div>
                <div className="font-mono tabular-nums text-xs sm:text-sm font-semibold text-white mt-0.5">
                  {vision.state.enabled ? `${liveMetrics.smilePct}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Primary Studio Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#0C120F] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {!speech.state.isRecording ? (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={generating}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Mic className="h-4 w-4" />
                  Start Session
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={speech.state.isPaused ? speech.resume : speech.pause}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.14] bg-[#131C17] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1A2620] transition-colors cursor-pointer"
                  >
                    {speech.state.isPaused ? (
                      <>
                        <Play className="h-4 w-4 text-emerald-400" />
                        Resume
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4 text-amber-300" />
                        Pause
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={speech.stop}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#101714] px-3.5 py-2.5 text-sm font-medium text-[#CBD8D1] hover:text-white transition-colors cursor-pointer"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop Mic
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleReset}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2.5 text-xs font-medium text-[#8FA398] hover:text-white hover:border-white/[0.18] transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>

            <button
              type="button"
              onClick={handleEndAndAnalyze}
              disabled={generating || speech.state.fullTranscript.trim().length < 10}
              className="inline-flex items-center gap-2 rounded-lg bg-[#E9F3ED] px-4 py-2.5 text-sm font-semibold text-[#06120B] hover:bg-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Report...
                </>
              ) : (
                'End & Generate Report'
              )}
            </button>
          </div>
        </div>

        {/* Right Live Coaching Rail (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Live Metrics Row: Pace + Fillers / min */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">Live Coaching</h2>
              <span className="text-xs text-[#7F9489]">Target 140–170 WPM · Aim &lt; 4/min</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Pace */}
              <div className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#83988C]">Pace (WPM)</span>
                  <span className={`font-medium ${paceStatus.color}`}>{paceStatus.label}</span>
                </div>
                <div className="font-mono tabular-nums text-3xl font-semibold text-white">
                  {liveMetrics.wpm}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      liveMetrics.wpm > 180 || (liveMetrics.wpm > 0 && liveMetrics.wpm < 120)
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${paceBarPct}%` }}
                  />
                </div>
                <div className="text-[11px] text-[#6F8479]">Reference target: 160 WPM</div>
              </div>

              {/* Fillers */}
              <div className="rounded-lg border border-white/[0.07] bg-[#080C0A] p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#83988C]">Fillers / min</span>
                  <span
                    className={`font-medium ${
                      liveMetrics.fillerRatePerMin >= 6
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {liveMetrics.fillerCount} total
                  </span>
                </div>
                <div className="font-mono tabular-nums text-3xl font-semibold text-white">
                  {liveMetrics.fillerRatePerMin}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className={`h-full rounded-full transition-all duration-150 ${
                      liveMetrics.fillerRatePerMin >= 6 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${fillerBarPct}%` }}
                  />
                </div>
                <div className="text-[11px] text-[#6F8479] truncate">
                  {liveMetrics.topFillers.length > 0
                    ? `Top: ${liveMetrics.topFillers
                        .slice(0, 2)
                        .map((f) => `"${f.word}" (${f.count})`)
                        .join(', ')}`
                    : 'No fillers detected'}
                </div>
              </div>
            </div>

            {/* Real-Time Nudges */}
            <div className="pt-2 border-t border-white/[0.07] space-y-2">
              <div className="text-xs font-medium text-[#83988C]">Coaching Nudges</div>
              <div className="space-y-2">
                {nudges.map((nudge) => (
                  <div
                    key={nudge.id}
                    className="rounded-lg border border-white/[0.06] bg-[#080C0A] px-3.5 py-2.5 text-xs leading-relaxed"
                  >
                    <span
                      className={`font-semibold mr-2 ${
                        nudge.tone === 'positive'
                          ? 'text-emerald-400'
                          : nudge.tone === 'caution'
                          ? 'text-amber-300'
                          : 'text-[#9AB0A4]'
                      }`}
                    >
                      {nudge.label}:
                    </span>
                    <span className="text-[#C8D6CE]">{nudge.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Live Transcript Panel */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0C120F] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">Live Transcript</h2>
              <button
                type="button"
                onClick={() => setEditMode((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-[#8FA499] hover:text-white cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {editMode ? 'View Highlighted' : 'Edit / Type Text'}
              </button>
            </div>

            {editMode ? (
              <textarea
                rows={7}
                value={speech.state.fullTranscript}
                onChange={(e) => speech.setManualTranscript(e.target.value)}
                placeholder="Type or paste a practice response if you are testing without a microphone or correcting recognition errors..."
                className="w-full rounded-lg border border-white/[0.1] bg-[#070B09] p-3 text-sm text-[#E5EFE9] placeholder-[#5B6F64] leading-relaxed focus:border-emerald-500/60 focus:outline-none resize-y"
              />
            ) : (
              <div className="min-h-[168px] max-h-[260px] overflow-y-auto rounded-lg border border-white/[0.06] bg-[#080C0A] p-4 text-sm leading-relaxed text-[#DCE7E0]">
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
                    Waiting for speech... Start your session and speak naturally, or switch to
                    &ldquo;Edit / Type Text&rdquo; to evaluate a written draft.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-[#708479]">
              <span>Filler words highlighted automatically in amber</span>
              <span className="font-mono tabular-nums">{liveMetrics.wordCount} words</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
