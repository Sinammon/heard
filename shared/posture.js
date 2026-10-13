import { clamp } from './scoring.js';
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const visible = (p) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y) &&
  p.x >= 0 &&
  p.x <= 1 &&
  p.y >= 0 &&
  p.y <= 1 &&
  Math.min(p.visibility ?? 0, p.presence ?? 1) >= 0.7;
const angleDifference = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Image x/y are normalized by different dimensions. Convert y into x units first.
export function measurements(landmarks, mode, aspectRatio = 1, worldLandmarks = null) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const required = mode === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12];
  if (!landmarks || required.some((i) => !visible(landmarks[i]))) return null;
  const [nose, left, right] = [landmarks[0], landmarks[11], landmarks[12]];
  const dx = right.x - left.x,
    dy = (right.y - left.y) / aspectRatio;
  const width = Math.hypot(dx, dy);
  if (width < 0.08 || Math.abs(dx) / width < 0.6) return null;
  const centerX = (left.x + right.x) / 2;
  const centerY = (left.y + right.y) / (2 * aspectRatio);
  const hasHips =
    [23, 24].every((i) => visible(landmarks[i])) &&
    (landmarks[23].y + landmarks[24].y) / (2 * aspectRatio) - centerY >= width * 0.4;
  if (mode === 'standing' && !hasHips) return null;
  let torsoAngle = null,
    torsoPitch = null,
    torsoLength = null;
  if (hasHips) {
    const hipX = (landmarks[23].x + landmarks[24].x) / 2;
    const hipY = (landmarks[23].y + landmarks[24].y) / (2 * aspectRatio);
    torsoAngle = (Math.atan2(centerX - hipX, hipY - centerY) * 180) / Math.PI;
    torsoLength = (hipY - centerY) / width;
    if (
      [11, 12, 23, 24].every((i) =>
        ['x', 'y', 'z'].every((key) => Number.isFinite(worldLandmarks?.[i]?.[key])),
      )
    ) {
      const shoulders = {
        y: (worldLandmarks[11].y + worldLandmarks[12].y) / 2,
        z: (worldLandmarks[11].z + worldLandmarks[12].z) / 2,
      };
      const hips = {
        y: (worldLandmarks[23].y + worldLandmarks[24].y) / 2,
        z: (worldLandmarks[23].z + worldLandmarks[24].z) / 2,
      };
      if (hips.y - shoulders.y > 0.1)
        torsoPitch = (Math.atan2(hips.z - shoulders.z, hips.y - shoulders.y) * 180) / Math.PI;
    }
  }
  return {
    shoulderAngle: (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI,
    headX: (nose.x - centerX) / width,
    headY: (nose.y / aspectRatio - centerY) / width,
    shoulderX: centerX,
    shoulderY: centerY,
    noseY: nose.y / aspectRatio,
    width,
    torsoAngle,
    torsoPitch,
    torsoLength,
  };
}
export function calibrate(samples) {
  if (samples.length < 20)
    throw new Error(
      'Keep your head and shoulders visible for calibration. Standing practice also needs hips in frame.',
    );
  const baseline = Object.fromEntries(
    Object.keys(samples[0]).map((key) => {
      const values = samples.map((s) => s[key]).filter(Number.isFinite);
      return [key, values.length >= samples.length * 0.8 ? median(values) : null];
    }),
  );
  for (const [key, tolerance] of [
    ['shoulderAngle', 3],
    ['headX', 0.08],
    ['headY', 0.08],
    ['width', 0.025],
    ['torsoAngle', 4],
    ['torsoPitch', 6],
  ]) {
    if (!Number.isFinite(baseline[key])) continue;
    const spread = median(
      samples
        .map((s) => s[key])
        .filter(Number.isFinite)
        .map((v) => Math.abs(v - baseline[key])),
    );
    if (spread > tolerance)
      throw new Error(
        'Calibration moved too much. Keep the camera fixed and hold a comfortable upright position for five seconds.',
      );
  }
  return baseline;
}
export function deviation(m, b, mode) {
  if (!m || !b)
    return {
      valid: false,
      deviation: false,
      magnitude: 0,
      hint: b ? 'Tracking lost · move into frame' : 'Calibrate your upright posture',
    };
  // A change in camera distance/framing invalidates the calibrated geometry.
  // Image translation alone cannot establish a bent back, especially without hips.
  if (!Number.isFinite(m.width) || m.width / b.width < 0.75 || m.width / b.width > 1.3)
    return {
      valid: false,
      deviation: false,
      magnitude: 0,
      hint: 'Framing changed · return to position or recalibrate',
    };
  const shoulder = angleDifference(m.shoulderAngle, b.shoulderAngle) / 12;
  let magnitude = shoulder,
    reason = 'Shoulders tilted · return to your baseline';
  const consider = (value, hint) => {
    if (value > magnitude) {
      magnitude = value;
      reason = hint;
    }
  };
  const hasTorso = Number.isFinite(b.torsoAngle) && Number.isFinite(m.torsoAngle);
  if (Number.isFinite(b.torsoAngle) && !hasTorso && mode === 'standing') {
    return {
      valid: false,
      deviation: false,
      magnitude: 0,
      hint: 'Keep shoulders and hips visible for back tracking',
    };
  }
  if (hasTorso) {
    // Do not substitute inferred/off-screen hips for usable torso evidence.
    consider(
      angleDifference(m.torsoAngle, b.torsoAngle) / 15,
      'Leaning sideways · return to your baseline',
    );
    if (Number.isFinite(b.torsoPitch) && Number.isFinite(m.torsoPitch))
      consider(
        Math.max(0, m.torsoPitch - b.torsoPitch) / 18,
        'Leaning forward · return to your baseline',
      );
    if (Number.isFinite(b.torsoLength) && Number.isFinite(m.torsoLength))
      consider(
        Math.max(0, (b.torsoLength - m.torsoLength) / b.torsoLength) / 0.22,
        'Torso lowered · sit or stand comfortably upright',
      );
  }
  // Without visible hips, only shoulder alignment is supported. Absolute head and
  // shoulder movement may be chair movement or camera reframing, not slouching.

  return {
    valid: true,
    limited: !hasTorso,
    deviation: magnitude > 1,
    magnitude: clamp(magnitude, 0, 3),
    hint:
      magnitude > 1
        ? reason
        : !hasTorso
          ? 'Upper-body alignment steady · hips needed for back tracking'
          : 'Aligned with your baseline',
  };
}

