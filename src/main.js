import './style.css';
import { icon } from './icons.js';
import { publicPage, demoView } from './pages.js';
import { api, post, streamChat } from './api.js';
import { PracticeMedia } from './media.js';
import { escape, wordCount, readingTime } from './text.js';
import { loadDraft, saveDraft } from './draft.js';
import { scriptView as prepareView, setupView as sceneView } from './studio-views.js';
import { parseReport } from '../shared/reports.js';
import { flashcardsSchema } from '../shared/flashcards.js';
import { practiceMode, MemorizationClock } from '../shared/practice.js';

const formatTime = (ms) =>
  `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const $ = (id) => document.getElementById(id);
const state = {
  screen: 'script',
  script: '',
  scriptTab: 'write',
  topic: '',
  audience: 'My classmates',
  duration: 2,
  mode: 'seated',
  practiceMode: 'free',
  memorizationMinutes: 2,
  memorizationRemaining: 0,
  testReady: false,
  consent: false,
  sessionId: null,
  media: null,
  recording: null,
  report: null,
  phase: 'audio',
  health: null,
  error: '',
  success: '',
  busy: false,
  calibrated: false,
  calibrating: false,
  camera: false,
  cameraStatus: '',
  transcript: '',
  interim: '',
  chat: [],
  flashcards: [],
  cardScript: '',
  cardsStatus: 'idle',
  cardsError: '',
  readScript: '',
  ...loadDraft(),
};
let generation = 0,
  tick,
  poll,
  chatController,
  cardController;

let currentPage =
  location.hash === '#about' ? 'about' : location.hash === '#studio' ? 'studio' : 'home';
if (currentPage === 'studio') state.screen = 'script';

function render() {
  document.title =
    currentPage === 'about'
      ? 'Our approach — Heard'
      : currentPage === 'home'
        ? 'Heard — A little practice. A clearer voice.'
        : 'Speaking studio — Heard';
  if (!$('studio-content')) {
    $('app').innerHTML = publicPage(currentPage);
    bindPublic();
    revealSections();
  }
  $('home-page').hidden = currentPage !== 'home';
  $('about-page').hidden = currentPage !== 'about';
  $('studio').hidden = currentPage !== 'studio';
  document.querySelectorAll('.site-header a[href^="#"]').forEach((link) => {
    if (link.hash === `#${currentPage}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (currentPage !== 'studio') return;
  const currentStep =
    state.screen === 'script'
      ? 0
      : ['setup', 'memorizing', 'recording'].includes(state.screen)
        ? 1
        : 2;
  $('studio-content').innerHTML =
    `<div class="app-shell"><header class="studio-header"><nav aria-label="Practice progress"><ol class="steps">${['Prepare', 'Practice', 'Review'].map((label, i) => `<li class="step ${i === currentStep ? 'active' : i < currentStep ? 'done' : ''}" ${i === currentStep ? 'aria-current="step"' : ''}><span class="step-number">${i < currentStep ? icon('check') : String(i + 1).padStart(2, '0')}</span><span>${label}</span></li>`).join('')}</ol></nav><span class="connection ${state.health && !state.health.aiConfigured ? 'connection-warning' : ''}">${icon(state.health?.aiConfigured ? 'spark' : 'shield')} ${state.health ? (state.health.aiConfigured ? 'AI review included' : 'AI unavailable · practice paused') : 'Checking AI availability…'}</span></header><div class="shell-main"><div class="workspace" id="workspace" tabindex="-1" aria-busy="${state.busy}">${state.error ? `<div class="error-banner" role="alert">${escape(state.error)}</div>` : ''}${state.success ? `<div class="success-banner" role="status">${escape(state.success)}</div>` : ''}${{ script: scriptView, setup: setupView, memorizing: memorizationView, recording: recordingView, processing: processingView, review: reviewView }[state.screen]()}</div></div></div>`;
  if (state.screen === 'recording' && state.practiceMode === 'memorization') {
    const aside = document.querySelector('.recording-aside');
    const measurements = document.createElement('details');
    measurements.className = 'test-measurements';
    const summary = document.createElement('summary');
    summary.textContent = 'Live measurements';
    measurements.append(summary, ...aside.childNodes);
    aside.append($('practice-cards'), measurements);
    const toolbar = document.querySelector('.recording-toolbar');
    toolbar.classList.add('test-toolbar');
    document.querySelector('.recording-grid').before(toolbar);
  }
  bind();
  if (
    state.screen === 'recording' ||
    (['setup', 'memorizing'].includes(state.screen) && state.camera)
  )
    attachPreview();
  document
    .querySelectorAll('[data-question]')
    .forEach(
      (button) => (button.disabled = Boolean(chatController) || !state.report?.stages?.combined),
    );
  if (state.screen === 'review') bindPlayer();
}
function head(label, title, description, pill = '') {
  return `<div class="page-head"><div>${label ? `<p class="eyebrow">${label}</p>` : ''}<h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${pill ? `<span class="pill">${icon('clock')}${pill}</span>` : ''}</div>`;
}
function scriptView() {
  return prepareView(state, head);
}
function previewMarkup(recording = false) {
  return `<div class="video-box preview"><video id="preview" autoplay muted playsinline aria-label="Mirrored camera preview"></video><canvas id="pose-overlay" aria-hidden="true"></canvas>${!state.camera ? `<div class="video-placeholder">${icon('video')}<p>Your camera preview will appear here</p></div>` : ''}<span class="preview-tag">${recording ? 'PRACTICE IN PROGRESS' : 'CAMERA PREVIEW'}</span><div class="preview-bottom"><span class="tracking-label" id="tracking">${state.calibrated ? 'Calibrated to your baseline' : 'Calibrate your neutral posture'}</span><div class="level-bars" id="level-bars" aria-label="Microphone activity">${Array.from({ length: 12 }, () => '<span></span>').join('')}</div></div></div>`;
}
function setupView() {
  return sceneView(state, head, previewMarkup) + `<div id="practice-cards">${cardsMarkup()}</div>`;
}
function memorizationView() {
  return `${head('02 / Memorization test', 'Make the ideas stick.', 'Study your script. When the timer reaches zero, your speaking test starts automatically.')}<section class="memorization-layout"><aside class="study-clock"><p class="content-label">Time to memorize</p><strong id="memorization-timer" role="timer" aria-label="Memorization time remaining">${formatTime(state.memorizationRemaining)}</strong><p id="memorization-status" role="status">Your script will be hidden during the test. Only key points remain.</p><button class="button primary" id="begin-test">I’m ready · begin test ${icon('arrow')}</button><button class="text-button" id="cancel-memorization">Cancel memorization</button></aside><article class="study-script"><p class="eyebrow">Your script</p><p>${escape(state.script)}</p></article></section>`;
}
const studyClock = new MemorizationClock({
  onTick: (remaining) => {
    state.memorizationRemaining = remaining;
    if ($('memorization-timer'))
      $('memorization-timer').textContent = formatTime(Math.ceil(remaining / 1000) * 1000);
  },
  onExpire: () => void beginTest(),
});
async function startMemorization() {
  if (state.busy || !state.camera || !state.consent || !state.health?.aiConfigured) return;
  state.readScript = state.script;
  await generateCards();
  if (
    !state.flashcards.length ||
    state.cardScript !== state.script ||
    !state.camera ||
    currentPage !== 'studio' ||
    state.screen !== 'setup'
  )
    return;
  state.memorizationRemaining = state.memorizationMinutes * 60000;
  navigate('memorizing');
  studyClock.start(state.memorizationMinutes);
}
async function beginTest() {
  if (state.screen !== 'memorizing' || state.busy) return;
  studyClock.cancel();
  state.testReady = true;
  await startRecording();
  state.testReady = false;
}
function cancelMemorization() {
  studyClock.cancel();
  navigate('setup');
}

