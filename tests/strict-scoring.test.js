import { describe, expect, it } from 'vitest';
import { finalScore } from '../shared/scoring.js';
import { canReviewStage } from '../shared/review-flow.js';
import { MovementDetector } from '../shared/posture.js';

const speech = (pace = 140) =>
  Array.from({ length: pace }, (_, i) => ({
    text: 'word',
    startMs: (i * 60000) / pace,
    endMs: ((i + 1) * 60000) / pace,
  }));
const pose = (change = () => ({})) =>
  Array.from({ length: 600 }, (_, i) => ({
    timeMs: i * 100,
    valid: true,
    deviation: false,
    movement: false,
    ...change(i),
  }));
const input = () => ({
  words: speech(),
  durationMs: 60000,
  poseSamples: pose(),
  acoustics: { clippedFraction: 0 },
});

describe('strict measured delivery', () => {
  it('reserves excellent complete scores for strong evidence across all categories', () => {
    const result = finalScore(input());
    expect(result.version).toBe('v3');
    expect(result.score).toBe(100);
    expect(result.partial).toBe(false);
    expect(result.components.audio.score).toBe(100);
    expect(result.components.posture.score).toBe(100);
  });

  it('makes repeated fillers a substantial weakness even with perfect visual delivery', () => {
    const moderate = input(),
      frequent = input();
    for (const index of [15, 50, 95]) moderate.words[index].text = 'um';
    for (const index of [15, 30, 50, 75, 95, 115]) frequent.words[index].text = 'uh';
    const middle = finalScore(moderate),
      poor = finalScore(frequent);
    expect(middle.score).toBeLessThan(85);
    expect(poor.score).toBeLessThanOrEqual(55);
    expect(poor.score).toBeLessThan(middle.score);
    expect(poor.feedback[0]).toMatchObject({ category: 'filler', severity: 'major' });
    expect(poor.components.posture.score).toBe(100);
  });

  it.each([80, 210, 260])('substantially lowers scores for sustained %d WPM', (pace) => {
    expect(finalScore({ ...input(), words: speech(pace) }).score).toBeLessThan(80);
  });

  it('detects uneven pacing hidden behind a normal overall average', () => {
    const words = [];
    for (let block = 0; block < 6; block++) {
      const count = block % 2 ? 10 : 36;
      for (let i = 0; i < count; i++)
        words.push({
          text: 'word',
          startMs: block * 10000 + (i * 10000) / count,
          endMs: block * 10000 + ((i + 1) * 10000) / count,
        });
    }
    const result = finalScore({ ...input(), words });
    expect(result.metrics.wpm).toBeCloseTo(138);
    expect(result.score).toBeLessThan(80);
    expect(result.feedback.some((item) => item.category === 'pace')).toBe(true);
  });

  it('penalizes long internal pauses without counting leading or trailing silence', () => {
    const data = input();
    data.words = data.words.map((word, i) =>
      i < 70 ? word : { ...word, startMs: word.startMs + 6000, endMs: word.endMs + 6000 },
    );
    data.durationMs = 66000;
    data.poseSamples = [];
    const result = finalScore(data);
    expect(result.metrics.longPauses).toBe(1);
    expect(result.factors.pause).toBeGreaterThan(0.7);
    expect(result.score).toBeLessThan(70);
  });

  it.each(['posture', 'movement'])('does not hide severe %s behind clean audio', (category) => {
    const data = input();
    data.poseSamples = pose(() =>
      category === 'posture' ? { deviation: true } : { movement: true },
    );
    const result = finalScore(data);
    expect(result.components.audio.score).toBe(100);
    expect(result.components.posture.score).toBeLessThanOrEqual(50);
    expect(result.score).toBeLessThanOrEqual(55);
    expect(result.feedback[0]).toMatchObject({ category, severity: 'major' });
  });

  it('uses measured clipping and explicit unclear markers without inventing intelligibility', () => {
    const clipped = finalScore({ ...input(), acoustics: { clippedFraction: 0.04 } });
    expect(clipped.score).toBeLessThanOrEqual(55);
    const data = input();
    for (const i of [10, 40, 80, 120]) data.words[i].text = '[inaudible]';
    const marked = finalScore({
      ...data,
      transcript: data.words.map((word) => word.text).join(' '),
    });
    expect(marked.metrics.unclearMarkers).toBe(4);
    expect(marked.score).toBeLessThanOrEqual(55);
    const missing = finalScore({ ...input(), acoustics: undefined, poseSamples: [] });
    expect(missing.partial).toBe(true);
    expect(missing.availableCategories).not.toContain('clarity');
    expect(missing.components.posture.score).toBeNull();
    expect(missing.metrics.postureDeviationPercent).toBeNull();
  });

  it('calculates Combined from the actual component scores and the disclosed ceiling', () => {
    const data = input();
    data.words[25].text = 'um';
    data.poseSamples = pose((i) => ({ deviation: i < 24 }));
    const result = finalScore(data);
    const expected = 0.7 * result.components.audio.score + 0.3 * result.components.posture.score;
    expect(result.combination.weightedScore).toBeCloseTo(expected);
    expect(result.score).toBe(Math.round(Math.min(expected, result.combination.ceiling)));
  });

  it('withholds overall scores when timestamps are overlapping or transcript coverage is insufficient', () => {
    expect(
      finalScore({ ...input(), words: speech().map((word) => ({ ...word, startMs: 0 })) }).score,
    ).toBeNull();
    expect(finalScore({ ...input(), transcript: 'word '.repeat(220) }).score).toBeNull();
    expect(finalScore({ ...input(), transcript: 'word '.repeat(50) }).score).toBeNull();
    const missingAudio = finalScore({ ...input(), words: [] });
    expect(missingAudio.score).toBeNull();
    expect(missingAudio.components.posture.score).toBe(100);
  });

  it('labels upper-body-only tracking as partial rather than a complete posture assessment', () => {
    const result = finalScore({ ...input(), poseSamples: pose(() => ({ limited: true })) });
    expect(result.partial).toBe(true);
    expect(result.components.posture.partial).toBe(true);
    expect(result.warnings.join(' ')).toContain('upper-body alignment only');
  });
});

