import { afterEach, expect, it, vi } from 'vitest';
import { MemorizationClock, sessionInputSchema, practiceMode } from '../shared/practice.js';
afterEach(() => vi.useRealTimers());
it('expires once against a deadline and cancels cleanly', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const onExpire = vi.fn(),
    onTick = vi.fn();
  const clock = new MemorizationClock({ onExpire, onTick });
  clock.start(1);
  vi.advanceTimersByTime(30000);
  expect(onTick).toHaveBeenLastCalledWith(30000);
  vi.advanceTimersByTime(30000);
  expect(onExpire).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5000);
  expect(onExpire).toHaveBeenCalledTimes(1);
  clock.start(2);
  clock.cancel();
  vi.advanceTimersByTime(180000);
  expect(onExpire).toHaveBeenCalledTimes(1);
});
it('handles clock jumps and rejects invalid durations', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const onExpire = vi.fn();
  const clock = new MemorizationClock({ onExpire });
  clock.start(1);
  vi.setSystemTime(65000);
  clock.update();
  expect(onExpire).toHaveBeenCalledTimes(1);
  for (const value of [0, 31, 1.5, NaN]) expect(() => clock.start(value)).toThrow();
});
it('validates mode-specific session data and preserves free-practice clients', () => {
  expect(sessionInputSchema.parse({ cloudConsent: true }).practice).toEqual({ mode: 'free' });
  expect(
    sessionInputSchema.safeParse({
      cloudConsent: true,
      practice: { mode: 'memorization', script: 'A useful short script.', minutes: 2 },
    }).success,
  ).toBe(true);
  for (const practice of [
    { mode: 'unknown' },
    { mode: 'memorization', minutes: 2 },
    { mode: 'memorization', script: 'oneword', minutes: 2 },
    { mode: 'memorization', script: 'A useful short script.', minutes: 31 },
  ])
    expect(sessionInputSchema.safeParse({ cloudConsent: true, practice }).success).toBe(false);
  expect(practiceMode('memorization').startLabel).toBe('Start memorizing');
  expect(practiceMode('unknown').id).toBe('free');
});

it('pauses study time without consuming it and resumes the remaining deadline', () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const onExpire = vi.fn();
  const clock = new MemorizationClock({ onExpire });
  clock.start(1);
  vi.advanceTimersByTime(20000);
  clock.pause();
  vi.advanceTimersByTime(120000);
  expect(onExpire).not.toHaveBeenCalled();
  clock.resume();
  vi.advanceTimersByTime(39999);
  expect(onExpire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onExpire).toHaveBeenCalledOnce();
  clock.start(1);
  clock.pause();
  clock.cancel();
  clock.resume();
  vi.advanceTimersByTime(120000);
  expect(onExpire).toHaveBeenCalledOnce();
});
