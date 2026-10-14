const HERO_HEIGHTS = [
  10, 15, 22, 13, 28, 42, 24, 17, 35, 55, 31, 20, 44, 70, 38, 22, 32, 51, 27, 16, 39, 56, 30, 19,
  34, 46, 25, 14, 28, 40, 12,
];
const COMPACT_HEIGHTS = [12, 20, 32, 46, 32, 20, 12];
const FREQUENCY_BINS = 48;

function barMarkup(heights, compact) {
  const step = compact ? 15 : 12.6;
  const start = compact ? 10 : 20;
  const width = compact ? 5 : 4.5;
  const baseline = 60;
  return heights
    .map((height, index) => {
      const x = (start + index * step).toFixed(1);
      const y = (baseline - height / 2).toFixed(1);
      const delay = -((index % 9) * 0.19).toFixed(2);
      const tone = index % 5 === 2 ? ' hero-visualizer__bar--soft' : '';
      return `<rect class="hero-visualizer__bar${tone}" data-visualizer-bar x="${x}" y="${y}" width="${width}" height="${height}" rx="${width / 2}" style="--bar-delay:${delay}s"/>`;
    })
    .join('');
}

function waveSvg(compact = false) {
  const heights = compact ? COMPACT_HEIGHTS : HERO_HEIGHTS;
  const bars = barMarkup(heights, compact);
  const viewBox = compact ? 120 : 420;
  const axis = compact ? 'M8 60H112' : 'M16 60H404';
  return `<svg class="hero-visualizer__wave-svg" viewBox="0 0 ${viewBox} 120" focusable="false" aria-hidden="true"><path class="hero-visualizer__axis" d="${axis}"/><g class="hero-visualizer__bars">${bars}</g>${compact ? '' : '<g class="hero-visualizer__cursor"><path d="M18 22V98"/><circle cx="18" cy="60" r="4"/></g>'}</svg>`;
}

function practiceLoopMarkup() {
  return `<div class="hero-visualizer__frame"><div class="hero-visualizer__topline"><span class="hero-visualizer__kicker">THE PRACTICE LOOP</span><span class="hero-visualizer__steps-count"><i aria-hidden="true"></i>3 steps</span></div><div class="hero-visualizer__wave-panel"><div class="hero-visualizer__wave-caption"><span>PACE · PAUSES · DELIVERY</span><span>PREVIEW</span></div>${waveSvg()}<p class="hero-visualizer__wave-note">A speaking rhythm, made visible.</p></div><ol class="hero-visualizer__journey"><li><span class="hero-visualizer__step-marker">01</span><span>Speak</span></li><li><span class="hero-visualizer__step-marker">02</span><span>Listen</span></li><li><span class="hero-visualizer__step-marker">03</span><span>Improve</span></li></ol></div>`;
}

export function heroVisualizerMarkup({ compact = false } = {}) {
  const classes = [
    'hero-visualizer',
    compact ? 'hero-visualizer--compact' : 'hero-visualizer--journey hero-logo',
  ]
    .filter(Boolean)
    .join(' ');
  const attributes = compact
    ? 'data-mic-sync aria-hidden="true"'
    : 'data-hero-visualizer role="img" aria-label="An animated preview of speaking practice: speak, listen, improve, and focus on pace, pauses, and delivery."';
  const content = compact ? waveSvg(true) : practiceLoopMarkup();
  return `<div class="${classes}" data-visualizer ${attributes}>${content}</div>`;
}

function frequencyRanges(count) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * FREQUENCY_BINS) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * FREQUENCY_BINS) / count));
    return [start, end];
  });
}

export class HeroVisualizer {
  constructor(root) {
    this.root = root;
    this.bars = [...root.querySelectorAll('[data-visualizer-bar]')];
    this.ranges = frequencyRanges(this.bars.length);
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
    this.pulseTimer = setTimeout(() => this.root.classList.remove('is-awake'), 900);
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
    const levels = this.ranges.map(([start, end]) => {
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