export class PostureDetector {
  constructor() {
    this.reset();
  }
  reset() {
    this.filtered = null;
    this.lastTime = null;
    this.pending = null;
    this.recovery = null;
    this.shifted = false;
    this.lastLimited = null;
  }
  update(measurement, baseline, mode, timeMs) {
    if (!measurement || !baseline || (this.lastTime !== null && timeMs - this.lastTime > 1000))
      this.reset();
    const raw = deviation(measurement, baseline, mode);
    if (!raw.valid) {
      this.reset();
      return raw;
    }
    // A torso warning must not carry over into the upper-body approximation.
    if (this.lastLimited !== null && this.lastLimited !== raw.limited) this.reset();
    this.lastLimited = raw.limited;
    const dt = this.lastTime === null ? 100 : Math.max(0, timeMs - this.lastTime);
    this.lastTime = timeMs;
    const alpha = 1 - Math.exp(-dt / 350);
    this.filtered =
      this.filtered === null
        ? raw.magnitude
        : this.filtered + alpha * (raw.magnitude - this.filtered);
    if (!this.shifted) {
      if (this.filtered > 1) {
        this.pending ??= timeMs;
        if (timeMs - this.pending >= 2000) this.shifted = true;
      } else this.pending = null;
    } else if (this.filtered < 0.7) {
      this.recovery ??= timeMs;
      if (timeMs - this.recovery >= 1000) {
        this.shifted = false;
        this.pending = null;
        this.recovery = null;
      }
    } else this.recovery = null;
    return {
      ...raw,
      deviation: this.shifted,
      magnitude: this.filtered,
      hint: this.shifted
        ? raw.magnitude < 0.7
          ? 'Returning to baseline…'
          : raw.hint
        : this.pending !== null
          ? 'Checking alignment · brief movement is normal'
          : raw.limited
            ? 'Upper-body alignment steady · hips needed for back tracking'
            : 'Aligned with your baseline',
    };
  }
}
export class EpisodeTracker {
  constructor({ sustainMs = 2000, recoveryMs = 1000 } = {}) {
    this.sustainMs = sustainMs;
    this.recoveryMs = recoveryMs;
    this.reset();
  }
  reset() {
    this.start = null;
    this.recovery = null;
    this.counted = false;
    this.lastValid = null;
    this.lastLimited = null;
    this.events = [];
  }
  update(sample) {
    if (!sample.valid) {
      this.close(this.lastValid);
      return null;
    }
    if (this.lastValid !== null && sample.timeMs - this.lastValid > 1000)
      this.close(this.lastValid);
    if (this.lastLimited !== null && this.lastLimited !== Boolean(sample.limited))
      this.close(this.lastValid);
    this.lastLimited = Boolean(sample.limited);
    this.lastValid = sample.timeMs;
    if (sample.deviation) {
      this.recovery = null;
      this.start ??= sample.timeMs;
      if (!this.counted && sample.timeMs - this.start >= this.sustainMs) {
        this.counted = true;
        const event = {
          id: `posture-${this.start}`,
          category: 'posture',
          startMs: this.start,
          endMs: sample.timeMs,
        };
        this.events.push(event);
        return event;
      }
    } else if (this.start !== null) {
      this.recovery ??= sample.timeMs;
      if (sample.timeMs - this.recovery >= this.recoveryMs) this.close(this.recovery);
    }
    if (this.counted) this.events.at(-1).endMs = sample.timeMs;
    return null;
  }
  close(endMs) {
    if (this.counted && endMs !== null) this.events.at(-1).endMs = endMs;
    this.start = null;
    this.recovery = null;
    this.counted = false;
  }
}