describe('ordered review navigation', () => {
  it('requires Posture before Combined and permits revisiting completed steps', () => {
    expect(canReviewStage(0, 'audio')).toBe(true);
    expect(canReviewStage(0, 'video')).toBe(true);
    expect(canReviewStage(0, 'combined')).toBe(false);
    expect(canReviewStage(1, 'combined')).toBe(true);
    for (const stage of ['audio', 'video', 'combined']) expect(canReviewStage(2, stage)).toBe(true);
    expect(canReviewStage(0, 'unknown')).toBe(false);
  });
});

describe('sustained upper-body movement', () => {
  const baseline = { width: 0.3 };
  const point = (x = 0.5, y = 0.4) => ({ shoulderX: x, shoulderY: y });
  it('ignores jitter, a normal adjustment, and isolated head movement', () => {
    const detector = new MovementDetector();
    const output = [];
    for (let t = 0; t < 6000; t += 100)
      output.push(
        detector.update({ ...point(t < 1000 ? 0.5 : 0.55), headY: Math.sin(t) }, baseline, t),
      );
    expect(output).not.toContain(true);
  });
  it('detects repeated sustained sway and resets on lost tracking', () => {
    const detector = new MovementDetector();
    const output = [];
    for (let t = 0; t < 10000; t += 100)
      output.push(detector.update(point(0.5 + 0.15 * Math.sin(t / 300)), baseline, t));
    expect(output).toContain(true);
    expect(detector.update(null, baseline, 10000)).toBeUndefined();
    expect(detector.update(point(), baseline, 10100)).toBeUndefined();
  });
});
