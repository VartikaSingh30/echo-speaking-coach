import type { AppView } from '../types/echo';

interface AboutPageProps {
  onNavigate: (view: AppView) => void;
}

export function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <div className="mx-auto max-w-[1120px] px-6 py-12 space-y-10">
      {/* Header */}
      <section className="space-y-4 pb-8 border-b border-white/[0.08]">
        <p className="text-xs font-medium text-emerald-400">
          System Architecture &amp; Methodology
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
          How Echo Works
        </h1>
        <p className="text-base text-[#A3B5AB] leading-relaxed max-w-2xl">
          Echo integrates browser-native speech transcription and audio analysis, on-device
          MediaPipe facial landmark estimation, deterministic speaking-metric heuristics, and
          free-tier Gemini coaching generation into a unified speaking-practice studio.
        </p>
      </section>

      {/* Three-Column Architecture Breakdown */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 space-y-3">
          <div className="font-mono text-xs text-emerald-400">01 · Speech &amp; Audio</div>
          <h2 className="font-display text-lg font-semibold text-white">
            Web Speech &amp; Web Audio
          </h2>
          <p className="text-sm text-[#95A99E] leading-relaxed">
            Microphone audio is analyzed locally via the Web Audio API for loudness (dB) and
            speaking ratio while the browser&apos;s Web Speech API streams interim and finalized
            transcripts alongside real-time coaching nudges.
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 space-y-3">
          <div className="font-mono text-xs text-emerald-400">02 · Browser Vision</div>
          <h2 className="font-display text-lg font-semibold text-white">
            MediaPipe FaceLandmarker
          </h2>
          <p className="text-sm text-[#95A99E] leading-relaxed">
            Camera frames are processed strictly inside your browser using MediaPipe Tasks Vision to
            estimate eye contact and smiling cues. Video frames are never uploaded to the server.
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-6 space-y-3">
          <div className="font-mono text-xs text-emerald-400">03 · Generative AI</div>
          <h2 className="font-display text-lg font-semibold text-white">
            Gemini Coaching &amp; Rubrics
          </h2>
          <p className="text-sm text-[#95A99E] leading-relaxed">
            At session completion, transcript and delivery metrics are analyzed server-side using
            free-tier Gemini to generate strengths, English coaching, STAR rewrites, mock interview
            rubrics, and a 7-day practice plan.
          </p>
        </div>
      </section>

      {/* Documented Scoring Formulas */}
      <section className="rounded-xl border border-white/[0.09] bg-[#0C120F] p-7 space-y-6">
        <h2 className="font-display text-xl font-semibold text-white">
          Documented Scoring Formulas
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <div className="text-xs text-[#83988C]">Overall Session Score</div>
            <div className="font-mono tabular-nums text-lg sm:text-xl font-medium text-emerald-400">
              T = 0.30D + 0.25C + 0.25P + 0.20S
            </div>
            <ul className="space-y-1.5 text-sm text-[#A2B4AA]">
              <li>D (30%): Delivery — speaking pace (~160 WPM target) &amp; pause balance</li>
              <li>C (25%): Clarity — filler-word frequency per minute</li>
              <li>P (25%): Presence — visual engagement score</li>
              <li>S (20%): Structure — length, sentence coherence, transitions &amp; examples</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div className="text-xs text-[#83988C]">Presence &amp; Rate Formulas</div>
            <div className="font-mono tabular-nums text-lg sm:text-xl font-medium text-emerald-400">
              P = 0.60E + 0.40M
            </div>
            <ul className="space-y-1.5 text-sm text-[#A2B4AA]">
              <li>E: Estimated Eye-Contact Score (0–100) from MediaPipe gaze &amp; head orientation</li>
              <li>M: Estimated Smile Score (0–100) from MediaPipe facial blendshapes</li>
            </ul>
            <div className="pt-2 space-y-1 font-mono tabular-nums text-xs text-[#889D91]">
              <div>WPM = Total Words / Speaking Time (min)</div>
              <div>Filler Rate = Detected Fillers / Speaking Time (min)</div>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy & Scope Note */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#0A100D] px-6 py-5">
        <div className="space-y-1 max-w-2xl">
          <h3 className="font-display text-sm font-semibold text-white">
            Coaching Indicators &amp; Local Storage
          </h3>
          <p className="text-xs text-[#8A9E93] leading-relaxed">
            Echo&apos;s automated scores, visual cues, and interview readiness signals are intended
            as practice indicators rather than definitive human or hiring evaluations. Saved
            coaching reports remain privately in your browser&apos;s localStorage.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('live')}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-[#04120B] hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap"
          >
            Start Live Session
          </button>
          <button
            type="button"
            onClick={() => onNavigate('interview')}
            className="rounded-lg border border-white/[0.12] bg-[#101814] px-4 py-2 text-xs font-medium text-[#DDE8E1] hover:bg-[#17221C] transition-colors cursor-pointer whitespace-nowrap"
          >
            Try Mock Interview
          </button>
        </div>
      </section>
    </div>
  );
}
