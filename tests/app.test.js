import { it, expect, afterEach } from 'vitest';
import { buildApp } from '../server/app.js';
import { wavFromChunks } from '../src/media.js';
const apps = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const report = {
  summary: 'A useful practice run.',
  strengths: [],
  improvements: [],
  limitations: [],
};
function fakeProvider() {
  return {
    key: 'fake',
    model: 'fake',
    requireKey() {},
    async script() {
      return 'Practice script';
    },
    async upload() {
      return { name: 'temporary', uri: 'test-audio' };
    },
    async deleteFile() {},
    async transcribe() {
      return { text: 'hello', words: [{ text: 'hello', startMs: 0, endMs: 100 }] };
    },
    async review() {
      return report;
    },
    async *chat() {
      yield 'Try a clear opening.';
    },
  };
}
async function setup(provider = fakeProvider(), practice = { mode: 'free' }) {
  const app = await buildApp({ provider, serveStatic: false });
  apps.push(app);
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { cloudConsent: true, practice },
  });
  return { app, id: response.json().id, cookie: response.headers['set-cookie'].split(';')[0] };
}
it('rejects cross-origin changes and requires cloud disclosure acknowledgment', async () => {
  const { app } = await setup();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { origin: 'https://evil.example' },
        payload: { cloudConsent: true },
      })
    ).statusCode,
  ).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/sessions', payload: {} })).statusCode).toBe(
    400,
  );
});
it('uses the injected environment and restricts production origins', async () => {
  const app = await buildApp({
    env: { NODE_ENV: 'production', APP_ORIGIN: 'https://stagecraft.example' },
    provider: fakeProvider(),
    serveStatic: false,
  });
  apps.push(app);
  expect((await app.inject({ url: '/api/health' })).json().aiConfigured).toBe(true);
  expect(
    (await app.inject({ url: '/api/health', headers: { origin: 'http://127.0.0.1:3000' } }))
      .statusCode,
  ).toBe(403);
  const session = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { origin: 'https://stagecraft.example' },
    payload: { cloudConsent: true },
  });
  expect(session.statusCode).toBe(200);
  expect(session.headers['set-cookie']).toContain('Secure');
  expect(session.headers['content-security-policy']).toContain("frame-ancestors 'none'");
});
it('requires ownership for reports and deletion', async () => {
  const { app, id, cookie } = await setup();
  expect((await app.inject({ url: `/api/sessions/${id}/report` })).statusCode).toBe(404);
  expect(
    (await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/sessions/${id}`, headers: { cookie } }))
      .statusCode,
  ).toBe(204);
  expect(
    (await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })).statusCode,
  ).toBe(404);
});
it.each([false, true])(
  'processes isolated stages and deletes audio (memorization: %s)',
  async (memorization) => {
    const provider = fakeProvider();
    const calls = [];
    let deleted = false;
    provider.review = async (stage, data, media) => {
      calls.push({ stage, data, media });
      return report;
    };
    provider.deleteFile = async () => {
      deleted = true;
    };
    const { app, id, cookie } = await setup(provider);
    const { blob } = wavFromChunks([new Float32Array(16000)]);
    const audio = Buffer.from(await blob.arrayBuffer());
    const payload = {
      durationMs: 1000,
      mode: 'seated',
      ...(memorization
        ? { memorization: { script: 'Remember these main ideas.', minutes: 2 } }
        : {}),
      poseSamples: [],
      postureEvents: [],
      frames: [{ timeMs: 0, data: 'data:image/jpeg;base64,VEVTVA==' }],
      acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
    };
    const boundary = 'practice-boundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="practice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/analyze`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = (
      await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
    ).json();
    expect(result.status).toBe('complete');
    expect(result.score.score).toBeNull();
    expect(deleted).toBe(true);
    expect(calls.map((c) => c.stage)).toEqual(['audio', 'video', 'combined']);
    expect(calls[0].data).not.toHaveProperty('mode');
    expect(calls[0].data.metrics).not.toHaveProperty('postureDeviationPercent');
    expect(calls[0].media[0].type).toBe('audio');
    expect(calls[0].data.memorization).toEqual(payload.memorization);
    expect(calls[1].data).not.toHaveProperty('transcript');
    expect(calls[1].data).not.toHaveProperty('memorization');
    expect(calls[2].data).not.toHaveProperty('memorization');
    expect(calls[1].media).toEqual([{ type: 'image', data: 'VEVTVA==', mime_type: 'image/jpeg' }]);
    expect(calls[2].media).toEqual([]);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/analyze`,
      headers: { cookie },
    });
    expect(duplicate.statusCode).toBe(202);
    expect(calls).toHaveLength(3);
  },
);
it('returns chat as a stream and validates prerequisites', async () => {
  const { app, id, cookie } = await setup();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/chat`,
        headers: { cookie },
        payload: { message: 'Help me' },
      })
    ).statusCode,
  ).toBe(409);
  app.sessionStore.get(id, cookie.split('=')[1]).report.stages.combined = report;
  const result = await app.inject({
    method: 'POST',
    url: `/api/sessions/${id}/chat`,
    headers: { cookie },
    payload: { message: 'Help me' },
  });
  expect(result.statusCode).toBe(200);
  expect(result.body).toContain('Try a clear opening.');
  expect(result.body).toContain('"done":true');
});
it('fails oversized coaching streams without persisting a partial successful reply', async () => {
  const provider = fakeProvider();
  provider.chat = async function* () {
    yield 'a'.repeat(12001);
  };
  const { app, id, cookie } = await setup(provider);
  const session = app.sessionStore.get(id, cookie.split('=')[1]);
  session.report.stages.combined = report;
  const result = await app.inject({
    method: 'POST',
    url: `/api/sessions/${id}/chat`,
    headers: { cookie },
    payload: { message: 'Help me' },
  });
  expect(result.body).toContain('"error"');
  expect(result.body).not.toContain('"done":true');
  expect(session.messages).toEqual([]);
});

