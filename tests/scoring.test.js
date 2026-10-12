import { describe, it, expect } from 'vitest';
import { finalScore, liveScore, isFiller, postureCoverage } from '../shared/scoring.js';
import { EpisodeTracker, deviation } from '../shared/posture.js';

const words = (durationMs = 60000) =>
  Array.from({ length: Math.floor(durationMs / 500) }, (_, i) => ({
    text: 'word',
    startMs: i * 500,
    endMs: i * 500 + 450,
  }));
const pose = (durationMs = 60000, shifted = false) =>
  Array.from({ length: Math.floor(durationMs / 100) }, (_, i) => ({
    timeMs: i * 100,
    valid: true,
    deviation: shifted,
  }));
describe('practice rubric', () => {
  it('deduplicates finalized events and applies category caps', () => {
    const events = Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, category: 'filler' }));
    expect(liveScore([...events, ...events])).toEqual({
      score: 75,
      deductions: { filler: 25, pace: 0, pause: 0, posture: 0 },
    });
  });
  it('scores supported steady delivery reproducibly', () => {
    const input = { words: words(), poseSamples: pose(), durationMs: 60000 };
    expect(finalScore(input).score).toBe(100);
    expect(finalScore(input)).toEqual(finalScore(input));
  });
  it('normalizes filler rate across different delivery lengths', () => {
    const short = words(),
      long = words(120000);
    short[20].text = 'um';
    short[60].text = 'uh';
    for (const i of [20, 60, 140, 200]) long[i].text = 'um';
    expect(
      finalScore({ words: short, poseSamples: pose(), durationMs: 60000 }).penalties.filler,
    ).toBeCloseTo(
      finalScore({ words: long, poseSamples: pose(120000), durationMs: 120000 }).penalties.filler,
      1,
    );
  });
  it('labels and normalizes a speech-only score without inventing posture evidence', () => {
    const score = finalScore({ words: words(), poseSamples: [], durationMs: 60000 });
    expect(score.score).toBe(100);
    expect(score.partial).toBe(true);
    expect(score.availableCategories).not.toContain('posture');
    expect(score.metrics.postureDeviationPercent).toBeNull();
    expect(score.warnings.join(' ')).toMatch(/Posture/);
  });
  it('rejects incomplete or invalid word timing coverage', () => {
    const input = words();
    for (const w of input.slice(50)) w.startMs = NaN;
    expect(finalScore({ words: input, poseSamples: pose(), durationMs: 60000 }).score).toBeNull();
  });
  it('excludes leading and trailing silence from the pause penalty', () => {
    const speech = words().map((w) => ({
      ...w,
      startMs: w.startMs + 10000,
      endMs: w.endMs + 10000,
    }));
    const result = finalScore({ words: speech, poseSamples: pose(90000), durationMs: 90000 });
    expect(result.metrics.pauses).toBe(0);
    expect(result.penalties.pause).toBe(0);
  });
  it('penalizes only excess internal silence over three seconds', () => {
    const speech = words().map((w, i) =>
      i >= 60 ? { ...w, startMs: w.startMs + 5000, endMs: w.endMs + 5000 } : w,
    );
    const result = finalScore({ words: speech, poseSamples: pose(65000), durationMs: 65000 });
    expect(result.metrics.pauses).toBe(1);
    expect(result.events.find((e) => e.category === 'pause').excessMs).toBe(2050);
  });
  it('does not interpret contextual words as fillers', () => {
    expect(isFiller('Um,')).toBe(true);
    expect(isFiller('umbrella')).toBe(false);
    expect(isFiller('like')).toBe(false);
  });
  it('does not interpolate tracking coverage across missing frames', () => {
    const result = postureCoverage(
      [
        { timeMs: 0, valid: true, deviation: false },
        { timeMs: 9000, valid: true, deviation: false },
      ],
      0,
      10000,
    );
    expect(result.coverage).toBeLessThan(0.1);
  });
  it.each([90, 140, 210])('measures and scores pace at %d WPM', (pace) => {
    const speech = Array.from({ length: pace }, (_, i) => ({
      text: 'word',
      startMs: (i * 60000) / pace,
      endMs: ((i + 1) * 60000) / pace,
    }));
    const full = finalScore({ words: speech, poseSamples: pose(), durationMs: 60000 });
    const partial = finalScore({ words: speech, durationMs: 60000 });
    expect(full.metrics.wpm).toBeCloseTo(pace);
    expect(full.penalties.pace).toBe(pace === 140 ? 0 : 25);
    expect(partial.score).toBe(Math.round(100 * (1 - full.penalties.pace / 70)));
  });
  it('deducts for consistently missing punctuation pauses and accepts natural flow', () => {
    const flowing = words().map((w, i) => ({
      ...w,
      text: i % 10 === 9 ? 'word,' : 'word',
      endMs: w.startMs + (i % 10 === 9 ? 250 : 450),
    }));
    const rushed = flowing.map((w, i) => ({
      ...w,
      endMs: i % 10 === 9 ? w.startMs + 490 : w.endMs,
    }));
    const natural = finalScore({ words: flowing, poseSamples: pose(), durationMs: 60000 });
    const robotic = finalScore({ words: rushed, poseSamples: pose(), durationMs: 60000 });
    expect(natural.metrics.naturalPunctuationPauses).toBe(11);
    expect(natural.penalties.pause).toBe(0);
    expect(robotic.penalties.pause).toBeGreaterThan(0);
    expect(robotic.score).toBeLessThan(natural.score);
  });
  it('still withholds short or untimed speech even when partial scores are enabled', () => {
    expect(finalScore({ words: words(10000), durationMs: 10000 }).score).toBeNull();
    expect(finalScore({ durationMs: 60000 }).score).toBeNull();
  });
});
describe('posture episodes', () => {
  it('counts a sustained shift once, rearms only after recovery', () => {
    const tracker = new EpisodeTracker();
    for (let timeMs = 0; timeMs <= 5000; timeMs += 100)
      tracker.update({ timeMs, valid: true, deviation: true });
    expect(tracker.events).toHaveLength(1);
    for (let timeMs = 5100; timeMs <= 6300; timeMs += 100)
      tracker.update({ timeMs, valid: true, deviation: false });
    for (let timeMs = 6400; timeMs <= 9000; timeMs += 100)
      tracker.update({ timeMs, valid: true, deviation: true });
    expect(tracker.events).toHaveLength(2);
  });
  it('does not count lost tracking as a deviation', () => {
    const tracker = new EpisodeTracker();
    tracker.update({ timeMs: 0, valid: true, deviation: true });
    tracker.update({ timeMs: 5000, valid: false, deviation: true });
    expect(tracker.events).toEqual([]);
    expect(deviation(null, { headX: 0 }, 'seated').valid).toBe(false);
  });
});
