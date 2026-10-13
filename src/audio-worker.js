import { PitchDetector } from 'pitchy';
const detector = PitchDetector.forFloat32Array(2048);
let window = new Float32Array(2048),
  noise = 0.01,
  active = false,
  silentStart = null,
  sawSpeech = false,
  pitches = [],
  voicedBlocks = 0,
  rmsTotal = 0,
  blocks = 0,
  clipped = 0,
  all = 0;
function reset() {
  window.fill(0);
  active = false;
  silentStart = null;
  sawSpeech = false;
  pitches = [];
  voicedBlocks = 0;
  rmsTotal = 0;
  blocks = 0;
  clipped = 0;
  all = 0;
}
self.onmessage = ({ data }) => {
  if (data.type === 'start') {
    reset();
    noise = data.noise;
    return;
  }
  if (data.type === 'finish') {
    const mean = pitches.reduce((a, b) => a + b, 0) / Math.max(1, pitches.length);
    const variation =
      pitches.length >= 30 && pitches.length >= voicedBlocks * 0.2
        ? Math.sqrt(pitches.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pitches.length)
        : null;
    self.postMessage({
      type: 'finished',
      acoustics: {
        pitchVariation: variation,
        relativeLoudness: rmsTotal / Math.max(1, blocks),
        clippedFraction: clipped / Math.max(1, all),
      },
    });
    return;
  }
  if (data.type !== 'samples') return;
  const samples = data.samples;
  let energy = 0;
  for (const s of samples) {
    energy += s * s;
    if (Math.abs(s) >= 0.99) clipped++;
  }
  all += samples.length;
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  rmsTotal += rms;
  blocks++;
  const threshold = Math.max(0.008, noise * 3);
  active = rms > threshold;
  let pause;
  if (active) {
    if (sawSpeech && silentStart !== null && data.timeMs - silentStart > 3000)
      pause = {
        id: `pause-live-${silentStart}`,
        category: 'pause',
        startMs: silentStart,
        endMs: data.timeMs,
      };
    sawSpeech = true;
    silentStart = null;
  } else if (sawSpeech) silentStart ??= data.timeMs;
  const carry = Math.max(0, window.length - samples.length);
  window.copyWithin(0, Math.min(samples.length, window.length));
  window.set(samples.subarray(Math.max(0, samples.length - window.length)), carry);
  let pitch = null;
  if (active) {
    voicedBlocks++;
    const [hz, quality] = detector.findPitch(window, 16000);
    if (quality >= 0.9 && hz >= 60 && hz <= 600) {
      pitch = hz;
      pitches.push(12 * Math.log2(hz / 440));
    }
  }
  self.postMessage({ type: 'metrics', rms, pitch, active, pause, timeMs: data.timeMs });
};