function recordingView() {
  return `${head('02 / Practice', 'All yours.', 'Focus on your message. Live measurements are provisional.')}<div class="recording-grid"><section class="recording-main">${previewMarkup(true)}<div class="recording-toolbar"><span class="timer"><i class="recording-dot" aria-hidden="true"></i><span id="timer">00:00</span><small>/ 05:00</small></span><button class="button stop" id="stop-recording">${icon('stop')}Finish practice</button></div>${state.practiceMode === 'memorization' ? `<div id="practice-cards">${cardsMarkup()}</div><p class="test-note">Memorization test · full script hidden. Explain the ideas in your own words.</p>` : `<div id="practice-cards">${cardsMarkup()}</div><details class="script-follow" id="recording-script" ${state.flashcards.length && state.cardScript === state.script ? '' : 'open'}><summary>${state.flashcards.length && state.cardScript === state.script ? 'Show full script' : 'First take · read your script'}</summary><p>${escape(state.script)}</p><p class="local-hint">Finish this take to receive AI talking-point cards for your next practice.</p></details>`}${state.practiceMode !== 'memorization' ? `<section class="panel" style="margin-top:20px;padding:22px"><h3>Live transcript</h3><div class="transcript" id="transcript" aria-live="off">${state.sessionId ? 'Your words will appear as the transcript is finalized.' : 'Live transcription is unavailable. Final AI review uses your recorded audio.'}</div></section>` : ''}</section><aside class="recording-aside"><div class="score-panel"><p class="content-label">Live practice score</p><div class="score-value"><strong id="live-score">—</strong><span id="score-state">Collecting evidence</span></div><div class="score-meter" aria-hidden="true"><span id="score-progress" style="transform:scaleX(0)"></span></div><p id="score-explanation">A score appears when speech and posture provide enough usable evidence.</p></div><div class="live-stats"><div class="stat-row"><span>Filler words</span><strong id="filler-count">—</strong></div><div class="stat-row"><span>Pace · words/min</span><strong id="pace-value">—</strong></div><div class="stat-row"><span>Posture</span><strong id="posture-value">${state.calibrated ? 'Tracking' : 'Unavailable'}</strong></div><div class="stat-row"><span>Voice activity</span><strong id="voice-value">Listening</strong></div></div><p class="inline-status" id="live-status" role="status" style="margin-top:16px">${state.sessionId ? 'Preparing live transcription…' : 'Final AI analysis is included in this practice.'}</p></aside></div>`;
}
function cardsMarkup() {
  if (state.cardsStatus === 'loading')
    return `<section class="flashcards-section" aria-live="polite"><p class="content-label">Practice from ideas</p><p><span class="spinner"></span> Finding your main talking points…</p></section>`;
  if (state.flashcards.length && state.cardScript === state.script)
    return `<section class="flashcards-section" aria-labelledby="cards-heading"><div class="cards-heading"><div><p class="eyebrow">Your next take</p><h2 id="cards-heading">Speak from ideas.</h2><p>Use these ${state.flashcards.length} talking points as cues. Explain each one in your own words.</p></div><span class="pill">AI talking points</span></div><ol class="flashcard-grid">${state.flashcards.map((point, i) => `<li class="flashcard"><span class="content-label">${String(i + 1).padStart(2, '0')}</span><h3>${escape(point.title)}</h3><p>${escape(point.cue)}</p></li>`).join('')}</ol></section>`;
  if (state.cardsStatus === 'failed')
    return `<section class="flashcards-section"><h2>Talking points unavailable</h2><p role="status">${escape(state.cardsError)}</p><button class="button secondary" data-retry-cards ${!state.consent || !state.health?.aiConfigured ? 'disabled' : ''}>Retry talking points</button><p class="local-hint">You can continue using your script.</p></section>`;
  if (state.screen !== 'setup' || state.practiceMode === 'memorization') return '';
  return `<section class="flashcards-section read-through"><p class="eyebrow">From script to conversation</p><h2>Read it once. Then make it yours.</h2><p>Read your script aloud, then confirm below. AI will turn its main ideas into 3 talking points, adding more for longer or complex scripts. Your first recorded take also creates these automatically.</p><details class="script-follow"><summary>Read your script</summary><p>${escape(state.script)}</p></details><button class="button secondary" id="read-once" ${!state.consent || !state.health?.aiConfigured || state.busy ? 'disabled' : ''}>${icon('spark')}I’ve read my script once</button></section>`;
}
function refreshCards() {
  const region = $('practice-cards');
  if (region) region.innerHTML = cardsMarkup();
  if (state.cardsStatus === 'ready' && $('recording-script')) $('recording-script').open = false;
  const start = $('start-recording');
  if (start && state.practiceMode === 'memorization') {
    start.disabled =
      !state.camera ||
      !state.consent ||
      !state.health?.aiConfigured ||
      state.busy ||
      state.cardsStatus === 'loading';
    start.textContent =
      state.cardsStatus === 'loading' ? 'Preparing key points…' : 'Start memorizing';
  }
}
function invalidateCards() {
  cardController?.abort();
  cardController = null;
  Object.assign(state, {
    flashcards: [],
    cardScript: '',
    cardsStatus: 'idle',
    cardsError: '',
    readScript: '',
  });
}
async function generateCards() {
  if (
    !state.consent ||
    !state.health?.aiConfigured ||
    state.readScript !== state.script ||
    state.cardsStatus === 'loading'
  )
    return;
  if (state.cardScript === state.script && state.flashcards.length) return;
  const script = state.script;
  const controller = new AbortController();
  cardController = controller;
  state.cardsStatus = 'loading';
  state.cardsError = '';
  refreshCards();
  try {
    const result = flashcardsSchema.parse(
      await api('/api/flashcards', {
        method: 'POST',
        body: JSON.stringify({ script, cloudConsent: true }),
        signal: controller.signal,
      }),
    );
    if (controller.signal.aborted || script !== state.script) return;
    state.flashcards = result.points;
    state.cardScript = script;
    state.cardsStatus = 'ready';
  } catch (error) {
    if (controller.signal.aborted || script !== state.script) return;
    state.cardsStatus = 'failed';
    state.cardsError =
      error.name === 'ZodError' ? 'The talking points were incomplete. Try again.' : error.message;
  } finally {
    if (cardController === controller) {
      cardController = null;
      refreshCards();
    }
  }
}
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry-cards]')) void generateCards();
  // This region can refresh independently while devices and playback stay attached.
  if (event.target.closest('#read-once')) {
    state.readScript = state.script;
    void generateCards();
  }
});

