// Keep mode identity separate from seated/standing posture settings.
export { PRACTICE_MODES as practiceModes } from '../shared/practice.js';

export function memorizationDuration(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 30 ? minutes : null;
}
