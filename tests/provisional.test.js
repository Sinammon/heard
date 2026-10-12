import { it, expect } from 'vitest';
import { provisionalScore } from '../shared/scoring.js';

it('requires finalized speech and labels insufficient posture as partial', () => {
  const data = {
    events: [],
    turns: [{ text: Array(50).fill('word').join(' '), startMs: 0, endMs: 30000 }],
    poseSamples: Array.from({ length: 300 }, (_, i) => ({ timeMs: i * 100, valid: true })),
    liveReady: true,
  };
  expect(provisionalScore(data).score).toBe(100);
  expect(provisionalScore({ ...data, turns: [] }).score).toBeNull();
  expect(provisionalScore({ ...data, poseSamples: [] })).toMatchObject({
    score: 100,
    partial: true,
  });
  expect(provisionalScore({ ...data, liveReady: false }).score).toBeNull();
  expect(
    provisionalScore({ ...data, turns: [{ ...data.turns[0], text: 'Too short' }] }).score,
  ).toBeNull();
  expect(provisionalScore({ ...data, events: [{ id: 'one', category: 'filler' }] }).score).toBe(99);
});
