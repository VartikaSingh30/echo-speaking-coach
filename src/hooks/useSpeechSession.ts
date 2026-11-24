import { useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateFillerRatePerMin,
  calculateWpm,
  countWords,
  detectFillers,
} from '../utils/scoring';
import type { FillerCountItem } from '../types/echo';

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      0: { transcript: string };
    };
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export interface SpeechSessionState {
  isRecording: boolean;
  isPaused: boolean;
  speechSupported: boolean;
  micError: string | null;
  durationSec: number;
  finalTranscript: string;
  interimTranscript: string;
  fullTranscript: string;
  wordCount: number;
  wpm: number;
  fillerCount: number;
  fillerRatePerMin: number;
  fillerRatioPct: number;
  topFillers: FillerCountItem[];
  loudnessDb: number;
  speakingRatio: number;
  pauseCount: number;
  audioLevels: number[];
}

export function useSpeechSession() {
  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [loudnessDb, setLoudnessDb] = useState(-60);
  const [speakingRatio, setSpeakingRatio] = useState(0);
  const [pauseCount, setPauseCount] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => Array(24).fill(0.06));

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const totalSamplesRef = useRef(0);
  const speakingSamplesRef = useRef(0);
  const wasSpeakingRef = useRef(false);
  const silenceFramesRef = useRef(0);

  const cleanupAudioAndSpeech = useCallback(() => {
    activeRef.current = false;
    pausedRef.current = false;

    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      recognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
    setLoudnessDb(-60);
    setAudioLevels(Array(24).fill(0.06));
  }, []);

  const startRecognitionInstance = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (pausedRef.current) return;
      let newFinal = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) {
          newFinal += `${piece.trim()} `;
        } else {
          currentInterim += piece;
        }
      }

      if (newFinal) {
        setFinalTranscript((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${newFinal}`);
      }
      setInterimTranscript(currentInterim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicError(
          'Microphone permission was denied for speech recognition. Allow microphone access or use the manual transcript box below.'
        );
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setMicError(
          `Browser speech recognition reported "${event.error}". Audio loudness is still active, and you can edit the transcript manually.`
        );
      }
    };

    recognition.onend = () => {
      if (activeRef.current && !pausedRef.current) {
        try {
          recognition.start();
        } catch {
          // Ignore rapid restart race
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Ignore already started
    }
  }, []);

  const startAudioLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const timeDomain = new Float32Array(analyser.fftSize);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    let lastUiUpdate = 0;

    const loop = (now: number) => {
      if (!activeRef.current) return;
      rafRef.current = requestAnimationFrame(loop);

      if (pausedRef.current) return;

      if (now - lastUiUpdate < 75) return;
      lastUiUpdate = now;

      analyser.getFloatTimeDomainData(timeDomain);
      let sumSquares = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        sumSquares += timeDomain[i] * timeDomain[i];
      }
      const rms = Math.sqrt(sumSquares / timeDomain.length);
      const db = rms > 0.0001 ? Math.max(-60, Math.min(0, Math.round(20 * Math.log10(rms)))) : -60;
      setLoudnessDb(db);

      const isSpeakingNow = db > -43;
      totalSamplesRef.current += 1;
      if (isSpeakingNow) {
        speakingSamplesRef.current += 1;
        silenceFramesRef.current = 0;
        wasSpeakingRef.current = true;
      } else if (wasSpeakingRef.current) {
        silenceFramesRef.current += 1;
        // Count deliberate pause (~1.2s of silence after speaking)
        if (silenceFramesRef.current === 16) {
          setPauseCount((p) => p + 1);
          wasSpeakingRef.current = false;
        }
      }

      if (totalSamplesRef.current > 0) {
        setSpeakingRatio(
          Math.round((speakingSamplesRef.current / totalSamplesRef.current) * 100)
        );
      }

      analyser.getByteFrequencyData(freqData);
      const bars: number[] = [];
      const stride = Math.max(1, Math.floor(freqData.length / 28));
      for (let i = 0; i < 24; i++) {
        const val = freqData[i * stride] ?? 0;
        bars.push(Math.max(0.06, Math.min(1, val / 210)));
      }
      setAudioLevels(bars);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(async () => {
    setMicError(null);
    cleanupAudioAndSpeech();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch {
      setMicError(
        'Unable to access microphone. Grant browser microphone permission or type/paste your speech in the transcript editor.'
      );
      return false;
    }

    activeRef.current = true;
    pausedRef.current = false;
    setIsRecording(true);
    setIsPaused(false);

    timerRef.current = window.setInterval(() => {
      if (activeRef.current && !pausedRef.current) {
        setDurationSec((prev) => prev + 1);
      }
    }, 1000);

    startAudioLoop();
    if (speechSupported) {
      startRecognitionInstance();
    } else {
      setMicError(
        'Your browser does not support the built-in Web Speech API (Chrome or Edge recommended). Loudness tracking is active — you can type or paste your transcript below.'
      );
    }

    return true;
  }, [cleanupAudioAndSpeech, speechSupported, startAudioLoop, startRecognitionInstance]);

  const pause = useCallback(() => {
    if (!activeRef.current) return;
    pausedRef.current = true;
    setIsPaused(true);
    setInterimTranscript('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }
  }, []);

  const resume = useCallback(() => {
    if (!activeRef.current) return;
    pausedRef.current = false;
    setIsPaused(false);
    if (speechSupported) {
      startRecognitionInstance();
    }
  }, [speechSupported, startRecognitionInstance]);

  const stop = useCallback(() => {
    setInterimTranscript((currInterim) => {
      if (currInterim.trim()) {
        setFinalTranscript((prev) =>
          `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${currInterim.trim()} `
        );
      }
      return '';
    });
    cleanupAudioAndSpeech();
    setIsRecording(false);
    setIsPaused(false);
  }, [cleanupAudioAndSpeech]);

  const reset = useCallback(() => {
    cleanupAudioAndSpeech();
    setIsRecording(false);
    setIsPaused(false);
    setMicError(null);
    setDurationSec(0);
    setFinalTranscript('');
    setInterimTranscript('');
    setSpeakingRatio(0);
    setPauseCount(0);
    totalSamplesRef.current = 0;
    speakingSamplesRef.current = 0;
    wasSpeakingRef.current = false;
    silenceFramesRef.current = 0;
  }, [cleanupAudioAndSpeech]);

  const setManualTranscript = useCallback((value: string) => {
    setFinalTranscript(value);
    setInterimTranscript('');
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudioAndSpeech();
    };
  }, [cleanupAudioAndSpeech]);

  const fullTranscript = `${finalTranscript}${interimTranscript}`.trim();
  const wordCount = countWords(fullTranscript);
  const wpm = calculateWpm(wordCount, durationSec);
  const { total: fillerCount, breakdown: topFillers } = detectFillers(fullTranscript);
  const fillerRatePerMin = calculateFillerRatePerMin(fillerCount, durationSec);
  const fillerRatioPct =
    wordCount > 0 ? Number(((fillerCount / wordCount) * 100).toFixed(1)) : 0;

  return {
    state: {
      isRecording,
      isPaused,
      speechSupported,
      micError,
      durationSec,
      finalTranscript,
      interimTranscript,
      fullTranscript,
      wordCount,
      wpm,
      fillerCount,
      fillerRatePerMin,
      fillerRatioPct,
      topFillers,
      loudnessDb,
      speakingRatio,
      pauseCount,
      audioLevels,
    } as SpeechSessionState,
    start,
    pause,
    resume,
    stop,
    reset,
    setManualTranscript,
  };
}
