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
]);
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
    this.cancel();
    this.deadline = this.now() + minutes * 60000;
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
  cancel() {
    clearInterval(this.interval);
    this.deadline = null;
  }
}
