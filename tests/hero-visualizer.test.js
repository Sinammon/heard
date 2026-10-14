import { afterEach, expect, it, vi } from 'vitest';
import { HeroVisualizer } from '../src/hero-visualizer.js';

afterEach(() => vi.unstubAllGlobals());

it('reacts to analyser frequency data and keeps the visualizer local', () => {
  const bars = Array.from({ length: 5 }, () => ({
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  }));
  const root = {
    classList: { remove: vi.fn(), toggle: vi.fn() },
    isConnected: true,
    querySelectorAll: () => bars,
  };
  const analyser = {
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn((bins) => bins.fill(200)),
  };
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const visualizer = new HeroVisualizer(root);

  visualizer.setAnalyser(analyser);
  visualizer.sample();

  expect(analyser.getByteFrequencyData).toHaveBeenCalled();
  expect(root.classList.toggle).toHaveBeenCalledWith('is-listening', true);
  expect(bars[2].style.setProperty).toHaveBeenCalledWith('--bar-level', expect.any(String));
  visualizer.dispose();
});