function processingView() {
  const stages = state.report?.stages || {};
  const stageItem = (key, label) => {
    const status =
      state.report?.stageStatus?.[key] ||
      ((key === 'transcript' ? state.report?.transcript : stages[key]) ? 'complete' : 'waiting');
    const symbol =
      status === 'running'
        ? '<span class="spinner"></span>'
        : icon(status === 'complete' ? 'check' : 'clock');
    return `<li>${symbol}<span>${label}</span><small>${{ waiting: 'Waiting', running: 'In progress', complete: 'Ready', failed: 'Retry needed', skipped: 'Needs earlier stage' }[status]}</small></li>`;
  };
  return `${head('03 / Review', 'A fresh perspective is on its way.', 'Your recording is ready. AI review can take a few minutes.')}<section class="processing"><span class="icon-box">${icon('sound')}</span><h2>Preparing your review</h2><p>Final scoring uses the complete transcript and your tracking evidence.</p><ul class="processing-list">${[
    ['transcript', 'Word-timed audio transcription'],
    ['audio', 'Audio-only review'],
    ...(state.practiceMode === 'memorization'
      ? [['memory', 'Recall of your script’s main ideas']]
      : []),
    ['video', 'Visual delivery review'],
    ['combined', 'Combined coaching report'],
  ]
    .map(([key, label]) => stageItem(key, label))
    .join(
      '',
    )}</ul>${state.report?.error ? `<p class="notice error">${escape(state.report.error)}</p>` : ''}<div class="actions"><button class="button secondary" id="view-playback">Listen while you wait</button><button class="text-button" id="reset">Cancel & clear session</button></div></section>`;
}
function feedbackMarkup(stage) {
  const report = state.report?.stages?.[stage];
  if (!report)
    return `<section class="feedback"><span class="icon-box">${icon(stage === 'audio' ? 'mic' : stage === 'video' ? 'video' : 'chat')}</span><h2 style="margin-top:16px">${state.report?.status === 'processing' ? 'Your review is on its way.' : 'Your recording is ready.'}</h2><p>${escape(state.report?.error || 'AI feedback is unavailable. You can still play your recording and reflect on your delivery.')}</p>${state.report?.status !== 'processing' && state.report?.status !== 'local' ? '<button class="button secondary" id="retry-analysis" style="margin-top:20px">Retry AI analysis</button>' : state.report?.status === 'local' ? '' : '<p class="notice">You can keep listening while the review finishes.</p>'}</section>`;
  return `<section class="feedback"><h2>${stage === 'audio' ? 'Audio feedback' : stage === 'video' ? 'Visual feedback' : 'Your next step'}</h2><p>${escape(report.summary)}</p>${[
    ['strengths', 'What’s working'],
    ['improvements', 'Try this next'],
  ]
    .map(
      ([key, label]) =>
        `<div class="feedback-section"><h3>${label}</h3>${report[key]
          .map(
            (item) =>
              `<article class="feedback-item"><h4>${escape(item.title)}</h4><p>${escape(item.detail)}</p>${item.evidenceIds
                .map((id) => {
                  const e = state.report.evidence.find((e) => e.id === id);
                  return e
                    ? `<button class="evidence-link" data-seek="${e.startMs}">At ${formatTime(e.startMs)}</button>`
                    : '';
                })
                .join('')}</article>`,
          )
          .join('')}</div>`,
    )
    .join(
      '',
    )}${report.limitations.length ? `<div class="limitations"><strong>Keep in mind</strong>${report.limitations.map((text) => `<p>${escape(text)}</p>`).join('')}</div>` : ''}</section>`;
}
function rubricMarkup() {
  const score = state.report?.score;
  return `<details class="rubric"><summary>How scoring works</summary><p>This is a transparent practice rubric, not a confidence assessment. The final score normalizes your complete delivery and can differ from the live score.</p><ul><li>Fillers: up to 25 points; “um” and “uh” only.</li><li>Pace: up to 25 points for 20-second windows outside 110–180 words/min.</li><li>Long pauses: up to 20 points for internal silence exceeding 3 seconds.</li><li>Posture: up to 30 points for sustained deviation from your calibrated baseline.</li></ul>${score ? `<p>Final deductions: fillers ${score.penalties.filler.toFixed(1)}, pace ${score.penalties.pace.toFixed(1)}, pauses ${score.penalties.pause.toFixed(1)}, posture ${score.penalties.posture.toFixed(1)}. Posture coverage: ${Math.round(score.coverage.posture * 100)}%.</p>${score.reasons.length ? `<p>${escape(score.reasons.join(' '))}</p>` : ''}` : '<p>An overall score needs 30 seconds, 50 timestamped words, and enough usable tracking data.</p>'}</details>`;
}
function chatMarkup() {
  return `<section class="chat"><div class="chat-head"><span class="icon-box">${icon('chat')}</span><div><h3>Your speaking coach</h3><p>A conversation grounded in this practice run.</p></div></div><div class="chat-messages" id="chat-messages" role="log" aria-label="Coaching conversation">${state.chat.length ? state.chat.map((m) => `<div class="chat-message ${m.role}" >${escape(m.text)}</div>`).join('') : '<div class="chat-message">Choose one habit to practice next. Ask about an observation, or request a short exercise.</div>'}</div><div class="chat-suggestions"><button data-question="What is the single most useful thing to practice next?">What should I practice next?</button><button data-question="Give me a two-minute exercise for my biggest improvement area.">Give me a short exercise</button></div><form class="chat-form" id="chat-form"><label class="sr-only" for="chat-input">Ask your speaking coach</label><input id="chat-input" maxlength="2000" placeholder="Ask about your delivery…" required ${!state.report?.stages?.combined ? 'disabled' : ''}><button class="button primary" id="chat-send" ${!state.report?.stages?.combined ? 'disabled' : ''}>Send</button></form></section>`;
}
function reviewView() {
  const stage = state.phase,
    score = state.report?.score,
    recording = state.recording;
  const metrics = score?.metrics;
  const visual = state.report?.visualMetrics;
  const title = {
    audio: 'Listen to your words.',
    video: 'Watch your delivery.',
    combined: 'Find your next step.',
  }[stage];
  const desc = {
    audio: 'Audio only. Focus on your pace and pauses.',
    video: 'Sound off. Focus on posture and movement.',
    combined: 'Your full recording, feedback, and speaking coach.',
  }[stage];
  const events = (state.report?.evidence || []).filter((e) =>
    stage === 'audio'
      ? ['filler', 'pause'].includes(e.category)
      : stage === 'video'
        ? e.category === 'posture'
        : e.category !== 'frame',
  );
  return `${head('03 / Review', title, desc, formatTime(recording.payload.durationMs))}${memoryFeedbackMarkup()}<nav class="stage-nav" aria-label="Review stages">${[
    ['audio', 'mic', 'Listen'],
    ['video', 'video', 'Watch'],
    ['combined', 'chat', 'Reflect'],
  ]
    .map(
      ([key, ico, label], i) =>
        `<button class="stage-tab ${stage === key ? 'active' : ''}" data-phase="${key}" aria-current="${stage === key ? 'step' : 'false'}">${icon(ico)}${i + 1}. ${label}</button>`,
    )
    .join(
      '',
    )}</nav>${stage === 'combined' ? `<div class="final-score"><div><strong>${score?.score ?? '—'}</strong>${score?.score !== null && score?.score !== undefined ? '<small> / 100</small>' : ''}</div><div><h3>${score?.score !== null && score?.score !== undefined ? 'Your final practice score' : 'Overall score unavailable'}</h3><p>${score?.score !== null && score?.score !== undefined ? `Live score: ${recording.live.score ?? 'unavailable'}. Final analysis checks word timing and normalizes delivery length.` : escape(score?.reasons?.join(' ') || 'A completed, sufficiently supported analysis is needed.')}</p></div></div>` : ''}<div class="review-grid"><section>${stage === 'audio' ? `<div class="audio-stage"><p class="content-label">Your recording · audio only</p><div class="waveform" aria-hidden="true">${recording.waveform.map((level) => `<span style="--h:${4 + level * 60}px"></span>`).join('')}</div><audio id="review-player" controls src="${recording.audioUrl}" aria-label="Audio-only practice playback"></audio></div>` : `<div class="video-box"><video id="review-player" controls playsinline ${stage === 'video' ? 'muted' : ''} src="${recording.videoUrl}" aria-label="${stage === 'video' ? 'Muted visual' : 'Combined audio-video'} practice playback"></video></div>`}<p class="media-caption">${stage === 'video' ? 'Sound stays off in this stage. Playback is unmirrored, as your audience would see you.' : stage === 'audio' ? 'Audio-only playback from this browser.' : 'Full video is played from your browser; it has not been uploaded.'}</p><div class="metrics-grid">${stage === 'video' ? metric('Tracked delivery', visual ? `${Math.round(visual.coverage * 100)}%` : '—', 'Usable pose coverage') + metric('Alignment shift', visual ? `${Math.round(visual.deviationPercent)}%` : '—', 'Of tracked time') + metric('Practice mode', recording.payload.mode === 'seated' ? 'Seated' : 'Standing', 'Your selected setup') : metric('Delivery pace', metrics ? `${Math.round(metrics.wpm)}` : '—', 'Words per minute') + metric('Filler words', metrics ? metrics.fillers : '—', '“Um” and “uh”') + metric('Long pauses', metrics ? metrics.pauses : '—', 'Internal gaps over 3 s')}</div>${
    events.length
      ? `<section class="timeline"><h3>Moments to revisit</h3><div class="timeline-items">${events
          .slice(0, 30)
          .map(
            (e) =>
              `<button data-seek="${e.startMs}">${formatTime(e.startMs)} · ${escape({ filler: 'Filler', pause: 'Pause', posture: 'Alignment shift' }[e.category] || e.category)}</button>`,
          )
          .join('')}</div></section>`
      : ''
  }${stage === 'combined' ? rubricMarkup() + chatMarkup() : `<details class="rubric"><summary>${stage === 'audio' ? 'Read the complete transcript' : 'How posture feedback is measured'}</summary><p>${stage === 'audio' ? escape(state.report?.transcript || 'The transcript will appear after Gemini finishes audio processing.') : 'Measurements compare visible head, shoulder, and torso alignment with your neutral baseline. Low-visibility frames are excluded; this does not measure your internal confidence.'}</p></details>`}${state.report?.cleanupWarning ? `<p class="notice error">${escape(state.report.cleanupWarning)}</p>` : ''}<div class="review-actions"><button class="button secondary" id="reset">${icon('reset')}New practice</button>${stage !== 'combined' ? `<button class="button primary" data-phase="${stage === 'audio' ? 'video' : 'combined'}">${stage === 'audio' ? 'Watch my delivery' : 'Bring it together'}</button>` : ''}</div></section>${feedbackMarkup(stage)}</div><div id="practice-cards">${cardsMarkup()}</div><p class="footer-note">${icon('shield')}Your local recording is cleared when you reset or close this page. Google’s data-use terms apply to cloud processing.</p>`;
}
function memoryFeedbackMarkup() {
  if (state.practiceMode !== 'memorization') return '';
  const memory = state.report?.stages?.memory;
  return `<section class="memory-review" aria-labelledby="memory-heading"><p class="eyebrow">Memorization test</p><h2 id="memory-heading">What stayed with you?</h2>${
    memory
      ? `<p>${escape(memory.summary)}</p><div class="memory-observations">${[
          ['strengths', 'Remembered well'],
          ['improvements', 'For your next test'],
        ]
          .map(
            ([key, label]) =>
              `<div><h3>${label}</h3>${memory[key].map((item) => `<article><h4>${escape(item.title)}</h4><p>${escape(item.detail)}</p></article>`).join('')}</div>`,
          )
          .join(
            '',
          )}</div>${memory.limitations.map((text) => `<p class="local-hint">${escape(text)}</p>`).join('')}`
      : `<p role="status">${state.report?.status === 'processing' ? 'Comparing the transcript with your original script…' : 'Recall feedback is unavailable. Retry AI analysis; your playback is still available.'}</p>${state.report?.status !== 'processing' ? '<button class="button secondary" data-retry-memory>Retry AI analysis</button>' : ''}`
  }</section>`;
}

