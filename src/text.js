import { MAX_PRACTICE_MINUTES } from '../shared/limits.js';

export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

export const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

export function readingTime(text) {
  const count = wordCount(text);
  if (!count) return 'Add a few words to begin';
  const seconds = Math.max(1, Math.round((count / 130) * 60));
  const duration =
    seconds < 60
      ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
      : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} sec` : ''}`;
  return `About ${duration}${count > MAX_PRACTICE_MINUTES * 130 ? ` · trim to fit the ${MAX_PRACTICE_MINUTES}-minute limit` : ' at a comfortable pace'}`;
}
