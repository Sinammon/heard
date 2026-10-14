import { calibrate, measurements, PostureDetector, EpisodeTracker } from '../shared/posture.js';
import { provisionalScore, RUBRIC } from '../shared/scoring.js';
import { detectFillers } from '../shared/speech.js';
import { MAX_RECORDING_MS } from '../shared/limits.js';

export function wavFromChunks(chunks) {
  const size = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new ArrayBuffer(44 + size * 2),
    view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + size * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const s of chunk) {
      view.setInt16(offset, s < 0 ? Math.max(-1, s) * 32768 : Math.min(1, s) * 32767, true);
      offset += 2;
    }
  return { blob: new Blob([buffer], { type: 'audio/wav' }), durationMs: size / 16 };
}

export class PracticeMedia {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.mode = 'seated';
    this.ready = false;
    this.poseReady = false;
    this.running = false;
    this.calibrating = false;
    this.baseline = null;
    this.noise = 0.008;
    this.poseSamples = [];
    this.calibrationSamples = [];
    this.events = [];
    this.pcm = [];
    this.frames = [];
    this.episodes = new EpisodeTracker({ sustainMs: 0, recoveryMs: 0 });
    this.postureDetector = new PostureDetector();
    this.turns = [];
    this.seenTurns = new Set();
    this.lastPose = null;
    this.lastMetrics = null;
    this.acoustics = { pitchVariation: null, relativeLoudness: 0, clippedFraction: 0 };
  }
  async prepare(video, { audioId, videoId, camera = true } = {}) {
    this.video = video;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error('Use desktop Chrome or Edge on localhost or HTTPS to record.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioId
        ? { deviceId: { exact: audioId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true },
      video: camera
        ? {
            ...(videoId ? { deviceId: { exact: videoId } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          }
        : false,
    });
    this.hasVideo = this.stream.getVideoTracks().length > 0;
    if (this.hasVideo && video) {
      video.srcObject = this.stream;
      await video.play();
    }
    for (const track of this.stream.getTracks())
      track.addEventListener('ended', () => {
        if (this.ready || this.running)
          this.callbacks.onInterrupt?.(
            'A recording device disconnected. Your recording has been preserved.',
          );
      });
    this.context = new AudioContext({ sampleRate: 16000 });
    await this.context.resume();
    if (this.context.sampleRate !== 16000) {
      await this.dispose();
      throw new Error(
        'This browser cannot capture the required 16 kHz audio. Use desktop Chrome or Edge.',
      );
    }
    await this.context.audioWorklet.addModule('/audio-worklet.js');
    this.capture = new AudioWorkletNode(this.context, 'practice-capture');
    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.capture);
    this.capture.connect(this.context.destination);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.35;
    this.visualizerGain = this.context.createGain();
    this.visualizerGain.gain.value = 0;
    this.source.connect(this.analyser);
    this.analyser.connect(this.visualizerGain);
    this.visualizerGain.connect(this.context.destination);
    this.audioWorker = new Worker(new URL('./audio-worker.js', import.meta.url), {
      type: 'module',
    });
    this.audioWorker.onmessage = ({ data }) => {
      if (data.type === 'finished') {
        this.acoustics = data.acoustics;
        this.finishAudio?.();
      }
      if (data.type === 'metrics') {
        this.lastMetrics = data;
        if (data.pause) this.events.push(data.pause);
        this.callbacks.onAudio?.(data);
        this.publishScore();
      }
    };
    this.capture.port.onmessage = ({ data }) => {
      if (data.type === 'stopped') {
        this.finishCapture?.();
        return;
      }
      const samples = data.samples;
      if (!data.recording && !this.running) {
        const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
        this.callbacks.onLevel?.(rms);
        if (this.calibrating) this.noiseSamples.push(rms);
        return;
      }
      this.pcm.push(samples);
      const timeMs = Math.max(0, data.sampleCount / 16 - samples.length / 16);
      this.audioWorker.postMessage({ type: 'samples', samples: samples.slice(), timeMs });
      if (
        this.socket?.readyState === WebSocket.OPEN &&
        this.liveReady &&
        this.socket.bufferedAmount < 64000
      ) {
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++)
          pcm[i] = Math.max(-32768, Math.min(32767, samples[i] * 32767));
        this.socket.send(pcm.buffer);
      } else if (this.socket?.bufferedAmount >= 64000) {
        this.socket.close();
        this.callbacks.onLive?.(
          'Connection slowed. Final speech analysis will use your local audio.',
        );
      }
    };
    // MediaPipe's WASM loader uses importScripts, which needs a classic worker.
    // Vite bundles this entry (and its ESM imports) as an IIFE for production.
    this.ready = true;
    if (!this.hasVideo) return;
    this.poseWorker = new Worker(new URL('./pose-worker.js', import.meta.url));
    this.poseWorker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        this.poseReady = true;
        this.callbacks.onPoseReady?.();
      }
      if (data.type === 'error') this.callbacks.onLive?.(data.message);
      if (data.type === 'pose') {
        if (this.running && data.time < this.startedAt) {
          this.poseBusy = false;
          return;
        }
        this.poseBusy = false;
        const m = measurements(data.landmarks, this.mode, data.aspectRatio, data.worldLandmarks);
        if (this.calibrating) {
          this.calibrationFrames++;
          if (m) {
            this.calibrationFirst ??= data.time;
            this.calibrationLast = data.time;
            this.calibrationSamples.push(m);
          }
        }
        const posture = this.postureDetector.update(m, this.baseline, this.mode, data.time);
        this.lastPoseTime = performance.now();
        this.poseStale = false;
        this.lastPose = { ...posture, landmarks: data.landmarks };
        if (this.running) {
          const sample = {
            timeMs: Math.max(0, data.time - this.startedAt),
            valid: posture.valid,
            deviation: posture.deviation,
            limited: Boolean(posture.limited),
          };
          this.poseSamples.push(sample);
          const event = this.episodes.update(sample);
          if (event) this.events.push(event);
          this.publishScore();
        }
        this.callbacks.onPose?.(this.lastPose);
      }
    };
    this.poseWorker.postMessage({ type: 'init' });
    this.ready = true;
    this.frameLoop();
  }
  frameLoop() {
    if (!this.ready) return;
    const time = performance.now();
    if (this.poseBusy && time - this.lastFrameTime > 2000) {
      this.poseReady = false;
      this.poseBusy = false;
      this.poseWorker.terminate();
      this.postureDetector.reset();
      this.callbacks.onPose?.({
        valid: false,
        deviation: false,
        landmarks: null,
        hint: 'Posture tracking stopped · reconnect devices to retry',
      });
      this.episodes.close(this.episodes.lastValid);
    }
    if (this.baseline && time - (this.lastPoseTime || time) > 1000 && !this.poseStale) {
      this.poseStale = true;
      this.postureDetector.reset();
      this.episodes.update({
        timeMs: Math.max(0, time - (this.startedAt || time)),
        valid: false,
        deviation: false,
      });
      this.callbacks.onPose?.({
        valid: false,
        deviation: false,
        hint: 'Tracking paused · waiting for camera frames',
        landmarks: null,
      });
    }
    if (
      this.poseReady &&
      !this.poseBusy &&
      time - (this.lastFrameTime || 0) >= (this.poseInterval || 100) &&
      this.video.readyState >= 2
    ) {
      this.poseBusy = true;
      this.lastFrameTime = time;
      createImageBitmap(this.video, {
        resizeWidth: 320,
        resizeHeight: Math.round((320 * this.video.videoHeight) / this.video.videoWidth),
      })
        .then((bitmap) => {
          if (!this.ready) {
            bitmap.close();
            return;
          }
          this.poseWorker.postMessage({ type: 'frame', bitmap, time }, [bitmap]);
        })
        .catch(() => {
          this.poseBusy = false;
        });
    }
    if (this.poseBusy && time - (this.lastFrameTime || time) > 120) this.poseInterval = 200;
    if (this.running && time - (this.lastSampleFrame || 0) > 5000) {
      this.lastSampleFrame = time;
      this.takeFrame();
    }
    this.animation = requestAnimationFrame(() => this.frameLoop());
  }
  async calibrate(mode) {
    if (!this.poseReady) throw new Error('Wait for the posture model to load.');
    this.mode = mode;
    this.baseline = null;
    this.postureDetector.reset();
    this.calibrationSamples = [];
    this.calibrationFrames = 0;
    this.calibrationFirst = null;
    this.calibrationLast = null;
    this.noiseSamples = [];
    this.calibrating = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (!this.ready) throw new Error('Camera stopped during calibration.');
      if (
        this.calibrationLast - this.calibrationFirst < 4000 ||
        this.calibrationSamples.length / Math.max(1, this.calibrationFrames) < 0.8
      )
        throw new Error(
          'Tracking was interrupted. Keep your head and shoulders visible for the full five seconds and try again.',
        );
      this.baseline = calibrate(this.calibrationSamples);
      const sorted = this.noiseSamples.sort((a, b) => a - b);
      this.noise = Math.min(0.03, sorted[Math.floor(sorted.length / 2)] || 0.008);
    } finally {
      this.calibrating = false;
    }
  }
  connectLive(sessionId) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(
      `${protocol}//${location.host}/api/sessions/${sessionId}/transcription`,
    );
    this.liveReady = false;
    this.callbacks.onLive?.('Connecting to live transcription…');
    this.socket.onmessage = ({ data }) => {
      let item;
      try {
        item = JSON.parse(data);
      } catch {
        return;
      }
      if (item.type === 'ready') {
        this.liveReady = true;
        this.callbacks.onLive?.('Live transcription connected');
      }
      if (item.type === 'error') this.callbacks.onLive?.(item.message);
      if (item.type === 'interim') this.callbacks.onTranscript?.(item.text, false);
      if (item.type === 'final') {
        if (this.seenTurns.has(item.id)) return;
        this.seenTurns.add(item.id);
        this.turns.push(item);
        const liveWords = item.text
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text }));
        for (const filler of detectFillers(liveWords))
          this.events.push({
            id: `${item.id}-filler-${filler.index}`,
            category: 'filler',
            startMs: item.startMs,
            endMs: item.endMs,
            text: filler.text,
          });
        this.callbacks.onTranscript?.(item.text, true);
        this.publishScore();
      }
    };
    this.socket.onerror = () =>
      this.callbacks.onLive?.(
        'Live transcription unavailable. Your local recording is unaffected.',
      );
    this.socket.onclose = () => {
      this.liveReady = false;
      if (this.running)
        this.callbacks.onLive?.(
          'Live transcription stopped. Final speech analysis uses your local audio.',
        );
    };
  }
  start(sessionId, aiConfigured, durationMs = MAX_RECORDING_MS) {
    if (!this.ready || this.running) throw new Error('Microphone is not ready.');
    this.pcm = [];
    this.poseSamples = [];
    this.frames = [];
    this.events = [];
    this.turns = [];
    this.seenTurns.clear();
    this.episodes.reset();
    this.postureDetector.reset();
    this.livePaceWindows = new Set();
    const mime = (
      this.hasVideo
        ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    ).find((type) => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(this.stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 1800000,
    });
    this.videoChunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.videoChunks.push(event.data);
    };
    this.recorder.onerror = () =>
      this.callbacks.onInterrupt?.(
        'Recording was interrupted. Available media has been preserved.',
      );
    this.recorder.onstart = () => {
      this.startedAt = performance.now();
      this.lastSampleFrame = 0;
      this.running = true;
      this.audioWorker.postMessage({ type: 'start', noise: this.noise });
      this.capture.port.postMessage({ type: 'start' });
      this.callbacks.onStarted?.();
      this.publishScore();
      this.autoStop = setTimeout(
        () => this.callbacks.onInterrupt?.('Your practice time is complete.'),
        Math.min(MAX_RECORDING_MS, Math.max(1000, durationMs)),
      );
      if (aiConfigured) this.connectLive(sessionId);
    };
    this.recorder.start(1000);
  }
  takeFrame(event = false) {
    if (!this.running || !this.hasVideo || !this.video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = Math.round((640 * this.video.videoHeight) / this.video.videoWidth);
    canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
    const frame = {
      timeMs: performance.now() - this.startedAt,
      data: canvas.toDataURL('image/jpeg', 0.55),
      event,
    };
    if (frame.data.length <= 180000) this.frames.push(frame);
    if (this.frames.length > 100) this.frames.splice(0, this.frames.length - 100);
  }
  publishScore() {
    if (!this.running) return;
    const elapsed = performance.now() - this.startedAt;
    for (let end = 20000; end <= elapsed; end += 20000) {
      if (this.livePaceWindows.has(end)) continue;
      // Finalized utterances arriving late may revise a window; only commit after 5 s of grace.
      if (elapsed < end + 5000 || !this.liveReady) continue;
      let count = 0;
      for (const turn of this.turns) {
        const overlap = Math.max(
          0,
          Math.min(turn.endMs, end) - Math.max(turn.startMs, end - 20000),
        );
        count += (turn.text.split(/\s+/).length * overlap) / Math.max(1, turn.endMs - turn.startMs);
      }
      if (count < 3) continue;
      this.livePaceWindows.add(end);
      const pace = count * 3;
      if (pace < RUBRIC.pace[0] || pace > RUBRIC.pace[1])
        this.events.push({ id: `pace-${end}`, category: 'pace', startMs: end - 20000, endMs: end });
    }
    if (
      this.events.at(-1)?.category === 'posture' &&
      this.lastEventFrame !== this.events.at(-1).id
    ) {
      this.lastEventFrame = this.events.at(-1).id;
      this.takeFrame(true);
    }
    const words = this.turns.reduce((sum, t) => sum + t.text.split(/\s+/).length, 0);
    this.callbacks.onScore?.({
      ...provisionalScore(this),
      fillers: this.events.filter((e) => e.category === 'filler').length,
      pace: this.turns.length
        ? (words * 60000) / Math.max(1, this.turns.at(-1).endMs - this.turns[0].startMs)
        : null,
      elapsed,
    });
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.finish();
    return this.stopping;
  }
  async finish() {
    clearTimeout(this.autoStop);
    this.running = false;
    this.episodes.close(Math.max(0, performance.now() - this.startedAt));
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'end' }));
    const capture = new Promise((resolve) => {
      this.finishCapture = resolve;
      setTimeout(resolve, 1500);
    });
    this.capture.port.postMessage({ type: 'stop' });
    const video = new Promise((resolve) => {
      if (this.recorder.state === 'inactive') resolve();
      else {
        this.recorder.onstop = resolve;
        this.recorder.stop();
      }
    });
    await Promise.all([capture, video]);
    const audioDone = new Promise((resolve) => {
      this.finishAudio = resolve;
      setTimeout(resolve, 1000);
    });
    this.audioWorker.postMessage({ type: 'finish' });
    await audioDone;
    const wav = wavFromChunks(this.pcm);
    const videoBlob = new Blob(this.videoChunks, { type: this.recorder.mimeType });
    const regular = this.frames.filter((f) => !f.event),
      eventFrames = this.frames.filter((f) => f.event);
    const spaced = Array.from(
      { length: Math.min(10, regular.length) },
      (_, i) =>
        regular[
          Math.round((i * (regular.length - 1)) / Math.max(1, Math.min(10, regular.length) - 1))
        ],
    );
    const frames = [...spaced, ...eventFrames.slice(0, 10)]
      .filter(Boolean)
      .sort((a, b) => a.timeMs - b.timeMs)
      .map(({ timeMs, data }) => ({ timeMs: Math.min(timeMs, wav.durationMs), data }));
    const payload = {
      durationMs: wav.durationMs,
      mode: this.mode,
      poseSamples: this.poseSamples.filter((p) => p.timeMs <= wav.durationMs),
      postureEvents: this.episodes.events
        .map((e) => ({ ...e, endMs: Math.min(e.endMs, wav.durationMs) }))
        .filter((e) => e.startMs <= e.endMs),
      frames,
      acoustics: this.acoustics,
    };
    const waveform = Array(60).fill(0);
    const totalSamples = this.pcm.reduce((sum, chunk) => sum + chunk.length, 0);
    let sampleIndex = 0;
    for (const chunk of this.pcm)
      for (const value of chunk) {
        const bin = Math.min(59, Math.floor((sampleIndex++ * 60) / Math.max(1, totalSamples)));
        waveform[bin] = Math.max(waveform[bin], Math.abs(value));
      }
    const peak = Math.max(0.001, ...waveform);
    const result = {
      hasVideo: this.hasVideo,
      videoBlob,
      audioBlob: wav.blob,
      waveform: waveform.map((v) => v / peak),
      payload,
      live: provisionalScore(this),
      videoUrl: this.hasVideo ? URL.createObjectURL(videoBlob) : null,
      audioUrl: URL.createObjectURL(wav.blob),
    };
    await this.dispose();
    return result;
  }
  async dispose() {
    this.ready = false;
    this.running = false;
    clearTimeout(this.autoStop);
    cancelAnimationFrame(this.animation);
    this.socket?.close();
    if (this.recorder?.state && this.recorder.state !== 'inactive') this.recorder.stop();
    this.poseWorker?.terminate();
    this.audioWorker?.terminate();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.visualizerGain?.disconnect();
    this.capture?.disconnect();
    for (const track of this.stream?.getTracks() || []) track.stop();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.pcm = [];
    this.frames = [];
    this.videoChunks = [];
  }
}