function metric(label, value, note) {
  return `<div class="metric"><span class="label">${label}</span><strong>${value}</strong><small>${note}</small></div>`;
}

function bind() {
  const on = (id, event, fn) => $(id)?.addEventListener(event, fn);
  on('back-welcome', 'click', () => navigate('welcome'));
  on('write-tab', 'click', () => {
    state.scriptTab = 'write';
    render();
    $('write-tab')?.focus();
  });
  on('generate-tab', 'click', () => {
    state.scriptTab = 'generate';
    render();
    $('generate-tab')?.focus();
  });
  on('script', 'input', (event) => {
    invalidateCards();
    state.script = event.target.value;
    const count = wordCount(state.script);
    $('word-count').textContent = `${count} words`;
    $('estimated').textContent = readingTime(state.script);
    $('draft-status').textContent = saveDraft(state)
      ? 'Draft kept in this tab.'
      : 'Draft is in memory. Browser storage is unavailable.';
    state.success = '';
    document.querySelector('.success-banner')?.remove();
    $('to-setup').disabled = count < 3 || state.busy;
  });
  on('topic', 'input', (e) => {
    state.topic = e.target.value;
    saveDraft(state);
  });
  on('audience', 'input', (e) => {
    state.audience = e.target.value;
    saveDraft(state);
  });
  on('duration', 'change', (e) => {
    state.duration = Number(e.target.value);
    saveDraft(state);
  });
  on('generate-form', 'submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    state.success = '';
    render();
    try {
      const result = await post('/api/scripts', {
        topic: state.topic,
        audience: state.audience,
        duration: state.duration,
      });
      if (
        typeof result.script !== 'string' ||
        !result.script.trim() ||
        result.script.length > 15000
      )
        throw new Error('The draft was incomplete. Try generating it again.');
      invalidateCards();
      state.script = result.script;
      saveDraft(state);
      state.success = 'Your draft is ready. Read it out loud and make it your own.';
    } catch (e) {
      state.error = e.message;
    } finally {
      state.busy = false;
      render();
      if (state.success) $('script')?.focus();
    }
  });
  for (const [id, other] of [
    ['write-tab', 'generate-tab'],
    ['generate-tab', 'write-tab'],
  ]) {
    on(id, 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target =
        event.key === 'Home' ? 'write-tab' : event.key === 'End' ? 'generate-tab' : other;
      state.scriptTab = target === 'write-tab' ? 'write' : 'generate';
      render();
      $(target)?.focus();
    });
  }
  on('to-setup', 'click', () => navigate('setup'));
  document.querySelectorAll('input[name="practice-mode"]').forEach((input) =>
    input.addEventListener('change', () => {
      state.practiceMode = input.value;
      saveDraft(state);
      render();
      document.querySelector(`input[name="practice-mode"][value="${state.practiceMode}"]`)?.focus();
    }),
  );
  on('memorization-minutes', 'change', (event) => {
    const minutes = Number(event.target.value);
    state.memorizationMinutes = Math.min(30, Math.max(1, Math.round(minutes) || 2));
    event.target.value = state.memorizationMinutes;
    saveDraft(state);
  });
  on('begin-test', 'click', () => void beginTest());
  on('cancel-memorization', 'click', cancelMemorization);
  on('back-script', 'click', async () => {
    await state.media?.dispose();
    state.camera = false;
    state.calibrated = false;
    navigate('script');
  });
  on('enable-camera', 'click', () => enableCamera());
  on('calibrate', 'click', calibrateCamera);
  on('start-recording', 'click', () =>
    state.practiceMode === 'memorization' ? startMemorization() : startRecording(),
  );
  on('stop-recording', 'click', () => stopRecording());
  on('consent', 'change', (event) => {
    state.consent = event.target.checked;
    if (!state.consent) {
      invalidateCards();
      void state.media?.dispose();
      state.camera = false;
      state.calibrated = false;
    }
    render();
  });
  document.querySelectorAll('input[name="mode"]').forEach((input) =>
    input.addEventListener('change', () => {
      state.mode = input.value;
      state.calibrated = false;
      if (state.media) {
        state.media.postureDetector.reset();
        state.media.mode = state.mode;
        state.media.baseline = null;
      }
      $('tracking').textContent = 'Calibrate your neutral posture';
      $('framing-hint').textContent =
        state.mode === 'standing'
          ? 'Include your head, shoulders, and hips in frame. Stay quiet during calibration.'
          : 'Keep your head and both shoulders visible. Stay quiet during calibration.';
      $('calibration-status').textContent = 'Practice mode changed. Calibrate again.';
    }),
  );
  on('view-playback', 'click', () => {
    state.phase = 'audio';
    navigate('review');
  });
  on('retry-analysis', 'click', () => analyze());
  document.querySelector('[data-retry-memory]')?.addEventListener('click', () => analyze());
  on('reset', 'click', reset);
  document.querySelectorAll('[data-phase]').forEach((button) =>
    button.addEventListener('click', () => {
      state.phase = button.dataset.phase;
      navigate('review');
    }),
  );
  document.querySelectorAll('[data-seek]').forEach((button) =>
    button.addEventListener('click', () => {
      const player = $('review-player');
      if (player) {
        player.currentTime = Number(button.dataset.seek) / 1000;
        player.play().catch(() => {});
      }
    }),
  );
  on('chat-form', 'submit', (event) => {
    event.preventDefault();
    askCoach($('chat-input').value);
  });
  document
    .querySelectorAll('[data-question]')
    .forEach((button) => button.addEventListener('click', () => askCoach(button.dataset.question)));
}
function navigate(screen) {
  if (screen === 'welcome') return void goPage('home');
  state.error = '';
  state.success = '';
  state.screen = screen;
  render();
  const heading = document.querySelector('#workspace h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
function attachPreview() {
  const video = $('preview');
  if (!video || !state.media?.stream) return;
  state.media.video = video;
  video.srcObject = state.media.stream;
  video.play().catch(() => {});
  if (state.screen === 'setup') void fillDevices();
}
async function fillDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const settings = state.media?.stream
    ?.getTracks()
    .map((t) => ({ kind: t.kind, id: t.getSettings().deviceId }));
  for (const [id, kind, type] of [
    ['camera-device', 'videoinput', 'video'],
    ['audio-device', 'audioinput', 'audio'],
  ]) {
    const select = $(id);
    if (!select) return;
    select.innerHTML = devices
      .filter((d) => d.kind === kind)
      .map(
        (d, i) =>
          `<option value="${escape(d.deviceId)}" ${settings?.find((s) => s.kind === type)?.id === d.deviceId ? 'selected' : ''}>${escape(d.label || `${type} ${i + 1}`)}</option>`,
      )
      .join('');
    select.onchange = () =>
      enableCamera({ videoId: $('camera-device').value, audioId: $('audio-device').value });
  }
}
async function enableCamera(devices = {}) {
  if (state.busy || !state.consent || !state.health?.aiConfigured) return;
  state.busy = true;
  state.error = '';
  state.cameraStatus = 'Requesting device access…';
  render();
  try {
    await state.media?.dispose();
    state.calibrated = false;
    state.media = new PracticeMedia({
      onPoseReady: () => {
        state.cameraStatus = 'Camera ready · posture model loaded';
        if ($('camera-status')) $('camera-status').textContent = state.cameraStatus;
      },
      onLevel: updateLevel,
      onPose: updatePose,
      onAudio: (data) => {
        updateLevel(data.rms);
        if ($('voice-value')) $('voice-value').textContent = data.active ? 'Speaking' : 'Quiet';
      },
      onScore: updateScore,
      onTranscript: (text, final) => {
        if (final) {
          state.transcript += `${text} `;
          state.interim = '';
        } else state.interim = text;
        if ($('transcript'))
          $('transcript').innerHTML =
            `${escape(state.transcript)} <em>${escape(state.interim)}</em>`;
      },
      onLive: (message) => {
        const field = $('live-status') || $('camera-status');
        if (field) field.textContent = message;
      },
      onStarted: () => {
        tick = setInterval(() => {
          if ($('timer'))
            $('timer').textContent = formatTime(performance.now() - state.media.startedAt);
        }, 200);
      },
      onInterrupt: (message) => {
        if (state.screen === 'recording') void stopRecording(message);
        else if (['setup', 'memorizing'].includes(state.screen)) {
          studyClock.cancel();
          state.camera = false;
          state.calibrated = false;
          state.screen = 'setup';
          state.error = message;
          void state.media?.dispose();
          render();
        }
      },
    });
    state.media.mode = state.mode;
    await state.media.prepare($('preview'), devices);
    state.camera = true;
    state.cameraStatus = 'Camera and microphone ready';
  } catch (error) {
    state.camera = false;
    state.error =
      error.name === 'NotAllowedError'
        ? 'Camera or microphone access was denied. Allow access in your browser, then try again.'
        : error.name === 'NotFoundError'
          ? 'No camera or microphone was found. Connect both devices and try again.'
          : error.message;
    await state.media?.dispose();
  } finally {
    state.busy = false;
    render();
  }
}
async function calibrateCamera() {
  if (state.busy) return;
  state.busy = true;
  state.calibrating = true;
  state.error = '';
  render();
  try {
    await state.media.calibrate(state.mode);
    state.calibrated = true;
  } catch (e) {
    state.error = e.message;
  } finally {
    state.busy = false;
    state.calibrating = false;
    render();
  }
}
function updateLevel(rms) {
  const level = Math.min(1, rms * 12);
  if ($('mic-meter')) $('mic-meter').style.transform = `scaleX(${level})`;
  document
    .querySelectorAll('#level-bars span')
    .forEach((bar, i) => bar.classList.toggle('on', i < level * 12));
}
function updatePose(data) {
  if ($('tracking')) $('tracking').textContent = data.hint;
  if ($('posture-value'))
    $('posture-value').textContent = !data.valid
      ? 'Unavailable'
      : data.deviation
        ? 'Check alignment'
        : data.limited
          ? 'Upper body only'
          : 'Aligned';
  const canvas = $('pose-overlay'),
    video = $('preview');
  if (!canvas || !video) return;
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 360;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!data.landmarks) return;
  const points = data.landmarks;
  c.strokeStyle = data.deviation ? '#edcb88' : '#c8f17d';
  c.lineWidth = 2;
  for (const [a, b] of [
    [11, 12],
    [11, 23],
    [12, 24],
    [23, 24],
  ]) {
    if (state.mode === 'seated' && (a > 12 || b > 12) && !state.media?.baseline?.torsoLength)
      continue;
    if ((points[a]?.visibility || 0) < 0.7 || (points[b]?.visibility || 0) < 0.7) continue;
    c.beginPath();
    c.moveTo(points[a].x * canvas.width, points[a].y * canvas.height);
    c.lineTo(points[b].x * canvas.width, points[b].y * canvas.height);
    c.stroke();
  }
  for (const i of state.mode === 'standing' ? [0, 11, 12, 23, 24] : [0, 11, 12]) {
    if ((points[i]?.visibility || 0) < 0.7) continue;
    c.beginPath();
    c.arc(points[i].x * canvas.width, points[i].y * canvas.height, 4, 0, Math.PI * 2);
    c.fillStyle = '#c8f17d';
    c.fill();
  }
}
function updateScore(score) {
  if ($('live-score')) $('live-score').textContent = score.score ?? '—';
  if ($('score-progress'))
    $('score-progress').style.transform = `scaleX(${(score.score ?? 0) / 100})`;
  if ($('score-state'))
    $('score-state').textContent =
      score.score === null ? 'Collecting evidence' : '/ 100 · provisional';
  if ($('score-explanation'))
    $('score-explanation').textContent =
      score.score !== null
        ? 'A provisional running score. Final analysis checks word timing and may change it.'
        : state.sessionId
          ? 'A score needs 50 finalized words, 30 seconds of speech, and 80% usable posture tracking.'
          : 'Live transcription is unavailable. Final AI analysis will use the recorded audio.';
  if ($('filler-count'))
    $('filler-count').textContent = state.media?.liveReady ? score.fillers : '—';
  if ($('pace-value'))
    $('pace-value').textContent =
      state.media?.liveReady && score.elapsed > 5000 ? Math.round(score.pace) : '—';
}
async function startRecording() {
  if (state.busy || !state.camera || !state.consent || !state.health?.aiConfigured) return;
  if (state.practiceMode === 'memorization' && !state.testReady) return;
  state.busy = true;
  state.error = '';
  try {
    if (!state.media?.stream?.active)
      throw new Error(
        'A recording device disconnected. Reconnect devices before starting the test.',
      );
    const session = await post('/api/sessions', {
      cloudConsent: true,
      practice:
        state.practiceMode === 'memorization'
          ? { mode: 'memorization', script: state.script, minutes: state.memorizationMinutes }
          : { mode: 'free' },
    });
    if (typeof session?.id !== 'string')
      throw new Error('The practice session could not be created. Please try again.');
    state.sessionId = session?.id || null;
    state.transcript = '';
    state.interim = '';
    state.busy = false;
    navigate('recording');
    state.media.start(state.sessionId, true);
  } catch (e) {
    if (state.sessionId)
      void api(`/api/sessions/${state.sessionId}`, { method: 'DELETE' }).catch(() => {});
    state.sessionId = null;
    state.screen = 'setup';
    state.busy = false;
    state.error = e.message;
    render();
  }
}
async function stopRecording(message = '') {
  if (state.busy || !state.media?.running) return;
  state.busy = true;
  clearInterval(tick);
  const stop = $('stop-recording');
  if (stop) {
    stop.disabled = true;
    stop.textContent = 'Saving recording…';
  }
  try {
    state.recording = await state.media.stop();
    state.camera = false;
    state.busy = false;
    state.screen = 'processing';
    render();
    if (message) state.cameraStatus = message;
    state.readScript = state.script;
    await analyze();
    void generateCards();
  } catch (e) {
    state.busy = false;
    state.error = e.message;
    render();
  }
}
async function analyze() {
  if (!state.recording) return;
  if (!state.sessionId) {
    state.report = {
      status: 'failed',
      stages: {},
      error:
        'The AI session is unavailable. Your playback is safe in this browser. Start a new practice to reconnect.',
    };
    state.phase = 'audio';
    state.screen = 'review';
    render();
    return;
  }
  clearTimeout(poll);
  const token = ++generation;
  state.report = { ...state.report, status: 'processing', error: null };
  state.screen = 'processing';
  render();
  const data = new FormData();
  data.append('payload', JSON.stringify(state.recording.payload));
  data.append('audio', state.recording.audioBlob, 'practice.wav');
  try {
    await api(`/api/sessions/${state.sessionId}/analyze`, { method: 'POST', body: data });
    await pollReport(token);
  } catch (e) {
    if (token !== generation) return;
    state.report = { ...state.report, status: 'failed', error: e.message };
    state.phase = 'audio';
    state.screen = 'review';
    render();
  }
}
async function pollReport(token) {
  if (token !== generation || !state.sessionId) return;
  try {
    const result = parseReport(await api(`/api/sessions/${state.sessionId}/report`));
    if (token !== generation) return;
    const signature = JSON.stringify([
      result.status,
      Object.keys(result.stages || {}),
      result.error,
      result.cleanupWarning,
      result.stageStatus,
    ]);
    const previous = JSON.stringify([
      state.report?.status,
      Object.keys(state.report?.stages || {}),
      state.report?.error,
      state.report?.cleanupWarning,
      state.report?.stageStatus,
    ]);
    state.report = result;
    if (result.status !== 'processing') {
      if (state.screen === 'processing') {
        state.phase = 'audio';
        state.screen = 'review';
      }
      render();
      return;
    }
    if (signature !== previous && state.screen === 'processing') render();
    if (signature !== previous && state.screen === 'review') {
      const player = $('review-player'),
        position = player?.currentTime,
        playing = player && !player.paused;
      render();
      if ($('review-player')) {
        $('review-player').currentTime = position || 0;
        if (playing)
          $('review-player')
            .play()
            .catch(() => {});
      }
    }
    poll = setTimeout(() => pollReport(token), 2500);
  } catch (e) {
    if (token !== generation) return;
    state.report = { ...state.report, status: 'failed', error: e.message };
    if (state.screen === 'processing') state.screen = 'review';
    render();
  }
}
function bindPlayer() {
  const player = $('review-player');
  if (!player) return;
  if (state.phase === 'video') {
    player.muted = true;
    player.volume = 0;
    player.addEventListener('volumechange', () => {
      if (!player.muted) player.muted = true;
      if (player.volume !== 0) player.volume = 0;
    });
  }
}
async function askCoach(message) {
  if (!message?.trim() || chatController || !state.report?.stages?.combined) return;
  state.chat.push({ role: 'user', text: message.trim() }, { role: 'assistant', text: '' });
  const index = state.chat.length - 1;
  chatController = new AbortController();
  const token = generation;
  render();
  $('chat-send').disabled = true;
  $('chat-input').disabled = true;
  document.querySelectorAll('[data-question]').forEach((button) => (button.disabled = true));
  try {
    await streamChat(
      state.sessionId,
      message,
      (text) => {
        if (token !== generation) return;
        state.chat[index].text += text;
        const messages = $('chat-messages');
        if (messages) {
          messages.lastElementChild.textContent = state.chat[index].text;
          messages.scrollTop = messages.scrollHeight;
        }
      },
      chatController.signal,
    );
  } catch (e) {
    if (token === generation && e.name !== 'AbortError') {
      state.chat.push({ role: 'error', text: e.message });
    }
  } finally {
    chatController = null;
    if (token === generation) {
      render();
      $('chat-input')?.focus();
    }
  }
}
async function reset() {
  generation++;
  studyClock.cancel();
  clearTimeout(poll);
  clearInterval(tick);
  chatController?.abort();
  cardController?.abort();
  if (state.cardsStatus === 'loading') state.cardsStatus = 'idle';
  await state.media?.dispose();
  const id = state.sessionId;
  state.sessionId = null;
  if (id) {
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' });
    } catch {}
  }
  if (state.recording) {
    URL.revokeObjectURL(state.recording.videoUrl);
    URL.revokeObjectURL(state.recording.audioUrl);
  }
  Object.assign(state, {
    screen: 'script',
    recording: null,
    report: null,
    success: '',
    media: null,
    error: '',
    camera: false,
    calibrated: false,
    busy: false,
    chat: [],
    phase: 'audio',
    consent: false,
    transcript: '',
    interim: '',
  });
  navigate('script');
}
let revealObserver;
function revealSections() {
  revealObserver?.disconnect();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window))
    return;
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.08 },
  );
  document.querySelectorAll('#home-page > section, #about-page > section').forEach((section) => {
    // Above-the-fold content is immediately usable, including on backend health refresh.
    if (section.getBoundingClientRect().top < innerHeight) return;
    section.classList.add('reveal');
    revealObserver.observe(section);
  });
}

