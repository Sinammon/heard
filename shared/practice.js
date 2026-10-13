import { z } from 'zod';
import { MAX_SCRIPT_CHARS } from './limits.js';

// Mode definitions drive preparation, setup, and review without adding parallel screen trees.
export const PRACTICE_MODES = Object.freeze([
  {
    id: 'free',
    title: 'Free practice',
    description: 'Use your script or talking points. Focus on delivery.',
    startLabel: 'Start practice',
  },
  {
    id: 'memorization',
    title: 'Memorization test',
    description: 'Study against the clock, then speak from key points.',
    startLabel: 'Start memorizing',
  },
  {
    id: 'impromptu',
    title: 'Impromptu Speaking',
    description: 'One surprise topic. Find your point on the spot.',
    startLabel: 'Prepare my topic',
  },
  {
    id: 'interview',
    title: 'AI Interview',
    description: 'Answer questions and thoughtful follow-ups.',
    startLabel: 'Start interview',
  },
  {
    id: 'delivery',
    title: 'Delivery Coach',
    description: 'Build one speaking habit, one take at a time.',
    startLabel: 'Start my drill',
  },
]);
export const difficultySchema = z.enum(['easy', 'standard', 'challenging']);
export const topicInputSchema = z.object({
  cloudConsent: z.literal(true),
  category: z.enum(['everyday', 'ideas', 'work', 'storytelling']),
  difficulty: difficultySchema,
});
export const topicOutputSchema = z.object({ topic: z.string().trim().min(10).max(600) });
export const questionOutputSchema = z.object({ question: z.string().trim().min(10).max(700) });
export const DRILLS = Object.freeze({
  free: [
    'Speak freely',
    'Choose an idea you care about. Explain it with one example and a clear ending.',
  ],
  pace: [
    'Find your pace',
    'Explain a familiar process. Aim for a steady 110–180 words per minute without rushing your ending.',
  ],
  pauses: [
    'Give ideas room',
    'Tell a short story. Pause briefly between phrases and let each sentence end before starting the next.',
  ],
  fillers: [
    'Replace the filler',
    'Describe a decision you made. When you need to think, leave a quiet beat instead of filling it.',
  ],
  expression: [
    'Add vocal expression',
    'Explain something that matters to you. Emphasize a few meaningful words and vary your phrasing naturally.',
  ],
});
export const practiceMode = (id) =>
  PRACTICE_MODES.find((mode) => mode.id === id) || PRACTICE_MODES[0];
export const referenceScriptSchema = z
  .string()
  .trim()
  .min(3)
  .max(MAX_SCRIPT_CHARS)
  .refine((s) => s.split(/\s+/).length >= 3);
export const sessionInputSchema = z.object({
  cloudConsent: z.literal(true),
  practice: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('free') }),
      z.object({
        mode: z.literal('impromptu'),
        topic: z.string().trim().min(10).max(600),
        category: topicInputSchema.shape.category,
        difficulty: difficultySchema,
        preparation: z.union([z.literal(15), z.literal(30), z.literal(60)]),
        minutes: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      }),
      z.object({
        mode: z.literal('interview'),
        type: z.enum(['job', 'university', 'general']),
        difficulty: difficultySchema,
      }),
      z.object({
        mode: z.literal('delivery'),
        drill: z.enum(['free', 'pace', 'pauses', 'fillers', 'expression']),
        minutes: z.number().int().min(1).max(15),
      }),
      z.object({
        mode: z.literal('memorization'),
        script: referenceScriptSchema,
        minutes: z.number().int().min(1).max(30),
      }),
    ])
    .optional()
    .default({ mode: 'free' }),
});

// A deadline avoids accumulating interval drift or background-tab throttling.
export class MemorizationClock {
  constructor({ now = () => Date.now(), onTick = () => {}, onExpire = () => {} } = {}) {
    this.now = now;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.deadline = null;
  }
  start(minutes) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 30)
      throw new Error('Choose 1–30 minutes to memorize.');
    this.startSeconds(minutes * 60);
  }
  startSeconds(seconds) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 1800)
      throw new Error('Invalid preparation duration.');
    this.cancel();
    this.deadline = this.now() + seconds * 1000;
    this.update();
    this.interval = setInterval(() => this.update(), 200);
  }
  update() {
    if (this.deadline === null) return;
    const remainingMs = Math.max(0, this.deadline - this.now());
    this.onTick(remainingMs);
    if (remainingMs === 0) {
      this.cancel();
      this.onExpire();
    }
  }
  pause() {
    if (this.deadline === null) return;
    this.update();
    if (this.deadline === null) return;
    this.pausedRemaining = Math.max(0, this.deadline - this.now());
    clearInterval(this.interval);
    this.deadline = null;
  }
  resume() {
    if (this.pausedRemaining == null) return;
    this.deadline = this.now() + this.pausedRemaining;
    this.pausedRemaining = null;
    this.update();
    this.interval = setInterval(() => this.update(), 200);
  }
  cancel() {
    this.pausedRemaining = null;
    clearInterval(this.interval);
    this.deadline = null;
  }
}
