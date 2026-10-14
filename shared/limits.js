// Shared by capture, request validation, and report parsing.
export const MAX_PRACTICE_MINUTES = 15;
export const MAX_RECORDING_MS = MAX_PRACTICE_MINUTES * 60000;
export const MAX_EVIDENCE_MS = MAX_RECORDING_MS + 250;
export const MAX_AUDIO_BYTES = Math.ceil(MAX_EVIDENCE_MS * 32) + 44;
export const MAX_POSE_SAMPLES = 10000;
export const MAX_SCRIPT_CHARS = 30000;
// 10,000 pose samples plus twenty bounded JPEG data URLs and optional script.
export const MAX_ANALYSIS_FIELD_BYTES = 5 * 1024 * 1024;
// Bounds both the provider queue wait and Gemini's response time for script drafts.
export const SCRIPT_DRAFT_TIMEOUT_MS = 45_000;
