import { afterEach, it, expect, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { analysisSchema, scriptSchema, validateWav } from '../server/validation.js';
import { PracticeMedia, wavFromChunks } from '../src/media.js';
import { parseReport } from '../shared/reports.js';
import { MAX_RECORDING_MS, MAX_AUDIO_BYTES } from '../shared/limits.js';
import { GeminiProvider, FILLER_COACHING_PROMPT } from '../server/gemini.js';

let app;
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (app) await app.close();
  app = null;
});
const payload = () => ({
  durationMs: MAX_RECORDING_MS,
  mode: 'seated',
  poseSamples: Array.from({ length: 9000 }, (_, i) => ({
    timeMs: i * 100,
    valid: true,
    deviation: false,
    limited: true,
  })),
  postureEvents: [],
  frames: [],
  acoustics: { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 },
});

it('stops at 15 minutes, rather than at the former five-minute limit', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'MediaRecorder',
    class {
      static isTypeSupported() {
        return true;
      }
      start() {
        this.onstart();
      }
    },
  );
  const onInterrupt = vi.fn();
  const media = new PracticeMedia({ onInterrupt });
  media.ready = true;
  media.stream = {};
  media.audioWorker = { postMessage() {} };
  media.capture = { port: { postMessage() {} } };
  media.start('test', false);
  vi.advanceTimersByTime(5 * 60000);
  expect(onInterrupt).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10 * 60000);
  expect(onInterrupt).toHaveBeenCalledExactlyOnceWith('15-minute practice complete.');
});

it('accepts fifteen-minute sample timelines and report evidence, and rejects excess duration', () => {
  expect(analysisSchema.safeParse(payload()).success).toBe(true);
  expect(analysisSchema.safeParse({ ...payload(), durationMs: 901000 }).success).toBe(false);
  const input = { topic: 'A clear idea', audience: 'Classmates', duration: 15 };
  expect(scriptSchema.safeParse(input).success).toBe(true);
  expect(scriptSchema.safeParse({ ...input, duration: 16 }).success).toBe(false);
  expect(
    parseReport({
      status: 'complete',
      stages: {},
      evidence: [{ id: 'late', category: 'pause', startMs: 850000, endMs: 851000 }],
    }).evidence,
  ).toHaveLength(1);
});

it('accepts and processes a real-sized 15-minute PCM upload above the former 10 MB cap', async () => {
  const { blob } = wavFromChunks([new Float32Array(16000)]);
  const header = Buffer.from(await blob.arrayBuffer()).subarray(0, 44);
  const audio = Buffer.alloc(44 + MAX_RECORDING_MS * 32);
  header.copy(audio);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.writeUInt32LE(audio.length - 44, 40);
  expect(audio.length).toBeLessThanOrEqual(MAX_AUDIO_BYTES);
  expect(() => validateWav(audio, MAX_RECORDING_MS)).not.toThrow();
  const review = { summary: 'Test review', strengths: [], improvements: [], limitations: [] };
  let uploaded = 0,
    transcribedDuration = 0,
    deleted = false;
  app = await buildApp({
    serveStatic: false,
    env: {},
    provider: {
      key: 'test-key',
      requireKey() {},
      async upload(value) {
        uploaded = value.length;
        return { uri: 'test-audio', name: 'temporary' };
      },
      async transcribe(file, signal, durationMs) {
        transcribedDuration = durationMs;
        return { text: 'hello', words: [{ text: 'hello', startMs: 850000, endMs: 850500 }] };
      },
      async review() {
        return review;
      },
      async deleteFile() {
        deleted = true;
      },
    },
  });
  expect((await app.inject('/api/health')).json().maxDurationSeconds).toBe(900);
  const created = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { cloudConsent: true },
  });
  const cookie = created.headers['set-cookie'].split(';')[0],
    id = created.json().id;
  const boundary = 'long-practice';
  const observations = payload();
  observations.frames = Array.from({ length: 20 }, (_, i) => ({
    timeMs: i * 44000,
    data: 'data:image/jpeg;base64,' + 'A'.repeat(176000),
  }));
  const json = JSON.stringify(observations);
  expect(json.length).toBeGreaterThan(4000000);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${json}\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="take.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
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
  let result;
  for (let i = 0; i < 20; i++) {
    result = (await app.inject({ url: `/api/sessions/${id}/report`, headers: { cookie } })).json();
    if (result.status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(result.status).toBe('complete');
  expect(uploaded).toBe(audio.length);
  expect(transcribedDuration).toBe(MAX_RECORDING_MS);
  expect(deleted).toBe(true);
});

it('budgets script output and live transcription for fifteen minutes without changing quotas', async () => {
  const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
  const requests = [],
    budgets = [];
  provider.run = (fn, options) => {
    budgets.push(options.tokens);
    return fn();
  };
  provider.ai.interactions.create = async (value) => {
    requests.push(value);
    return { output_text: 'A useful practice script.' };
  };
  provider.ai.live.connect = async () => ({});
  await provider.script({ topic: 'An idea', audience: 'Classmates', duration: 15 });
  await provider.connectLive({}, undefined);
  expect(requests[0].system_instruction).toContain('1950 words');
  expect(requests[0].generation_config.max_output_tokens).toBeGreaterThan(1800);
  expect(budgets[1]).toBe(45000);
  expect(FILLER_COACHING_PROMPT).toContain('Exclude meaningful uses');
});

it('relays fifteen minutes of live PCM and closes when the bound is exceeded', async () => {
  let release,
    callbacks,
    frames = 0,
    providerClosed = false;
  app = await buildApp({
    serveStatic: false,
    env: {},
    provider: {
      key: 'test-key',
      requireKey() {},
      connectLive(value) {
        callbacks = value;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { cloudConsent: true },
  });
  const cookie = created.headers['set-cookie'].split(';')[0];
  const ws = await app.injectWS(`/api/sessions/${created.json().id}/transcription`, {
    headers: { cookie },
  });
  try {
    const ready = new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data))));
    release({
      close() {
        providerClosed = true;
      },
      sendRealtimeInput() {
        frames++;
        if (frames === 1800)
          callbacks.onmessage({
            serverContent: { inputTranscription: { text: 'Final words.', finished: true } },
          });
      },
    });
    expect(await ready).toEqual({ type: 'ready' });
    const final = new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data))));
    const chunk = Buffer.alloc(16000);
    for (let i = 0; i < 1800; i++) ws.send(chunk);
    expect(await final).toMatchObject({ type: 'final', endMs: 900000 });
    expect(ws.readyState).toBe(1);
    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.send(chunk);
    await closed;
    expect(frames).toBe(1800);
    expect(providerClosed).toBe(true);
  } finally {
    ws.terminate();
  }
});
