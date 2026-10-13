import { afterEach, it, expect, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { PRACTICE_MODES, sessionInputSchema, MemorizationClock } from '../shared/practice.js';
import { wavFromChunks } from '../src/media.js';
const review = {
  summary: 'Test review of actual input.',
  strengths: [],
  improvements: [],
  limitations: [],
};
let app;
afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = null;
});
async function setup() {
  const provider = {
    key: 'test',
    requireKey() {},
    practicePrompt: vi.fn(async (kind) =>
      kind === 'topic'
        ? { topic: 'What makes a useful daily habit?' }
        : { question: 'Tell me about a time you helped a team.' },
    ),
    review: vi.fn(async () => review),
    upload: vi.fn(async () => ({ name: 'test', uri: 'test:audio' })),
    transcribe: vi.fn(async () => ({
      text: 'I helped my team plan a garden.',
      words: [{ text: 'I', startMs: 0, endMs: 100 }],
    })),
    deleteFile: vi.fn(async () => {}),
  };
  app = await buildApp({ provider, serveStatic: false });
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: {
      cloudConsent: true,
      practice: { mode: 'interview', type: 'job', difficulty: 'standard' },
    },
  });
  const id = response.json().id,
    cookie = response.headers['set-cookie'].split(';')[0];
  const session = app.sessionStore.get(id, cookie.split('=')[1]);
  const act = (payload, auth = true) =>
    app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/interview`,
      headers: auth ? { cookie } : {},
      payload,
    });
  return { provider, id, cookie, session, act };
}
it('has exactly five modes with bounded distinct settings', () => {
  expect(PRACTICE_MODES.map((m) => m.id)).toEqual([
    'free',
    'memorization',
    'impromptu',
    'interview',
    'delivery',
  ]);
  for (const practice of [
    {
      mode: 'impromptu',
      topic: 'Why does practice matter?',
      category: 'ideas',
      difficulty: 'easy',
      preparation: 15,
      minutes: 3,
    },
    { mode: 'interview', type: 'university', difficulty: 'challenging' },
    { mode: 'delivery', drill: 'expression', minutes: 15 },
  ])
    expect(sessionInputSchema.safeParse({ cloudConsent: true, practice }).success).toBe(true);
  expect(
    sessionInputSchema.safeParse({
      cloudConsent: true,
      practice: {
        mode: 'impromptu',
        topic: 'Valid topic here',
        category: 'ideas',
        difficulty: 'easy',
        preparation: 90,
        minutes: 4,
      },
    }).success,
  ).toBe(false);
});
it('uses second-based preparation deadlines and cancels before automatic recording', () => {
  vi.useFakeTimers();
  const expire = vi.fn();
  const clock = new MemorizationClock({ onExpire: expire });
  clock.startSeconds(15);
  vi.advanceTimersByTime(14999);
  expect(expire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(expire).toHaveBeenCalledOnce();
  clock.startSeconds(30);
  clock.cancel();
  vi.advanceTimersByTime(60000);
  expect(expire).toHaveBeenCalledOnce();
});
it('requires consent for topics and validates provider output', async () => {
  const { provider } = await setup();
  const payload = { category: 'ideas', difficulty: 'easy' };
  expect((await app.inject({ method: 'POST', url: '/api/topics', payload })).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/topics',
        payload: { ...payload, cloudConsent: true },
      })
    ).json().topic,
  ).toContain('habit');
  provider.practicePrompt.mockResolvedValueOnce({ topic: '' });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/topics',
        payload: { ...payload, cloudConsent: true },
      })
    ).statusCode,
  ).toBe(400);
});
it('grounds follow-ups in owned canonical answers, preserves failures, retries one answer, and summarizes', async () => {
  const { provider, session, act } = await setup();
  expect((await act({ action: 'next' }, false)).statusCode).toBe(404);
  expect((await act({ action: 'next' })).json().index).toBe(0);
  expect((await act({ action: 'next' })).statusCode).toBe(409);
  session.transcript = { text: 'I organized a garden with neighbours.' };
  session.report.stages.audio = review;
  session.status = 'complete';
  provider.practicePrompt.mockRejectedValueOnce(new Error('Temporary failure'));
  expect((await act({ action: 'next' })).statusCode).toBe(500);
  expect(session.report.stages.audio).toEqual(review);
  expect(session.interview.index).toBe(0);
  expect((await act({ action: 'next', transcript: 'A forged answer.' })).json().index).toBe(1);
  const context = provider.practicePrompt.mock.calls.at(-1)[1];
  expect(context.turns[0].transcript).toBe('I organized a garden with neighbours.');
  expect(JSON.stringify(context)).not.toContain('forged');
  expect(session.transcript).toBeNull();
  session.transcript = { text: 'We divided the work fairly.' };
  session.report.stages.audio = review;
  session.status = 'complete';
  expect((await act({ action: 'retry', index: 0 })).json().question).toBe(
    'Tell me about a time you helped a team.',
  );
  expect((await act({ action: 'next' })).statusCode).toBe(409);
  session.transcript = { text: 'My revised garden answer.' };
  session.report.stages.audio = review;
  session.status = 'complete';
  const finish = await act({ action: 'finish' });
  expect(finish.json().summary).toEqual(review);
  expect(provider.review.mock.calls.at(-1)[1].turns[0].transcript).toBe(
    'My revised garden answer.',
  );
  expect(provider.review.mock.calls.at(-1)[1].turns).toHaveLength(2);
});
it('audio-only capture skips visual analysis and still creates honest derived feedback', async () => {
  const { provider, id, cookie, session } = await setup();
  session.practice = { mode: 'delivery', drill: 'pauses', minutes: 1 };
  const { blob } = wavFromChunks([new Float32Array(16000)]);
  const payload = {
    durationMs: 1000,
    mode: 'seated',
    poseSamples: [],
    postureEvents: [],
    frames: [],
    acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
  };
  const body = Buffer.concat([
    Buffer.from(
      `--boundary\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--boundary\r\nContent-Disposition: form-data; name="audio"; filename="take.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    Buffer.from(await blob.arrayBuffer()),
    Buffer.from('\r\n--boundary--\r\n'),
  ]);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/analyze`,
        headers: { cookie, 'content-type': 'multipart/form-data; boundary=boundary' },
        payload: body,
      })
    ).statusCode,
  ).toBe(202);
  await vi.waitFor(() => expect(session.status).toBe('complete'));
  expect(provider.review.mock.calls.map((c) => c[0])).toEqual(['audio', 'combined']);
  expect(provider.review.mock.calls[0][1].practice.drill).toBe('pauses');
  expect(session.report.stageStatus.video).toBe('skipped');
  expect(session.report.stages.video).toBeUndefined();
  expect(session.report.score.score).toBeNull();
  expect(provider.deleteFile).toHaveBeenCalledOnce();
});
