import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = 'gemini-3.1-flash-lite'; // Fast free-tier Gemini Flash Lite model (avoids >60s proxy timeouts)

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const statusProp =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      const isTransient =
        statusProp === 500 ||
        statusProp === 502 ||
        statusProp === 503 ||
        statusProp === 504 ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('DEADLINE_EXCEEDED');
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastErr;
}

// Simple per-IP sliding-window rate limiter to protect free-tier quota
const rateLimitBuckets = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 24;

function apiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    res.status(429).json({
      error: 'Too many coaching requests in a short window. Please wait a few seconds and try again.',
    });
    return;
  }
  timestamps.push(now);
  rateLimitBuckets.set(ip, timestamps);
  next();
}

function clampString(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLen);
}

function clampNumber(value: unknown, min: number, max: number, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function formatGeminiError(err: unknown): { status: number; message: string; code?: string } {
  if (err instanceof Error && err.message === 'MISSING_API_KEY') {
    return {
      status: 503,
      code: 'MISSING_API_KEY',
      message:
        'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable AI coaching reports and mock interviews.',
    };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 0;
  console.error('[Echo Gemini Error]', statusProp || 'unknown', raw.slice(0, 400));

  if (
    statusProp === 403 ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('403')
  ) {
    return {
      status: 403,
      code: 'AUTH_ERROR',
      message:
        'The configured Gemini API key was rejected. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (statusProp === 429 || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      code: 'RATE_LIMIT',
      message:
        'The free-tier Gemini API rate limit was temporarily reached. Please wait a moment and retry.',
    };
  }
  if (statusProp === 404 || raw.includes('NOT_FOUND') || raw.includes('404')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: `Requested Gemini model (${GEMINI_MODEL}) was not found or is unavailable for this API key.`,
    };
  }
  if (statusProp === 400 || raw.includes('INVALID_ARGUMENT') || raw.includes('400')) {
    return {
      status: 400,
      code: 'INVALID_ARGUMENT',
      message: `Gemini API rejected the request parameters: ${raw.slice(0, 180)}`,
    };
  }
  return {
    status: 500,
    code: 'AI_ERROR',
    message: `AI coaching service error: ${raw.slice(0, 180)}`,
  };
}

async function createServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({ ok: true, aiConfigured: hasKey });
  });

  // 1. Live Coaching Session AI Report Generation
  app.post('/api/coaching/report', apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const context = clampString(req.body?.context, 80, 'Interview');
      const topic = clampString(req.body?.topic, 300, 'General Speaking Practice');
      const transcript = clampString(req.body?.transcript, 15000);

      if (transcript.length < 15) {
        res.status(400).json({
          error: 'Please speak or enter at least a few sentences before generating an AI coaching report.',
        });
        return;
      }

      const metrics = req.body?.metrics ?? {};
      const scores = req.body?.scores ?? {};

      const wpm = clampNumber(metrics.wpm, 0, 400, 0);
      const fillerCount = clampNumber(metrics.fillerCount, 0, 500, 0);
      const fillerRatePerMin = clampNumber(metrics.fillerRatePerMin, 0, 120, 0);
      const durationSec = clampNumber(metrics.durationSec, 0, 7200, 0);
      const speakingRatio = clampNumber(metrics.speakingRatio, 0, 100, 0);
      const eyeContactPct =
        metrics.visionEnabled ? clampNumber(metrics.eyeContactPct, 0, 100, 0) : null;
      const smilePct = metrics.visionEnabled ? clampNumber(metrics.smilePct, 0, 100, 0) : null;
      const topFillers = Array.isArray(metrics.topFillers)
        ? metrics.topFillers
            .slice(0, 6)
            .map((f: { word?: unknown; count?: unknown }) => `${clampString(f?.word, 24)} (${clampNumber(f?.count, 0, 200)})`)
            .join(', ')
        : 'None detected';

      const prompt = `Analyze this speaking practice session for Echo, an AI speaking coach.
Practice Context: ${context}
Prompt / Topic: ${topic}
Session Duration: ${Math.round(durationSec)} seconds
Speaking Metrics:
- Words Per Minute (WPM): ${Math.round(wpm)} (reference coaching target ~140-170 WPM)
- Filler Words: ${fillerCount} total (${fillerRatePerMin.toFixed(1)}/min; top fillers: ${topFillers})
- Active Speaking Time: ${Math.round(speakingRatio)}%
- Eye Contact Estimate (browser MediaPipe): ${eyeContactPct !== null ? `${Math.round(eyeContactPct)}%` : 'Camera not enabled'}
- Smile Estimate (browser MediaPipe): ${smilePct !== null ? `${Math.round(smilePct)}%` : 'Camera not enabled'}
Computed Component Scores (0-100):
- Delivery: ${clampNumber(scores.delivery, 0, 100)}
- Clarity: ${clampNumber(scores.clarity, 0, 100)}
- Presence: ${clampNumber(scores.presence, 0, 100)}
- Structure: ${clampNumber(scores.structure, 0, 100)}
- Overall: ${clampNumber(scores.overall, 0, 100)}

Transcript:
"""
${transcript}
"""

Generate a practical, encouraging, specific coaching report grounded directly in the transcript and metrics above.
- Keep strengths and improvement areas concrete and specific to what the speaker actually said.
- In englishCoaching, provide 2 to 4 concrete phrasing upgrades quoting actual phrases from the transcript (if the transcript is short, give 2 upgrades).
- In starSuggestion, reorganize the speaker's content into clear Situation, Task, Action, Result sections and a cohesive polishedAnswer they could say next time.
- In sevenDayPlan, provide exactly 7 concise daily practice drills (Day 1 to Day 7) targeting their actual gaps.`;

      const ai = getGeminiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction:
              'You are Echo, an expert communication and placement-interview speaking coach. Give clear, grounded, practical feedback without hype or robotic filler. Treat automated metrics and visual estimates as directional coaching cues rather than clinical measurements.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: '2-3 sentence executive summary of the speaking session.',
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3-4 concrete strengths grounded in the transcript and metrics.',
              },
              areasForImprovement: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3-4 actionable improvement areas with concrete advice.',
              },
              englishCoaching: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    original: { type: Type.STRING, description: 'Original phrasing from transcript.' },
                    improved: { type: Type.STRING, description: 'Clearer, more concise phrasing.' },
                    reason: { type: Type.STRING, description: 'Brief explanation of why it improves clarity.' },
                  },
                  required: ['original', 'improved', 'reason'],
                },
              },
              starSuggestion: {
                type: Type.OBJECT,
                properties: {
                  situation: { type: Type.STRING },
                  task: { type: Type.STRING },
                  action: { type: Type.STRING },
                  result: { type: Type.STRING },
                  polishedAnswer: {
                    type: Type.STRING,
                    description: 'A natural, spoken-style structured rewrite under 160 words.',
                  },
                },
                required: ['situation', 'task', 'action', 'result', 'polishedAnswer'],
              },
              sevenDayPlan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    day: { type: Type.INTEGER },
                    focus: { type: Type.STRING },
                    exercise: { type: Type.STRING },
                    durationMinutes: { type: Type.INTEGER },
                  },
                  required: ['day', 'focus', 'exercise', 'durationMinutes'],
                },
              },
            },
            required: [
              'summary',
              'strengths',
              'areasForImprovement',
              'englishCoaching',
              'starSuggestion',
              'sevenDayPlan',
            ],
          },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({ feedback: parsed });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 2. Mock Interview Question Generation
  app.post('/api/interview/questions', apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const role = clampString(req.body?.role, 80, 'Software Engineer');
      const difficulty = clampString(req.body?.difficulty, 40, 'Intermediate');
      const focus = clampString(req.body?.focus, 60, 'Mixed Behavioral & Technical');
      const count = clampNumber(req.body?.count, 2, 6, 3);

      const prompt = `Generate ${count} realistic, distinct interview questions for a candidate preparing for:
- Target Role: ${role}
- Difficulty Level: ${difficulty}
- Interview Focus: ${focus}

Each question should be clear, spoken-friendly (something a real interviewer asks aloud), and include a short practical coaching hint and the target competency being assessed.`;

      const ai = getGeminiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction:
              'You are a thoughtful technical and placement interviewer designing structured practice questions.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    question: { type: Type.STRING },
                    category: { type: Type.STRING },
                    targetCompetency: { type: Type.STRING },
                    hint: { type: Type.STRING },
                  },
                  required: ['id', 'question', 'category', 'targetCompetency', 'hint'],
                },
              },
            },
            required: ['questions'],
          },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{"questions":[]}').trim());
      res.json({ questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, count) : [] });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // 3. Mock Interview Rubric-Based Answer Evaluation
  app.post('/api/interview/evaluate', apiRateLimiter, async (req: Request, res: Response) => {
    try {
      const role = clampString(req.body?.role, 80, 'Software Engineer');
      const difficulty = clampString(req.body?.difficulty, 40, 'Intermediate');
      const focus = clampString(req.body?.focus, 60, 'Mixed Behavioral & Technical');
      const rawAnswers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 8) : [];

      if (rawAnswers.length === 0) {
        res.status(400).json({ error: 'No interview answers were provided for evaluation.' });
        return;
      }

      const formattedQA = rawAnswers
        .map(
          (
            item: {
              question?: unknown;
              category?: unknown;
              answer?: unknown;
              wpm?: unknown;
              fillerCount?: unknown;
              durationSec?: unknown;
            },
            idx: number
          ) => {
            const q = clampString(item?.question, 500, `Question ${idx + 1}`);
            const cat = clampString(item?.category, 60, 'General');
            const ans = clampString(item?.answer, 4000, '(No response recorded)');
            const wpm = clampNumber(item?.wpm, 0, 400, 0);
            const fillers = clampNumber(item?.fillerCount, 0, 200, 0);
            const dur = clampNumber(item?.durationSec, 0, 1800, 0);
            return `Q${idx + 1} [${cat}]: ${q}
Candidate Answer (${Math.round(dur)}s, ${Math.round(wpm)} WPM, ${fillers} fillers):
"${ans}"`;
          }
        )
        .join('\n\n---\n\n');

      const prompt = `Evaluate this mock interview using a structured rubric.
Role: ${role}
Difficulty: ${difficulty}
Focus: ${focus}

${formattedQA}

Score each question from 0 to 100 on:
1. relevance (directly answers the prompt)
2. clarity (concise, easy to follow, minimal hedging)
3. structure (logical flow, STAR format for behavioral or clear framework for technical)
4. depth (concrete examples, trade-offs, technical/role specifics)

For each question provide constructive feedback and a concise modelAnswer (under 130 words).
Then provide an overall readinessLevel ("Interview Ready", "Nearly Ready", or "Needs Focused Practice"), readinessSummary, overallRubricScore (0-100), topStrengths (3 items), priorityGaps (3 items), and a 5-step practicePlan.`;

      const ai = getGeminiClient();
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            systemInstruction:
              'You are an objective, constructive interview coach evaluating practice answers against a transparent rubric. Remember this is a practice readiness indicator, not a hiring decision.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              readinessLevel: {
                type: Type.STRING,
                description: 'One of: Interview Ready, Nearly Ready, Needs Focused Practice',
              },
              readinessSummary: { type: Type.STRING },
              overallRubricScore: { type: Type.INTEGER },
              questionEvaluations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionIndex: { type: Type.INTEGER },
                    relevance: { type: Type.INTEGER },
                    clarity: { type: Type.INTEGER },
                    structure: { type: Type.INTEGER },
                    depth: { type: Type.INTEGER },
                    overallQuestionScore: { type: Type.INTEGER },
                    feedback: { type: Type.STRING },
                    modelAnswer: { type: Type.STRING },
                  },
                  required: [
                    'questionIndex',
                    'relevance',
                    'clarity',
                    'structure',
                    'depth',
                    'overallQuestionScore',
                    'feedback',
                    'modelAnswer',
                  ],
                },
              },
              topStrengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              priorityGaps: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              practicePlan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    day: { type: Type.INTEGER },
                    focus: { type: Type.STRING },
                    exercise: { type: Type.STRING },
                    durationMinutes: { type: Type.INTEGER },
                  },
                  required: ['day', 'focus', 'exercise', 'durationMinutes'],
                },
              },
            },
            required: [
              'readinessLevel',
              'readinessSummary',
              'overallRubricScore',
              'questionEvaluations',
              'topStrengths',
              'priorityGaps',
              'practicePlan',
            ],
          },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({ evaluation: parsed });
    } catch (err) {
      const { status, message } = formatGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Mount Vite middleware in development or serve production static dist/
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Echo server running on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start Echo server:', err);
  process.exit(1);
});
