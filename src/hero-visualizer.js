const BAR_RANGES = [
  [0, 2],
  [2, 4],
  [4, 7],
  [7, 11],
  [11, 17],
];

const BAR_MARKUP = [
  { x: 24, y: 39, height: 22 },
  { x: 36, y: 31, height: 38 },
  { x: 48, y: 23, height: 54 },
  { x: 60, y: 31, height: 38 },
  { x: 72, y: 39, height: 22 },
]
  .map(
    ({ x, y, height }) =>
      `<rect class="hero-visualizer__bar" data-visualizer-bar x="${x}" y="${y}" width="6" height="${height}" rx="3"/>`,
  )
  .join('');

export function heroVisualizerMarkup({ compact = false } = {}) {
  const classes = ['hero-visualizer', compact ? 'hero-visualizer--compact' : 'hero-logo']
    .filter(Boolean)
    .join(' ');
  return `<div class="${classes}" data-visualizer ${compact ? 'data-mic-sync' : 'data-hero-visualizer'} aria-hidden="true"><svg class="hero-visualizer__svg" viewBox="0 0 100 100" focusable="false"><path class="hero-visualizer__arc" d="M29 9C15 9 4 22 4 38v27c0 14 9 24 21 27l7 6V77c0-7-4-11-10-15-5-3-7-7-7-12s2-9 7-12c6-4 10-8 10-15V12c0-2-1-3-3-3Z"/><path class="hero-visualizer__arc" d="M71 9c14 0 25 13 25 29v27c0 14-9 24-21 27l-7 6V77c0-7 4-11 10-15 5-3 7-7 7-12s-2-9-7-12c-6-4-10-8-10-15V12c0-2 1-3 3-3Z"/><g class="hero-visualizer__bars">${BAR_MARKUP}</g></svg></div>`;
}

export class HeroVisualizer {
  constructor(root) {
    this.root = root;
    this.bars = [...root.querySelectorAll('[data-visualizer-bar]')];
    this.analyser = null;
    this.frequencyData = null;
    this.frame = null;
    this.pulseTimer = null;
    this.sample = this.sample.bind(this);
  }

  pulse() {
    this.root.classList.remove('is-awake');
    void this.root.offsetWidth;
    this.root.classList.add('is-awake');
    clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => this.root.classList.remove('is-awake'), 720);
  }

  setAnalyser(analyser) {
    if (this.analyser === analyser) return;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.analyser = analyser;
    this.frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    this.root.classList.remove('is-listening');
    this.bars.forEach((bar) => bar.style.removeProperty('--bar-level'));
    if (analyser) this.frame = requestAnimationFrame(this.sample);
  }

  sample() {
    if (!this.analyser || !this.root.isConnected) return;
    this.analyser.getByteFrequencyData(this.frequencyData);
    const levels = BAR_RANGES.map(([start, end]) => {
      const last = Math.min(end, this.frequencyData.length);
      let total = 0;
      for (let i = Math.min(start, last); i < last; i++) total += this.frequencyData[i];
      const average = total / Math.max(1, last - start);
      return Math.max(0.16, Math.min(1.3, (average - 28) / 145));
    });
    const active = Math.max(...levels) > 0.24;
    this.root.classList.toggle('is-listening', active);
    if (active)
      this.bars.forEach((bar, index) =>
        bar.style.setProperty('--bar-level', levels[index].toFixed(2)),
      );
    else this.bars.forEach((bar) => bar.style.removeProperty('--bar-level'));
    this.frame = requestAnimationFrame(this.sample);
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    clearTimeout(this.pulseTimer);
  }
}

const mounted = new Map();

export function syncHeroVisualizers(analyser = null) {
  for (const [root, visualizer] of mounted) {
    if (root.isConnected) continue;
    visualizer.dispose();
    mounted.delete(root);
  }
  for (const root of document.querySelectorAll('[data-visualizer]')) {
    let visualizer = mounted.get(root);
    if (!visualizer) {
      visualizer = new HeroVisualizer(root);
      mounted.set(root, visualizer);
    }
    visualizer.setAnalyser(root.hasAttribute('data-mic-sync') ? analyser : null);
  }
}

export function pulseHeroVisualizer() {
  const root = document.querySelector('[data-hero-visualizer]');
  mounted.get(root)?.pulse();
}