it('preserves visual feedback when word-timed transcription fails', async () => {
  const provider = fakeProvider();
  provider.transcribe = async () => {
    throw Object.assign(new Error('Missing timestamps'), { code: 'TIMESTAMPS_UNAVAILABLE' });
  };
  const calls = [];
  let visualInput;
  provider.review = async (stage, data) => {
    calls.push(stage);
    visualInput = data;
    return report;
  };
  const { app, id, cookie } = await setup(provider);
  const { blob } = wavFromChunks([new Float32Array(16000)]);
  const audio = Buffer.from(await blob.arrayBuffer());
  const payload = {
    durationMs: 1000,
    mode: 'seated',
    poseSamples: Array.from({ length: 10 }, (_, i) => ({
      timeMs: i * 100,
      valid: true,
      deviation: false,
    })),
    postureEvents: [],
    frames: [{ timeMs: 0, data: 'data:image/jpeg;base64,VEVTVA==' }],
    acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
  };
  const boundary = 'partial-job';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="practice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/analyze`,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
    ).statusCode,
  ).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = (
    await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
  ).json();
  expect(result.status).toBe('partial');
  expect(calls).toEqual(['video']);
  expect(result.stages.video).toEqual(report);
  expect(visualInput.trackingCoverage).toBe(1);
  expect(result.visualMetrics.coverage).toBe(1);
  expect(result.score.score).toBeNull();
});

async function submitShortTake(app, id, cookie) {
  const { blob } = wavFromChunks([new Float32Array(16000)]);
  const audio = Buffer.from(await blob.arrayBuffer());
  const payload = {
    durationMs: 1000,
    mode: 'seated',
    poseSamples: [],
    postureEvents: [],
    frames: [{ timeMs: 0, data: 'data:image/jpeg;base64,VEVTVA==' }],
    acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
  };
  const boundary = 'memory-fixture';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="practice.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/api/sessions/${id}/analyze`,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}
it('compares memory with the session script without leaking it to visual or delivery-only reviews', async () => {
  const provider = fakeProvider(),
    calls = [];
  provider.review = async (stage, data, media) => {
    calls.push({ stage, data, media });
    return report;
  };
  const reference = 'A useful original script about forming a small daily habit.';
  const { app, id, cookie } = await setup(provider, {
    mode: 'memorization',
    script: reference,
    minutes: 2,
  });
  expect((await submitShortTake(app, id, cookie)).statusCode).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = (
    await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
  ).json();
  expect(result.status).toBe('complete');
  expect(result.stages.memory).toEqual(report);
  expect(result.stageStatus.memory).toBe('complete');
  const memory = calls.find((call) => call.stage === 'memory');
  expect(memory.data.referenceScript).toBe(reference);
  expect(memory.data.transcript).toBe('hello');
  expect(memory.media).toEqual([]);
  expect(calls.find((call) => call.stage === 'audio').data).not.toHaveProperty('referenceScript');
  expect(calls.find((call) => call.stage === 'video').data).not.toHaveProperty('transcript');
  expect(calls.find((call) => call.stage === 'video').data).not.toHaveProperty('referenceScript');
  expect(calls.find((call) => call.stage === 'combined').data.memory).toEqual(report);
  const count = calls.length;
  await submitShortTake(app, id, cookie);
  expect(calls).toHaveLength(count);
});
it('preserves delivery reviews when memory feedback fails and retries only the missing stage', async () => {
  const provider = fakeProvider();
  let failed = true;
  const calls = [];
  provider.review = async (stage) => {
    calls.push(stage);
    if (stage === 'memory' && failed) throw new Error('Failed memory review');
    return report;
  };
  const { app, id, cookie } = await setup(provider, {
    mode: 'memorization',
    script: 'Remember three useful ideas about practice.',
    minutes: 1,
  });
  await submitShortTake(app, id, cookie);
  await new Promise((resolve) => setTimeout(resolve, 30));
  let result = (
    await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
  ).json();
  expect(result.status).toBe('partial');
  expect(result.stageStatus.memory).toBe('failed');
  expect(result.stages.audio).toEqual(report);
  expect(result.stages.video).toEqual(report);
  failed = false;
  calls.length = 0;
  await submitShortTake(app, id, cookie);
  await new Promise((resolve) => setTimeout(resolve, 30));
  result = (await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })).json();
  expect(result.status).toBe('complete');
  expect(result.stages.memory).toEqual(report);
  expect(calls).toEqual(['memory']);
});
it('does not invent memory feedback when transcription fails', async () => {
  const provider = fakeProvider();
  const calls = [];
  provider.transcribe = async () => {
    throw new Error('No transcript');
  };
  provider.review = async (stage) => {
    calls.push(stage);
    return report;
  };
  const { app, id, cookie } = await setup(provider, {
    mode: 'memorization',
    script: 'Remember three useful ideas about practice.',
    minutes: 1,
  });
  await submitShortTake(app, id, cookie);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = (
    await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
  ).json();
  expect(result.status).toBe('partial');
  expect(result.stageStatus.memory).toBe('skipped');
  expect(result.stages).not.toHaveProperty('memory');
  expect(calls).toEqual(['video']);
});
