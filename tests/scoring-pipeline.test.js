import { expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { wavFromChunks } from '../src/media.js';

it('scores actual PCM and sends isolated component results into the combined evaluation', async () => {
  const calls = [];
  let deleted = false;
  const words = Array.from({ length: 140 }, (_, i) => ({
    text: 'word',
    startMs: (i * 60000) / 140,
    endMs: ((i + 1) * 60000) / 140,
  }));
  const feedback = {
    summary: 'Synthetic provider fixture.',
    strengths: [],
    improvements: [],
    limitations: ['Test double only.'],
  };
  const provider = {
    key: 'test',
    requireKey() {},
    async upload() {
      return { name: 'fixture', uri: 'fixture:audio' };
    },
    async transcribe() {
      return { text: words.map((w) => w.text).join(' '), words };
    },
    async review(stage, data) {
      calls.push({ stage, data });
      return feedback;
    },
    async deleteFile() {
      deleted = true;
    },
  };
  const app = await buildApp({ provider, serveStatic: false });
  try {
    const session = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { cloudConsent: true },
    });
    const id = session.json().id;
    const cookie = session.headers['set-cookie'].split(';')[0];
    const samples = new Float32Array(16000 * 60).fill(0.1);
    samples.fill(1, 0, samples.length * 0.04);
    const { blob } = wavFromChunks([samples]);
    const observations = {
      durationMs: 60000,
      mode: 'seated',
      poseSamples: Array.from({ length: 600 }, (_, i) => ({
        timeMs: i * 100,
        valid: true,
        deviation: false,
        movement: false,
      })),
      postureEvents: [],
      frames: [{ timeMs: 0, data: 'data:image/jpeg;base64,VEVTVA==' }],
      acoustics: { clippedFraction: 0, relativeLoudness: 0.1, pitchVariation: null },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--fixture\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(observations)}\r\n--fixture\r\nContent-Disposition: form-data; name="audio"; filename="fixture.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      Buffer.from(await blob.arrayBuffer()),
      Buffer.from('\r\n--fixture--\r\n'),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/analyze`,
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=fixture' },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    let result;
    await expect
      .poll(async () => {
        result = (
          await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })
        ).json();
        return result.status;
      })
      .toBe('complete');
    expect(deleted).toBe(true);
    expect(result.score.metrics.clippedFraction).toBeCloseTo(0.04);
    expect(result.score.score).toBe(50);
    expect(result.visualMetrics.coverage).toBe(result.score.coverage.posture);
    expect(result.visualMetrics.deviationPercent).toBe(
      result.score.metrics.postureDeviationPercent,
    );
    expect(result.visualMetrics.movementPercent).toBe(result.score.metrics.movementPercent);
    expect(calls.map((call) => call.stage)).toEqual(['audio', 'video', 'combined']);
    expect(calls[0].data.scoring.score).toBe(50);
    expect(calls[0].data.scoring.priorities[0].category).toBe('clarity');
    expect(calls[0].data.metrics).not.toHaveProperty('postureDeviationPercent');
    expect(calls[0].data.metrics).not.toHaveProperty('movementPercent');
    expect(calls[1].data.scoring.score).toBe(100);
    expect(calls[1].data).not.toHaveProperty('transcript');
    expect(calls[2].data.score).toBe(result.score.score);
    expect(calls[2].data.components).toEqual(result.score.components);
    expect(calls[2].data.combination).toEqual(result.score.combination);
  } finally {
    await app.close();
  }
});
