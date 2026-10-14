export const REVIEW_STAGES = Object.freeze([
  { id: 'audio', title: 'Audio Analysis', icon: 'mic' },
  { id: 'video', title: 'Posture Analysis', icon: 'video' },
  { id: 'combined', title: 'Combined Evaluation', icon: 'chat' },
]);

export function canReviewStage(furthest, phase) {
  const index = REVIEW_STAGES.findIndex((item) => item.id === phase);
  return index >= 0 && index <= Math.min(2, furthest + 1);
}
