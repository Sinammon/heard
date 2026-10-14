import { z } from 'zod';
import {
  MAX_EVIDENCE_MS,
  MAX_POSE_SAMPLES,
  MAX_PRACTICE_MINUTES,
  MAX_SCRIPT_CHARS,
} from '../shared/limits.js';
const time = z.number().finite().min(0).max(MAX_EVIDENCE_MS);
const interval = z.object({ startMs: time, endMs: time }).refine((v) => v.endMs >= v.startMs);
export const analysisSchema = z
  .object({
    durationMs: z.number().finite().min(1).max(MAX_EVIDENCE_MS),
    mode: z.enum(['seated', 'standing']),
    memorization: z
      .object({
        script: z.string().trim().min(3).max(MAX_SCRIPT_CHARS),
        minutes: z.number().int().min(1).max(30),
      })
      .optional(),
    poseSamples: z
      .array(
        z.object({
          timeMs: time,
          valid: z.boolean(),
          deviation: z.boolean(),
          limited: z.boolean().optional(),
          movement: z.boolean().optional(),
        }),
      )
      .max(MAX_POSE_SAMPLES),
    postureEvents: z
      .array(interval.and(z.object({ id: z.string().max(80), category: z.literal('posture') })))
      .max(200),
    frames: z
      .array(
        z.object({
          timeMs: time,
          data: z
            .string()
            .max(180000)
            .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
        }),
      )
      .max(20),
    acoustics: z.object({
      pitchVariation: z.number().finite().min(0).max(100).nullable(),
      relativeLoudness: z.number().finite().min(0).max(1),
      clippedFraction: z.number().finite().min(0).max(1),
    }),
  })
  .superRefine((v, ctx) => {
    let previous = -1;
    for (const sample of v.poseSamples) {
      if (sample.timeMs < previous || sample.timeMs > v.durationMs + 250)
        ctx.addIssue({ code: 'custom', message: 'Invalid pose timeline.' });
      previous = sample.timeMs;
    }
    if (
      v.frames.some((f) => f.timeMs > v.durationMs) ||
      v.postureEvents.some((e) => e.endMs > v.durationMs + 250)
    )
      ctx.addIssue({ code: 'custom', message: 'Evidence lies outside recording.' });
  });
export const scriptSchema = z.object({
  topic: z.string().trim().min(3).max(400),
  audience: z.string().trim().min(1).max(150),
  duration: z.number().int().min(1).max(MAX_PRACTICE_MINUTES),
});
export const chatSchema = z.object({ message: z.string().trim().min(1).max(2000) });
export const flashcardInputSchema = z.object({
  script: z
    .string()
    .trim()
    .min(3)
    .max(MAX_SCRIPT_CHARS)
    .refine((s) => s.split(/\s+/).length >= 3),
  cloudConsent: z.literal(true),
});

export function validateWav(buffer, durationMs) {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Upload a PCM WAV recording.');
  let offset = 12,
    format,
    dataSize,
    dataStart;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error('Incomplete WAV data.');
    if (id === 'fmt ' && size >= 16)
      format = {
        codec: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        rate: buffer.readUInt32LE(offset + 12),
        bits: buffer.readUInt16LE(offset + 22),
      };
    if (id === 'data') {
      dataSize = size;
      dataStart = offset + 8;
    }
    offset += 8 + size + (size % 2);
  }
  if (
    !format ||
    format.codec !== 1 ||
    format.channels !== 1 ||
    format.rate !== 16000 ||
    format.bits !== 16 ||
    !dataSize ||
    dataSize % 2 !== 0
  )
    throw new Error('Expected mono 16 kHz, 16-bit PCM audio.');
  const actualMs = dataSize / 32;
  if (actualMs > MAX_EVIDENCE_MS || Math.abs(actualMs - durationMs) > 1000)
    throw new Error('Audio duration does not match this session.');
  let clipped = 0;
  for (let sample = dataStart; sample < dataStart + dataSize; sample += 2)
    if (Math.abs(buffer.readInt16LE(sample)) >= 0.99 * 32767) clipped++;
  return { durationMs: actualMs, clippedFraction: clipped / (dataSize / 2) };
}
