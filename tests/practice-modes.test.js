import { it, expect } from 'vitest';
import { memorizationDuration } from '../src/practice-modes.js';
import { analysisSchema } from '../server/validation.js';
import { MAX_SCRIPT_CHARS } from '../shared/limits.js';

it('accepts only bounded whole minutes in the UI and backend', () => {
  const base = {
    durationMs: 1000,
    mode: 'seated',
    poseSamples: [],
    postureEvents: [],
    frames: [],
    acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
  };
  for (const minutes of [1, 2, 30]) {
    expect(memorizationDuration(String(minutes))).toBe(minutes);
    expect(
      analysisSchema.safeParse({ ...base, memorization: { script: 'The main idea.', minutes } })
        .success,
    ).toBe(true);
  }
  for (const minutes of [0, -1, 31, 1.5, NaN, Infinity]) {
    expect(memorizationDuration(minutes)).toBeNull();
    expect(
      analysisSchema.safeParse({ ...base, memorization: { script: 'The main idea.', minutes } })
        .success,
    ).toBe(false);
  }
  expect(
    analysisSchema.safeParse({
      ...base,
      memorization: { script: 'a'.repeat(MAX_SCRIPT_CHARS + 1), minutes: 2 },
    }).success,
  ).toBe(false);
});
