import { expect, it } from 'vitest';
import { readingTime } from '../src/text.js';

it('estimates short scripts in seconds and handles an empty draft', () => {
  expect(readingTime('')).toBe('Add a few words to begin');
  expect(readingTime('Practice makes progress.')).toBe('About 1 second at a comfortable pace');
  expect(readingTime('word '.repeat(65))).toBe('About 30 seconds at a comfortable pace');
});

it('warns only beyond the fifteen-minute script estimate', () => {
  expect(readingTime('word '.repeat(800))).toBe('About 6 min 9 sec at a comfortable pace');
  expect(readingTime('word '.repeat(1950))).toBe('About 15 min at a comfortable pace');
  expect(readingTime('word '.repeat(2080))).toBe('About 16 min · trim to fit the 15-minute limit');
});
