import { z } from 'zod';
import { MAX_EVIDENCE_MS } from './limits.js';

const observation = z.object({
  title: z.string().trim().min(1).max(140),
  detail: z.string().trim().min(1).max(1200),
  evidenceIds: z.array(z.string().max(80)).max(8),
});
export const reviewSchema = z.object({
  summary: z.string().trim().min(1).max(1800),
  strengths: z.array(observation).max(4),
  improvements: z.array(observation).max(4),
  limitations: z.array(z.string().max(600)).max(6),
});
const nonnegative = z.number().finite().nonnegative();
const clientReportSchema = z
  .object({
    status: z.enum(['idle', 'processing', 'complete', 'partial', 'failed']),
    stages: z.partialRecord(z.enum(['audio', 'video', 'combined', 'memory']), reviewSchema),
    error: z.string().nullable().optional(),
    transcript: z.string().optional(),
    cleanupWarning: z.string().optional(),
    stageStatus: z
      .record(z.string(), z.enum(['waiting', 'running', 'complete', 'failed', 'skipped']))
      .optional(),
    evidence: z
      .array(
        z
          .object({
            id: z.string().max(80),
            category: z.enum(['filler', 'pause', 'posture', 'frame']),
            startMs: nonnegative.max(MAX_EVIDENCE_MS),
            endMs: nonnegative.max(MAX_EVIDENCE_MS),
          })
          .passthrough(),
      )
      .max(10000)
      .optional(),
    score: z
      .object({
        score: z.number().finite().min(0).max(100).nullable(),
        partial: z.boolean().optional(),
        availableCategories: z.array(z.enum(['filler', 'pace', 'pause', 'posture'])).optional(),
        warnings: z.array(z.string()).optional(),
        reasons: z.array(z.string()),
        penalties: z.object({
          filler: nonnegative,
          pace: nonnegative,
          pause: nonnegative,
          posture: nonnegative,
        }),
        coverage: z.object({ posture: nonnegative.max(1) }).passthrough(),
        metrics: z
          .object({
            wpm: nonnegative,
            fillers: nonnegative,
            pauses: nonnegative,
            postureDeviationPercent: nonnegative.max(100).nullable(),
          })
          .passthrough(),
      })
      .passthrough()
      .nullable()
      .optional(),
    visualMetrics: z
      .object({
        coverage: nonnegative.max(1),
        deviationPercent: nonnegative.max(100).nullable(),
        upperBodyOnly: nonnegative.max(1).optional(),
      })
      .optional(),
  })
  .passthrough();

export function parseReport(value) {
  const result = clientReportSchema.safeParse(value);
  if (!result.success)
    throw new Error('The review response was incomplete. Your recording is safe; retry analysis.');
  return { ...result.data, evidence: result.data.evidence || [] };
}