function bindPublic() {
  $('practice-launcher')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.screen !== 'script' || state.busy) {
      goPage('studio');
      return;
    }
    const topic = $('practice-topic').value.trim();
    if (topic) {
      state.topic = topic;
      state.scriptTab = 'generate';
      saveDraft(state);
    }
    void goPage('studio');
  });
  document.querySelectorAll('[data-topic]').forEach((button) =>
    button.addEventListener('click', () => {
      $('practice-topic').value = button.dataset.topic;
      $('practice-topic').focus();
    }),
  );
  const tabs = [...document.querySelectorAll('[data-demo]')];
  const select = (button) => {
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', String(tab === button));
      tab.tabIndex = tab === button ? 0 : -1;
    }
    $('demo-panel').innerHTML = demoView(button.dataset.demo);
    $('demo-panel').setAttribute('aria-labelledby', button.id);
  };
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => select(button));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next]);
      tabs[next].focus();
    });
  });
}
function scrollBehavior() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
async function goPage(next, updateHistory = true, section = '') {
  if (
    currentPage === 'studio' &&
    next !== 'studio' &&
    (state.busy || ['memorizing', 'recording'].includes(state.screen))
  ) {
    if (location.hash !== '#studio') history.replaceState(null, '', '#studio');
    state.error =
      state.screen === 'memorizing'
        ? 'Cancel memorization before leaving the Studio.'
        : state.screen === 'recording'
          ? 'Finish your practice before leaving the Studio.'
          : 'Wait for the current Studio action to finish.';
    render();
    return;
  }
  if (next === currentPage) {
    if (updateHistory && location.hash !== `#${section || next}`)
      history.pushState(null, '', `#${section || next}`);
    if (!section) window.scrollTo({ top: 0, behavior: scrollBehavior() });
    if (section) $(section)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    return;
  }
  if (currentPage === 'studio' && next !== 'studio' && state.camera) {
    await state.media?.dispose();
    state.camera = false;
    state.calibrated = false;
  }
  currentPage = next;
  if (updateHistory && location.hash !== `#${section || next}`)
    history.pushState(null, '', `#${section || next}`);
  render();
  if (section) $(section)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  else window.scrollTo({ top: 0, behavior: 'instant' });
  const target = next === 'studio' ? $('workspace') : $(next);
  if (target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}
function followHash() {
  const id = location.hash.slice(1) || 'home';
  if (['home', 'about', 'studio', 'how-it-works'].includes(id))
    goPage(id === 'how-it-works' ? 'home' : id, false, id);
}
window.addEventListener('hashchange', followHash);
window.addEventListener('popstate', followHash);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (
    !link ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const id = link.hash.slice(1);
  if (!['home', 'about', 'studio', 'how-it-works'].includes(id)) return;
  event.preventDefault();
  goPage(id === 'how-it-works' ? 'home' : id, true, id);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.screen === 'recording')
    void stopRecording('Practice stopped because this tab became hidden.');
});
window.addEventListener('pagehide', () => {
  state.media?.dispose();
  studyClock.cancel();
  cardController?.abort();
  if (state.sessionId)
    void fetch(`/api/sessions/${state.sessionId}`, { method: 'DELETE', keepalive: true });
  if (state.recording) {
    URL.revokeObjectURL(state.recording.videoUrl);
    URL.revokeObjectURL(state.recording.audioUrl);
  }
});
render();
if (location.hash === '#how-it-works')
  requestAnimationFrame(() => $('how-it-works')?.scrollIntoView());
api('/api/health')
  .then((health) => {
    state.health = health;
    if (['script', 'setup'].includes(state.screen)) render();
  })
  .catch(() => {
    state.error = 'The studio backend is unavailable. Start the app with pnpm dev or pnpm start.';
    render();
  });
