import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

export interface VisionAnalysisState {
  enabled: boolean;
  loadingModel: boolean;
  modelReady: boolean;
  cameraError: string | null;
  faceDetected: boolean;
  eyeContactPct: number;
  smilePct: number;
  avgEyeContactPct: number;
  avgSmilePct: number;
}

const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export function useVisionAnalysis(isRecording: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [eyeContactPct, setEyeContactPct] = useState(0);
  const [smilePct, setSmilePct] = useState(0);
  const [avgEyeContactPct, setAvgEyeContactPct] = useState(0);
  const [avgSmilePct, setAvgSmilePct] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const enabledRef = useRef(false);
  const recordingRef = useRef(isRecording);

  const smoothedEyeRef = useRef(0);
  const smoothedSmileRef = useRef(0);
  const sampleCountRef = useRef(0);
  const sumEyeRef = useRef(0);
  const sumSmileRef = useRef(0);

  useEffect(() => {
    recordingRef.current = isRecording;
  }, [isRecording]);

  const resetAverages = useCallback(() => {
    sampleCountRef.current = 0;
    sumEyeRef.current = 0;
    sumSmileRef.current = 0;
    setAvgEyeContactPct(0);
    setAvgSmilePct(0);
  }, []);

  const stopVision = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setFaceDetected(false);

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  const startDetectionLoop = useCallback(() => {
    let lastProcessed = 0;

    const tick = (now: number) => {
      if (!enabledRef.current) return;
      rafRef.current = requestAnimationFrame(tick);

      // Run MediaPipe inference at ~12 fps to keep CPU low and browser smooth
      if (now - lastProcessed < 80) return;
      lastProcessed = now;

      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2 || video.videoWidth === 0) {
        return;
      }

      try {
        const result = landmarker.detectForVideo(video, now);
        const landmarks = result.faceLandmarks?.[0];
        const blendshapes = result.faceBlendshapes?.[0]?.categories;

        // Draw subtle minimalist landmark cues on overlay canvas
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (landmarks && landmarks.length > 460) {
              // Subtle key points around eyes and mouth (mirrored to match video)
              const keyIndices = [33, 133, 362, 263, 468, 473, 61, 291, 13, 14, 1];
              ctx.fillStyle = 'rgba(16, 185, 129, 0.72)';
              for (const idx of keyIndices) {
                const pt = landmarks[idx];
                if (!pt) continue;
                const x = (1 - pt.x) * canvas.width;
                const y = pt.y * canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, idx === 468 || idx === 473 ? 3 : 2, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }

        if (!landmarks || landmarks.length === 0) {
          setFaceDetected(false);
          smoothedEyeRef.current = smoothedEyeRef.current * 0.85;
          smoothedSmileRef.current = smoothedSmileRef.current * 0.85;
          setEyeContactPct(Math.round(smoothedEyeRef.current));
          setSmilePct(Math.round(smoothedSmileRef.current));
          return;
        }

        setFaceDetected(true);

        // Estimate eye contact from gaze blendshapes + horizontal face centering
        let rawEyeContact = 75;
        let rawSmile = 20;

        if (blendshapes && blendshapes.length > 0) {
          const getScore = (name: string) =>
            blendshapes.find((b) => b.categoryName === name)?.score ?? 0;

          const gazeDeviation =
            (getScore('eyeLookOutLeft') +
              getScore('eyeLookInLeft') +
              getScore('eyeLookOutRight') +
              getScore('eyeLookInRight') +
              getScore('eyeLookUpLeft') +
              getScore('eyeLookUpRight') +
              getScore('eyeLookDownLeft') +
              getScore('eyeLookDownRight')) /
            4;

          const blinkPenalty = (getScore('eyeBlinkLeft') + getScore('eyeBlinkRight')) * 0.15;

          // Check head yaw/centering using nose tip (1) vs outer cheeks (234, 454)
          const nose = landmarks[1];
          const leftCheek = landmarks[234];
          const rightCheek = landmarks[454];
          let yawPenalty = 0;
          if (nose && leftCheek && rightCheek) {
            const faceWidth = Math.max(0.05, Math.abs(rightCheek.x - leftCheek.x));
            const midX = (leftCheek.x + rightCheek.x) / 2;
            const yawRatio = Math.abs(nose.x - midX) / faceWidth;
            yawPenalty = Math.min(0.65, yawRatio * 1.9);
          }

          rawEyeContact = Math.max(
            0,
            Math.min(100, (1 - Math.min(1, gazeDeviation * 1.25 + yawPenalty + blinkPenalty)) * 100)
          );

          const smileAvg = (getScore('mouthSmileLeft') + getScore('mouthSmileRight')) / 2;
          rawSmile = Math.max(0, Math.min(100, smileAvg * 135));
        }

        // Exponential smoothing to prevent jitter
        smoothedEyeRef.current =
          smoothedEyeRef.current === 0
            ? rawEyeContact
            : smoothedEyeRef.current * 0.72 + rawEyeContact * 0.28;
        smoothedSmileRef.current =
          smoothedSmileRef.current === 0
            ? rawSmile
            : smoothedSmileRef.current * 0.72 + rawSmile * 0.28;

        const nextEye = Math.round(smoothedEyeRef.current);
        const nextSmile = Math.round(smoothedSmileRef.current);
        setEyeContactPct(nextEye);
        setSmilePct(nextSmile);

        if (recordingRef.current) {
          sampleCountRef.current += 1;
          sumEyeRef.current += nextEye;
          sumSmileRef.current += nextSmile;
          setAvgEyeContactPct(Math.round(sumEyeRef.current / sampleCountRef.current));
          setAvgSmilePct(Math.round(sumSmileRef.current / sampleCountRef.current));
        }
      } catch {
        // Ignore single-frame inference hiccups
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startVision = useCallback(async () => {
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      enabledRef.current = true;
      setEnabled(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraError(
        'Camera permission was denied or no webcam was found. Audio-only coaching continues normally.'
      );
      stopVision();
      return false;
    }

    // Lazily initialize on-device MediaPipe FaceLandmarker
    if (!landmarkerRef.current) {
      setLoadingModel(true);
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        landmarkerRef.current = landmarker;
        setModelReady(true);
      } catch {
        // Retry with CPU delegate if WebGL delegate fails
        try {
          const vision = await import('@mediapipe/tasks-vision');
          const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
          const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: FACE_LANDMARKER_MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
          });
          landmarkerRef.current = landmarker;
          setModelReady(true);
        } catch {
          setCameraError(
            'Camera preview is active, but the MediaPipe facial landmark model could not load (check network access). Visual scores will remain paused.'
          );
        }
      } finally {
        setLoadingModel(false);
      }
    }

    if (enabledRef.current && landmarkerRef.current) {
      startDetectionLoop();
    }
    return true;
  }, [startDetectionLoop, stopVision]);

  const toggleVision = useCallback(async () => {
    if (enabledRef.current) {
      stopVision();
    } else {
      await startVision();
    }
  }, [startVision, stopVision]);

  // Bind stream if video element mounts slightly after stream acquisition
  useEffect(() => {
    if (enabled && streamRef.current && videoRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      stopVision();
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, [stopVision]);

  return {
    videoRef,
    canvasRef,
    state: {
      enabled,
      loadingModel,
      modelReady,
      cameraError,
      faceDetected,
      eyeContactPct,
      smilePct,
      avgEyeContactPct,
      avgSmilePct,
    } as VisionAnalysisState,
    startVision,
    stopVision,
    toggleVision,
    resetAverages,
  };
}
