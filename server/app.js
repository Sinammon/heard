import { registerPracticeRoutes } from './practice-routes.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import staticFiles from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GeminiProvider, publicProviderError } from './gemini.js';
import { SessionStore } from './sessions.js';
import {
  analysisSchema,
  scriptSchema,
  chatSchema,
  flashcardInputSchema,
  validateWav,
} from './validation.js';
import { flashcardsSchema } from '../shared/flashcards.js';
import { sessionInputSchema } from '../shared/practice.js';
import { finalScore } from '../shared/scoring.js';
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  MAX_EVIDENCE_MS,
  MAX_ANALYSIS_FIELD_BYTES,
} from '../shared/limits.js';

export async function buildApp({
  store = new SessionStore(),
  env = process.env,
  provider = new GeminiProvider(env),
  serveStatic = true,
} = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 1,
      parts: 2,
      fileSize: MAX_AUDIO_BYTES,
      fieldSize: MAX_ANALYSIS_FIELD_BYTES,
    },
    throwFileSizeLimit: true,
  });
  const isVercel = Boolean(env.VERCEL);
  if (!isVercel) await app.register(websocket, { options: { maxPayload: 40000 } });
  const rate = new Map();
  const allowedOrigins = new Set([env.APP_ORIGIN || 'http://localhost:3000']);
  const addOrigin = (value) => {
    if (!value) return;
    allowedOrigins.add(value.startsWith('http') ? value : `https://${value}`);
  };
  addOrigin(env.APP_ORIGIN);
  addOrigin(env.VERCEL_URL);
  addOrigin(env.VERCEL_BRANCH_URL);
  addOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://127.0.0.1:3000');
    allowedOrigins.add('http://127.0.0.1:5173');
    allowedOrigins.add('http://localhost:5173');
  }
  const sweep = setInterval(() => {
    store.sweep();
    for (const [k, v] of rate) if (v.reset <= Date.now()) rate.delete(k);
  }, 30000);
  sweep.unref();
  app.addHook('onClose', async () => {
    clearInterval(sweep);
    store.close();
  });
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('Permissions-Policy', 'camera=(self), microphone=(self)')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin))
      return reply.code(403).send({ error: 'This request came from another website.' });
    if (request.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Cross-site requests are not allowed.' });
  });
  function limited(request, name, limit, window = 60000) {
    const key = `${request.ip}:${name}`;
    let bucket = rate.get(key);
    if (!bucket || bucket.reset <= Date.now()) {
      bucket = { reset: Date.now() + window, count: 0 };
      rate.set(key, bucket);
    }
    if (++bucket.count > limit)
      throw Object.assign(new Error('Too many requests. Please wait before trying again.'), {
        statusCode: 429,
      });
  }
  function requireSession(request) {
    const s = store.get(request.params.id, request.cookies.stagecraft);
    if (!s)
      throw Object.assign(
        new Error(
          'This session expired or does not belong to this browser. Start a new practice session.',
        ),
        { statusCode: 404 },
      );
    return s;
  }
  app.setErrorHandler((error, request, reply) => {
    if (error.name === 'ZodError')
      return reply.code(400).send({ error: 'The request contains invalid or oversized data.' });
    if (error.statusCode === 413)
      return reply
        .code(413)
        .send({ error: 'This recording is too large. Use a practice of 15 minutes or less.' });
    reply.code(error.statusCode || 500).send({
      error:
        error.statusCode && error.statusCode < 500 ? error.message : publicProviderError(error),
    });
  });
  app.get('/api/health', async () => ({
    ok: true,
    aiConfigured: Boolean(provider.key),
    models: {
      coaching: provider.model,
      transcription: provider.transcribeModel,
      live: provider.liveModel,
    },
    maxDurationSeconds: MAX_RECORDING_MS / 1000,
  }));
  app.post('/api/scripts', async (request, reply) => {
    limited(request, 'scripts', 3);
    const input = scriptSchema.parse(request.body);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    return { script: await provider.script(input, controller.signal) };
  });
  app.post('/api/flashcards', async (request, reply) => {
    limited(request, 'flashcards', 3);
    const input = flashcardInputSchema.parse(request.body);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    const result = await provider.flashcards(input.script, controller.signal);
    const parsed = flashcardsSchema.safeParse(result);
    if (!parsed.success)
      throw Object.assign(new Error('Invalid talking-point output.'), { code: 'INVALID_OUTPUT' });
    return parsed.data;
  });
  app.post('/api/sessions', async (request, reply) => {
    limited(request, 'sessions', 10, 3600000);
    if (request.body?.cloudConsent !== true)
      return reply
        .code(400)
        .send({ error: 'Confirm the cloud-processing disclosure before creating a session.' });
    if (!provider.key)
      return reply.code(503).send({
        error: 'AI practice is unavailable. Configure the Gemini service before recording.',
      });
    const input = sessionInputSchema.parse(request.body);
    const owner = request.cookies.stagecraft || randomUUID();
    reply.setCookie('stagecraft', owner, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure:
        env.SECURE_COOKIES === 'true' ||
        (env.NODE_ENV === 'production' && env.SECURE_COOKIES !== 'false'),
      maxAge: 7200,
    });
    const s = store.create(owner);
    s.practice = input.practice;
    return { id: s.id };
  });
  app.delete('/api/sessions/:id', async (request, reply) => {
    const s = requireSession(request);
    store.delete(s.id);
    return reply.code(204).send();
  });
  app.get('/api/sessions/:id/report', async (request) => {
    const s = requireSession(request);
    return { status: s.status, jobId: s.jobId, ...s.report, error: s.error };
  });
  let activeJobs = 0;
  registerPracticeRoutes(app, { provider, limited, requireSession });
  app.post('/api/sessions/:id/analyze', async (request, reply) => {
    const s = requireSession(request);
    limited(request, 'analysis', 5);
    if (s.interviewBusy || (s.practice.mode === 'interview' && !s.interview?.question))
      return reply.code(409).send({ error: 'Prepare an interview question first.' });
    if (s.status === 'processing' || s.status === 'complete')
      return reply.code(202).send({ jobId: s.jobId, status: s.status });
    if (activeJobs >= 3)
      return reply.code(429).send({
        error:
          'The studio is processing other recordings. Your local recording is safe; retry shortly.',
      });
    let audio, payload;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio' || part.mimetype !== 'audio/wav')
          throw Object.assign(new Error('Only the audio WAV file can be uploaded.'), {
            statusCode: 400,
          });
        audio = await part.toBuffer();
      } else if (part.fieldname === 'payload') {
        try {
          payload = analysisSchema.parse(JSON.parse(part.value));
        } catch {
          throw Object.assign(new Error('Invalid analysis observations.'), { statusCode: 400 });
        }
      }
    }
    if (!audio || !payload)
      return reply.code(400).send({ error: 'Audio and observations are both required.' });
    try {
      const measuredAudio = validateWav(audio, payload.durationMs);
      // Score actual PCM clipping rather than trusting a client-supplied perfect value.
      payload.acoustics.clippedFraction = measuredAudio.clippedFraction;
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
    provider.requireKey();
    // Recheck after reading the upload: other requests may have claimed a slot meanwhile.
    if (s.status === 'processing' || s.status === 'complete') {
      audio.fill(0);
      return reply.code(202).send({ jobId: s.jobId, status: s.status });
    }
    if (activeJobs >= 3) {
      audio.fill(0);
      return reply
        .code(429)
        .send({ error: 'Analysis is busy. Retry your local recording shortly.' });
    }
    s.status = 'processing';
    s.error = null;
    s.report.stageStatus = Object.fromEntries(
      [
        'transcript',
        'audio',
        ...(s.practice?.mode === 'memorization' ? ['memory'] : []),
        'video',
        'combined',
      ].map((key) => [
        key,
        (key === 'transcript' ? s.transcript : s.report.stages[key]) ? 'complete' : 'waiting',
      ]),
    );
    s.jobId ||= randomUUID();
    // A retry reuses completed stages and canonical transcription. Raw media never enters the report store.
    activeJobs++;
    void processAnalysis(s, audio, payload).finally(() => {
      activeJobs--;
    });
    return reply.code(202).send({ jobId: s.jobId, status: s.status });
  });
  async function processAnalysis(s, audio, payload) {
    let file;
    let outcome = 'failed';
    const signal = s.abort.signal;
    try {
      signal.throwIfAborted();
      file = await provider.upload(audio, signal);
      if (!file?.uri || !file?.name) throw new Error('Incomplete provider upload.');
      signal.throwIfAborted();
      const errors = [];
      const attempt = async (key, action) => {
        s.report.stageStatus[key] = 'running';
        try {
          const result = await action();
          s.report.stageStatus[key] = 'complete';
          return result;
        } catch (error) {
          s.report.stageStatus[key] = 'failed';
          throw error;
        }
      };
      if (!s.transcript) {
        try {
          s.transcript = await attempt('transcript', () =>
            provider.transcribe(file, signal, payload.durationMs),
          );
        } catch (e) {
          if (signal.aborted) throw e;
          errors.push(publicProviderError(e));
        }
      }
      if (!s.transcript) s.report.stageStatus.audio = 'skipped';
      const scoring = finalScore({
        words: s.transcript?.words || [],
        transcript: s.transcript?.text || '',
        poseSamples: payload.poseSamples,
        durationMs: payload.durationMs,
        acoustics: payload.acoustics,
      });
      s.report.score = scoring;
      s.report.visualMetrics = {
        coverage: scoring.coverage.posture,
        deviationPercent: scoring.metrics.postureDeviationPercent,
        upperBodyOnly: scoring.coverage.upperBodyOnly,
        movementPercent: scoring.metrics.movementPercent,
      };
      const evidence = [
        ...scoring.events,
        ...payload.postureEvents,
        ...payload.frames.map((f, i) => ({
          id: `frame-${i}`,
          category: 'frame',
          startMs: f.timeMs,
          endMs: f.timeMs,
        })),
      ];
      s.report.evidence = evidence;
      s.report.transcript = s.transcript?.text;
      s.report.words = s.transcript?.words;
      if (s.transcript && !s.report.stages.audio) {
        try {
          const { postureDeviationPercent, movementPercent, ...speechMetrics } = scoring.metrics;
          s.report.stages.audio = await attempt('audio', () =>
            provider.review(
              'audio',
              {
                transcript: s.transcript.text,
                ...(payload.memorization ? { memorization: payload.memorization } : {}),
                ...(s.practice.mode !== 'memorization'
                  ? {
                      practice: {
                        ...s.practice,
                        ...(s.interview ? { question: s.interview.question } : {}),
                      },
                    }
                  : {}),
                durationMs: payload.durationMs,
                metrics: speechMetrics,
                scoring: {
                  ...scoring.components.audio,
                  rubric: scoring.version,
                  penalties: Object.fromEntries(
                    ['filler', 'pace', 'pause', 'clarity'].map((key) => [
                      key,
                      scoring.penalties[key],
                    ]),
                  ),
                  priorities: scoring.feedback.filter(
                    (item) => !['posture', 'movement'].includes(item.category),
                  ),
                },
                acoustics: payload.acoustics,
                evidence: evidence.filter((e) => ['filler', 'pause'].includes(e.category)),
              },
              [{ type: 'audio', uri: file.uri, mime_type: file.mimeType || 'audio/wav' }],
              signal,
            ),
          );
        } catch (e) {
          if (signal.aborted) throw e;
          errors.push(publicProviderError(e));
        }
      }
      if (s.practice?.mode === 'memorization') {
        if (s.transcript && !s.report.stages.memory) {
          try {
            s.report.stages.memory = await attempt('memory', () =>
              provider.review(
                'memory',
                {
                  referenceScript: s.practice.script,
                  transcript: s.transcript.text,
                  words: s.transcript.words,
                  evidence: evidence.filter((e) => ['filler', 'pause'].includes(e.category)),
                },
                [],
                signal,
              ),
            );
          } catch (e) {
            if (signal.aborted) throw e;
            errors.push(publicProviderError(e));
          }
        } else if (!s.transcript) s.report.stageStatus.memory = 'skipped';
      }
      const hasVisualEvidence = payload.frames.length > 0;
      if (!hasVisualEvidence) s.report.stageStatus.video = 'skipped';
      if (hasVisualEvidence && !s.report.stages.video) {
        try {
          s.report.stages.video = await attempt('video', () =>
            provider.review(
              'video',
              {
                mode: payload.mode,
                trackingCoverage: s.report.visualMetrics.coverage,
                deviationPercent: s.report.visualMetrics.deviationPercent,
                upperBodyOnlyFraction: s.report.visualMetrics.upperBodyOnly,
                movementPercent: s.report.visualMetrics.movementPercent,
                scoring: {
                  ...scoring.components.posture,
                  rubric: scoring.version,
                  penalties: {
                    posture: scoring.penalties.posture,
                    movement: scoring.penalties.movement,
                  },
                  priorities: scoring.feedback.filter((item) =>
                    ['posture', 'movement'].includes(item.category),
                  ),
                },
                evidence: evidence.filter((e) => ['posture', 'frame'].includes(e.category)),
                frameTimesMs: payload.frames.map((f) => f.timeMs),
              },
              payload.frames.map((f) => ({
                type: 'image',
                data: f.data.split(',')[1],
                mime_type: 'image/jpeg',
              })),
              signal,
            ),
          );
        } catch (e) {
          if (signal.aborted) throw e;
          errors.push(publicProviderError(e));
        }
      }
      if (
        s.report.stages.audio &&
        (!hasVisualEvidence || s.report.stages.video) &&
        !s.report.stages.combined
      ) {
        try {
          s.report.stages.combined = await attempt('combined', () =>
            provider.review(
              'combined',
              {
                mode: payload.mode,
                audio: s.report.stages.audio,
                video: s.report.stages.video,
                ...(s.practice?.mode === 'memorization'
                  ? { memory: s.report.stages.memory || null }
                  : {}),
                score: scoring.score,
                penalties: scoring.penalties,
                components: scoring.components,
                combination: scoring.combination,
                partial: scoring.partial,
                warnings: scoring.warnings,
                priorities: scoring.feedback,
                evidence,
              },
              [],
              signal,
            ),
          );
        } catch (e) {
          if (signal.aborted) throw e;
          errors.push(publicProviderError(e));
        }
      }
      if (!s.report.stages.audio || (hasVisualEvidence && !s.report.stages.video))
        s.report.stageStatus.combined = 'skipped';
      signal.throwIfAborted();
      outcome = errors.length ? 'partial' : 'complete';
      s.error = errors[0] || null;
    } catch (error) {
      if (!signal.aborted) {
        s.error = publicProviderError(error);
      }
    } finally {
      audio.fill(0);
      payload.frames.length = 0;
      if (file) {
        try {
          await provider.deleteFile(file);
        } catch {
          s.report.cleanupWarning =
            'Uploaded audio deletion could not be confirmed. Gemini Files expire automatically; no application copy is retained.';
        }
      }
      if (!signal.aborted) s.status = outcome;
    }
  }
  app.post('/api/sessions/:id/chat', async (request, reply) => {
    const s = requireSession(request);
    limited(request, 'chat', 20);
    if (!s.report.stages.combined)
      return reply
        .code(409)
        .send({ error: 'Complete the combined review before starting the chat.' });
    if (s.chatting) return reply.code(409).send({ error: 'Wait for the current coaching reply.' });
    const { message } = chatSchema.parse(request.body);
    provider.requireKey();
    const controller = new AbortController();
    const abort = () => controller.abort();
    s.abort.signal.addEventListener('abort', abort, { once: true });
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    let answer = '';
    s.chatting = true;
    try {
      for await (const text of provider.chat(s, message, controller.signal)) {
        answer += text;
        if (answer.length > 12000) {
          controller.abort();
          throw new Error('The coaching reply exceeded the response limit.');
        }
        reply.raw.write(`${JSON.stringify({ text })}\n`);
      }
      if (!answer.trim()) throw new Error('Empty coaching reply.');
      s.messages.push({ role: 'user', text: message }, { role: 'assistant', text: answer });
      s.messages = s.messages.slice(-8);
      reply.raw.write(`${JSON.stringify({ done: true })}\n`);
    } catch (e) {
      if (!reply.raw.destroyed)
        reply.raw.write(`${JSON.stringify({ error: publicProviderError(e) })}\n`);
    } finally {
      s.chatting = false;
      s.abort.signal.removeEventListener('abort', abort);
      reply.raw.end();
    }
  });
  let liveCount = 0;
  if (!isVercel)
    app.get(
      '/api/sessions/:id/transcription',
      {
        websocket: true,
        preValidation: async (request) => {
          requireSession(request);
          if (!provider.key)
            throw Object.assign(new Error('Add GEMINI_API_KEY to enable live transcription.'), {
              statusCode: 503,
            });
        },
      },
      (socket, request) => {
        const s = requireSession(request);
        if (s.live || liveCount >= 4) {
          socket.close(1013, 'Live transcription is busy.');
          return;
        }
        s.live = true;
        liveCount++;
        let live,
          audioMs = 0,
          turn = 0,
          startMs = 0,
          pending = '',
          ended = false,
          lastSignature = '';
        const send = (value) => {
          if (socket.readyState === 1) socket.send(JSON.stringify(value));
        };
        const cleanup = () => {
          if (ended) return;
          ended = true;
          s.live = false;
          liveCount--;
          clearTimeout(timer);
          s.resources.delete(close);
          try {
            live?.close();
          } catch {}
        };
        const close = () => {
          cleanup();
          socket.close(1000, 'Session ended.');
        };
        const timer = setTimeout(close, MAX_RECORDING_MS + 10000);
        s.resources.add(close);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
        // Install message handlers synchronously so frames arriving while upstream connects are not lost silently.
        socket.on('message', (buffer, binary) => {
          if (ended) return;
          if (binary) {
            if (!live) {
              send({ type: 'error', message: 'Wait for live transcription to connect.' });
              return;
            }
            if (buffer.length % 2 || buffer.length > 16000) {
              socket.close(1009, 'Invalid audio chunk.');
              return;
            }
            audioMs += buffer.length / 32;
            if (audioMs > MAX_EVIDENCE_MS) {
              close();
              return;
            }
            try {
              live.sendRealtimeInput({
                audio: { data: buffer.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
              });
            } catch {
              close();
            }
          } else {
            let data;
            try {
              data = JSON.parse(buffer.toString());
            } catch {
              socket.close(1008, 'Invalid message.');
              return;
            }
            if (data.type === 'end') {
              live?.sendRealtimeInput({ audioStreamEnd: true });
              setTimeout(close, 2000).unref();
            }
            if (data.type === 'cancel') close();
          }
        });
        void provider
          .connectLive(
            {
              onmessage: (message) => {
                const content = message.serverContent;
                if (!content || ended) return;
                const interim = content.interimInputTranscription;
                if (interim?.text) send({ type: 'interim', text: interim.text });
                const final = content.inputTranscription;
                if (final?.text) {
                  if (final.finished === false) {
                    pending += final.text;
                    return;
                  }
                  const text = pending + final.text;
                  pending = '';
                  const signature = `${text}:${audioMs}`;
                  if (signature === lastSignature) return;
                  lastSignature = signature;
                  send({
                    type: 'final',
                    id: `turn-${turn++}`,
                    text,
                    startMs,
                    endMs: audioMs,
                    timing: 'approximate',
                  });
                  startMs = audioMs;
                }
              },
              onerror: () => {
                send({
                  type: 'error',
                  message: 'Live transcription stopped. Final audio analysis can still be retried.',
                });
                close();
              },
              onclose: () => close(),
            },
            s.abort.signal,
          )
          .then((connection) => {
            if (ended) connection.close();
            else {
              live = connection;
              send({ type: 'ready' });
            }
          })
          .catch((e) => {
            send({ type: 'error', message: publicProviderError(e) });
            close();
          });
      },
    );
  if (serveStatic && existsSync(resolve('dist/index.html')))
    await app.register(staticFiles, { root: resolve('dist'), prefix: '/', index: 'index.html' });
  app.decorate('sessionStore', store);
  return app;
}
