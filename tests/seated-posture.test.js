import { describe, expect, it } from 'vitest';
import { measurements, calibrate, PostureDetector } from '../shared/posture.js';
import { finalScore } from '../shared/scoring.js';

function landmarks({ hip = 'visible', tilt = 0, headShift = 0, headTilt = 0, ears = true } = {}) {
  const p = (x, y) => ({ x, y, visibility: 0.99, presence: 0.99 });
  const points = Array(33).fill(null);
  points[0] = p(0.5 + headShift, 0.15);
  if (ears) {
    points[7] = p(0.44 + headShift, 0.16);
    points[8] = p(0.56 + headShift, 0.16 + headTilt);
  }
  points[11] = p(0.35, 0.3 - tilt);
  points[12] = p(0.65, 0.3 + tilt);
  if (hip !== 'missing') {
    points[23] = p(0.4, hip === 'offscreen' ? 1.2 : 0.65);
    points[24] = p(0.6, hip === 'offscreen' ? 1.2 : 0.65);
    if (hip === 'low') points[23].visibility = 0.1;
    if (hip === 'shifted') points[23].x = points[24].x = 0.9;
  }
  return points;
}
const measure = (options, mode = 'seated') => measurements(landmarks(options), mode);
const baseline = (mode = 'seated') =>
  calibrate(Array.from({ length: 30 }, () => measure({}, mode)));
const score = (samples) =>
  finalScore({
    durationMs: 60000,
    words: Array.from({ length: 140 }, (_, i) => ({
      text: 'word',
      startMs: (i * 60000) / 140,
      endMs: ((i + 1) * 60000) / 140,
    })),
    acoustics: { clippedFraction: 0 },
    poseSamples: samples,
  });
function track(options, mode = 'seated') {
  const detector = new PostureDetector(),
    b = baseline(mode);
  return Array.from({ length: 600 }, (_, i) => ({
    timeMs: i * 100,
    ...detector.update(
      measure(typeof options === 'function' ? options(i) : options, mode),
      b,
      mode,
      i * 100,
    ),
    movement: false,
  }));
}

describe('seated upper-body scope', () => {
  it('excludes every hip measurement from calibration regardless of visibility or movement', () => {
    const samples = Array.from({ length: 30 }, (_, i) =>
      measure({ hip: ['visible', 'missing', 'offscreen', 'low', 'shifted'][i % 5] }),
    );
    for (const sample of samples) expect(sample).toEqual(measure({}));
    expect(calibrate(samples)).toMatchObject({
      torsoAngle: null,
      torsoPitch: null,
      torsoLength: null,
    });
  });
  it('never deducts for missing or changing seated hips', () => {
    const upright = score(track({}));
    const changing = score(
      track((i) => ({ hip: ['missing', 'offscreen', 'low', 'shifted'][i % 4] })),
    );
    expect(changing.score).toBe(upright.score);
    expect(changing.penalties.posture).toBe(0);
    expect(changing.metrics.postureDeviationPercent).toBe(0);
    expect(changing.partial).toBe(true);
  });
  it.each([{ tilt: 0.05 }, { headShift: 0.09 }, { headTilt: 0.06 }])(
    'strictly penalizes sustained visible upper-body deviation: %o',
    (options) => {
      const samples = track({ ...options, hip: 'missing' });
      expect(samples.at(-1).deviation).toBe(true);
      expect(score(samples).components.posture.score).toBeLessThanOrEqual(50);
    },
  );
  it('excludes missing or low-confidence ears instead of inferring neck position', () => {
    expect(measure({ ears: false })).toMatchObject({ neckOffset: null, headTilt: null });
    const points = landmarks({ headShift: 0.1 });
    points[7].presence = 0.2;
    expect(measurements(points, 'seated')).toMatchObject({ neckOffset: null, headTilt: null });
  });
  it('ignores brief head displacement and resets on lost head/shoulder tracking', () => {
    const detector = new PostureDetector(),
      b = baseline();
    for (let t = 0; t < 1000; t += 100)
      expect(detector.update(measure({ headShift: 0.09 }), b, 'seated', t).deviation).toBe(false);
    expect(detector.update(null, b, 'seated', 1000).valid).toBe(false);
    expect(detector.update(measure({}), b, 'seated', 1100).deviation).toBe(false);
  });
  it('keeps standing hip checks active only with reliable in-frame hips', () => {
    expect(track({ hip: 'shifted' }, 'standing').at(-1).deviation).toBe(true);
    for (const hip of ['missing', 'offscreen', 'low']) {
      expect(measure({ hip }, 'standing')).toBeNull();
      expect(track({ hip }, 'standing').at(-1)).toMatchObject({ valid: false, deviation: false });
    }
  });
});
