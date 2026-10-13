import { describe, it, expect } from 'vitest';
import {
  measurements,
  calibrate,
  deviation,
  PostureDetector,
  EpisodeTracker,
} from '../shared/posture.js';

function pose({ aspect = 16 / 9, tilt = 0, shiftX = 0, drop = 0, noseDrop = 0, hips = true } = {}) {
  const points = Array(33).fill(null);
  const p = (x, y) => ({ x, y: y * aspect, z: 0, visibility: 0.99, presence: 0.99 });
  points[0] = p(0.5 + shiftX, 0.1 + drop + noseDrop);
  points[11] = p(0.35 + shiftX, 0.22 + drop - Math.tan((tilt * Math.PI) / 180) * 0.15);
  points[12] = p(0.65 + shiftX, 0.22 + drop + Math.tan((tilt * Math.PI) / 180) * 0.15);
  if (hips) {
    points[23] = p(0.4, 0.42);
    points[24] = p(0.6, 0.42);
  }
  return points;
}
function world(pitch = 0) {
  const points = Array(33).fill(null);
  const z = -Math.tan((pitch * Math.PI) / 180) * 0.5;
  points[11] = { x: -0.2, y: -0.5, z };
  points[12] = { x: 0.2, y: -0.5, z };
  points[23] = { x: -0.15, y: 0, z: 0 };
  points[24] = { x: 0.15, y: 0, z: 0 };
  return points;
}
const measurement = (options = {}) =>
  measurements(
    pose(options),
    options.hips === false ? 'seated' : 'standing',
    options.aspect || 16 / 9,
    world(options.pitch || 0),
  );
const baseline = (options = {}) =>
  calibrate(Array.from({ length: 30 }, () => measurement(options)));

describe('posture geometry and calibration', () => {
  it('uses the same physical geometry in square and widescreen images', () => {
    const square = measurement({ aspect: 1, tilt: 10 });
    const wide = measurement({ aspect: 16 / 9, tilt: 10 });
    expect(wide.shoulderAngle).toBeCloseTo(square.shoulderAngle, 6);
    expect(wide.shoulderAngle).toBeCloseTo(10, 6);
    expect(wide.headY).toBeCloseTo(square.headY, 6);
  });
  it('excludes low-confidence, offscreen, and malformed landmarks', () => {
    for (const patch of [{ visibility: 0.6 }, { x: NaN }, { y: Infinity }, { x: 1.2 }]) {
      const points = pose();
      points[11] = { ...points[11], ...patch };
      expect(measurements(points, 'standing', 16 / 9)).toBeNull();
    }
    expect(measurements(pose({ hips: false }), 'standing', 16 / 9)).toBeNull();
  });
  it('rejects unstable calibration and too little evidence', () => {
    expect(() => calibrate(Array(19).fill(measurement()))).toThrow(/visible/);
    const moving = Array.from({ length: 30 }, (_, i) => measurement({ tilt: i % 2 ? 15 : -15 }));
    expect(() => calibrate(moving)).toThrow(/moved too much/);
  });
  it('recognizes forward torso lean and slouch while ignoring an isolated head nod', () => {
    const b = baseline();
    expect(deviation(measurement({ pitch: 28 }), b, 'standing').deviation).toBe(true);
    expect(deviation(measurement({ drop: 0.06 }), b, 'standing').deviation).toBe(true);
    expect(deviation(measurement({ noseDrop: 0.09 }), b, 'standing').deviation).toBe(false);
    expect(deviation(measurement(), b, 'standing').deviation).toBe(false);
  });
  it('uses a conservative seated fallback and never treats a nod as slouching', () => {
    const b = baseline({ hips: false });
    expect(deviation(measurement({ hips: false, noseDrop: 0.09 }), b, 'seated').deviation).toBe(
      false,
    );
    expect(deviation(measurement({ hips: false, drop: 0.09 }), b, 'seated').deviation).toBe(false);
    expect(deviation(measurement({ hips: false, shiftX: 0.15 }), b, 'seated').deviation).toBe(
      false,
    );
    expect(deviation(measurement({ hips: false }), baseline(), 'seated')).toMatchObject({
      valid: true,
      limited: true,
      deviation: false,
    });
    expect(deviation(measurement({ hips: false }), baseline(), 'standing').valid).toBe(false);
  });
});
describe('stable live posture feedback', () => {
  it('keeps seated tracking usable when hips disappear and resets a torso warning', () => {
    const detector = new PostureDetector();
    const b = baseline();
    let result;
    for (let t = 0; t <= 3000; t += 100)
      result = detector.update(measurement({ pitch: 28 }), b, 'seated', t);
    expect(result.deviation).toBe(true);
    result = detector.update(measurement({ hips: false }), b, 'seated', 3100);
    expect(result).toMatchObject({ valid: true, limited: true, deviation: false });
    expect(result.hint).toMatch(/Upper-body/);
    result = detector.update(measurement(), b, 'seated', 3200);
    expect(result).toMatchObject({ valid: true, limited: false, deviation: false });
  });
  it('ignores brief motion, confirms sustained lean, and clears after recovery', () => {
    const detector = new PostureDetector();
    const b = baseline();
    let result;
    for (let t = 0; t < 1000; t += 100)
      result = detector.update(measurement({ pitch: 28 }), b, 'standing', t);
    expect(result.deviation).toBe(false);
    for (let t = 1000; t <= 3000; t += 100)
      result = detector.update(measurement(), b, 'standing', t);
    expect(result.deviation).toBe(false);
    for (let t = 3100; t <= 6500; t += 100)
      result = detector.update(measurement({ pitch: 28 }), b, 'standing', t);
    expect(result.deviation).toBe(true);
    for (let t = 6600; t <= 8500; t += 100)
      result = detector.update(measurement(), b, 'standing', t);
    expect(result.deviation).toBe(false);
  });
  it('resets pending warnings on tracking loss or a gap in frames', () => {
    const detector = new PostureDetector();
    const b = baseline();
    for (let t = 0; t < 1900; t += 100)
      detector.update(measurement({ pitch: 28 }), b, 'standing', t);
    expect(detector.update(null, b, 'standing', 1900).valid).toBe(false);
    expect(detector.update(measurement({ pitch: 28 }), b, 'standing', 2000).deviation).toBe(false);
    expect(detector.update(measurement({ pitch: 28 }), b, 'standing', 6000).deviation).toBe(false);
  });
  it('cannot turn sparse observations into sustained episodes', () => {
    const episodes = new EpisodeTracker();
    episodes.update({ timeMs: 0, valid: true, deviation: true });
    episodes.update({ timeMs: 5000, valid: true, deviation: true });
    expect(episodes.events).toHaveLength(0);
  });
});

it('does not classify camera scale changes or whole-person translation as a bent back', () => {
  const b = baseline();
  expect(deviation({ ...measurement(), width: b.width * 1.4 }, b, 'seated').valid).toBe(false);
  const translated = pose().map((p) => (p ? { ...p, x: p.x + 0.1, y: p.y + 0.05 } : null));
  expect(
    deviation(measurements(translated, 'standing', 16 / 9, world()), b, 'standing').deviation,
  ).toBe(false);
  expect(
    deviation(measurement({ hips: false, tilt: 18 }), baseline({ hips: false }), 'seated')
      .deviation,
  ).toBe(true);
});
