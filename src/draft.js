import { PRACTICE_MODES } from '../shared/practice.js';
import { MAX_PRACTICE_MINUTES, MAX_SCRIPT_CHARS } from '../shared/limits.js';

const key = 'stagecraft.draft.v1';

export function loadDraft() {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    if (!value || typeof value.script !== 'string' || value.script.length > MAX_SCRIPT_CHARS)
      return {};
    return {
      script: value.script,
      topic: typeof value.topic === 'string' ? value.topic.slice(0, 400) : '',
      audience: typeof value.audience === 'string' ? value.audience.slice(0, 150) : 'My classmates',
      duration:
        Number.isInteger(value.duration) &&
        value.duration >= 1 &&
        value.duration <= MAX_PRACTICE_MINUTES
          ? value.duration
          : 2,
      practiceMode: PRACTICE_MODES.some((mode) => mode.id === value.practiceMode)
        ? value.practiceMode
        : 'free',
      memorizationMinutes:
        Number.isInteger(value.memorizationMinutes) &&
        value.memorizationMinutes >= 1 &&
        value.memorizationMinutes <= 30
          ? value.memorizationMinutes
          : 2,
    };
  } catch {
    return {};
  }
}

export function saveDraft({
  script,
  topic,
  audience,
  duration,
  practiceMode,
  memorizationMinutes,
}) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ script, topic, audience, duration, practiceMode, memorizationMinutes }),
    );
    return true;
  } catch {
    return false;
  }
}
