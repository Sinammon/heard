import { modePreparation, activePrompt } from './mode-views.js';
import { MAX_PRACTICE_MINUTES, MAX_SCRIPT_CHARS } from '../shared/limits.js';
import { icon } from './icons.js';
import { escape, wordCount, readingTime } from './text.js';
import { PRACTICE_MODES, practiceMode } from '../shared/practice.js';

function modePicker(state) {
  return `<fieldset class="training-modes"><legend>How would you like to practice?</legend><div class="training-options">${PRACTICE_MODES.map((mode) => `<label class="training-option ${state.practiceMode === mode.id ? 'selected' : ''}"><input type="radio" name="practice-mode" value="${mode.id}" ${state.practiceMode === mode.id ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span><strong>${mode.title}</strong><small>${mode.description}</small></span></label>`).join('')}</div>${state.practiceMode === 'memorization' ? `<div class="memorization-duration field"><label for="memorization-minutes">Time to memorize · minutes</label><input type="number" id="memorization-minutes" min="1" max="30" step="1" value="${state.memorizationMinutes}" ${state.busy ? 'disabled' : ''}><p class="local-hint">The test starts automatically when your study time ends. You can also begin early.</p></div>` : ''}</fieldset>`;
}

export function scriptView(state, head) {
  const count = wordCount(state.script);
  const aiReady = state.health?.aiConfigured;
  if (!['free', 'memorization'].includes(state.practiceMode))
    return `${head('01 / Prepare', 'Find your next practice.', 'Five ways to build a clearer voice.')}${modePicker(state)}${modePreparation(state)}`;
  return `${head('01 / Prepare', 'Make it sound like you.', 'Choose your focus. Make a little progress.')}${modePicker(state)}<div class="split prepare-grid"><section class="panel script-panel"><div class="tabs" role="tablist" aria-label="Script source"><button class="tab ${state.scriptTab === 'write' ? 'active' : ''}" role="tab" aria-selected="${state.scriptTab === 'write'}" aria-controls="script-panel" tabindex="${state.scriptTab === 'write' ? 0 : -1}" id="write-tab">${icon('edit')}Write my own</button><button class="tab ${state.scriptTab === 'generate' ? 'active' : ''}" role="tab" aria-selected="${state.scriptTab === 'generate'}" aria-controls="script-panel" tabindex="${state.scriptTab === 'generate' ? 0 : -1}" id="generate-tab">${icon('spark')}Draft with AI</button></div><div id="script-panel" role="tabpanel" aria-labelledby="${state.scriptTab === 'write' ? 'write-tab' : 'generate-tab'}">${
    state.scriptTab === 'generate'
      ? `<form id="generate-form" aria-busy="${state.busy}"><div class="field"><label for="topic">What would you like to talk about?</label><input id="topic" name="topic" value="${escape(state.topic)}" placeholder="e.g. An idea I want to share" maxlength="400" required minlength="3" ${state.busy ? 'disabled' : ''}></div><div class="field-row"><div class="field"><label for="audience">Your audience</label><input id="audience" name="audience" value="${escape(state.audience)}" maxlength="150" required ${state.busy ? 'disabled' : ''}></div><div class="field"><label for="duration">Talk length</label><select id="duration" name="duration" ${state.busy ? 'disabled' : ''}>${Array.from(
          { length: MAX_PRACTICE_MINUTES },
          (_, i) => i + 1,
        )
          .map(
            (n) =>
              `<option value="${n}" ${state.duration === n ? 'selected' : ''}>${n} ${n === 1 ? 'minute' : 'minutes'}</option>`,
          )
          .join(
            '',
          )}</select></div></div><div class="generate-actions"><button class="button secondary" id="generate" ${state.busy || !aiReady ? 'disabled' : ''}>${state.busy ? '<span class="spinner"></span>Drafting your script…' : `${icon('spark')}Generate a draft`}</button><p class="local-hint">Topic and audience are shared with Gemini.<br>Use non-sensitive material.</p></div>${!aiReady ? `<p class="notice">${state.health ? 'AI drafting is unavailable. You can write your own script.' : 'Checking AI availability. You can start writing now.'}</p>` : ''}</form><div class="draft-divider"></div>`
      : ''
  }<div class="field"><label for="script">Your practice script</label><textarea id="script" maxlength="${MAX_SCRIPT_CHARS}" ${state.busy ? 'readonly' : ''} placeholder="Start with your main idea.\n\nAdd an example that brings it to life.\n\nLeave your audience with one thing to remember.">${escape(state.script)}</textarea><div class="field-meta"><span id="word-count">${count} words</span><span id="estimated">${readingTime(state.script)}</span></div></div><p class="draft-status" id="draft-status" role="status">${icon('check')}Draft kept in this tab.</p></div><div class="actions"><button class="text-button" id="back-welcome">Back to home</button><button class="button primary" id="to-setup" aria-describedby="prepare-hint" ${count < 3 || state.busy ? 'disabled' : ''}>Set up my recording ${icon('arrow')}</button></div><p class="local-hint" id="prepare-hint" aria-live="polite">${state.busy ? 'Finish drafting to continue.' : count < 3 ? 'Add at least 3 words to continue. Notes are welcome.' : 'Ready when you are. Your script stays editable.'}</p></section><aside class="writing-guide"><p class="eyebrow">Keep it simple</p><h2>One idea is<br>a good start.</h2><ol class="outline-list"><li><span>01</span><div><h3>The point</h3><p>What should your audience know?</p></div></li><li><span>02</span><div><h3>An example</h3><p>Make the idea concrete.</p></div></li><li><span>03</span><div><h3>The takeaway</h3><p>Leave one thing to remember.</p></div></li></ol><details class="writing-tip"><summary>Before you record ${icon('down')}</summary><p>Read your draft aloud. Shorten any phrase you wouldn’t naturally say. Recording supports desktop Chrome and Edge, up to 15 minutes.</p></details><div class="guide-privacy">${icon('shield')}<p>Full video stays on your device.<br>AI review is included in every practice.</p></div></aside></div>`;
}

export function setupView(state, head, previewMarkup) {
  const aiReady = state.health?.aiConfigured;
  const aiMessage = !state.health
    ? 'Checking AI availability…'
    : !aiReady
      ? 'AI is currently unavailable. You can prepare your script; recording requires an available AI service.'
      : 'Consent is required before enabling devices or recording.';
  const deviceHint = !aiReady
    ? aiMessage
    : !state.consent
      ? 'Accept AI processing above to enable your microphone.'
      : state.busy
        ? 'Please wait for the current setup step to finish.'
        : escape(state.cameraStatus || 'Your browser will ask for microphone access.');
  const startHint = !aiReady
    ? aiMessage
    : !state.consent
      ? 'Accept AI processing, then enable your devices.'
      : !state.camera
        ? 'Enable your microphone to continue.'
        : state.busy
          ? 'Please wait for the current setup step to finish.'
          : state.practiceMode === 'memorization'
            ? 'Your key points will be prepared before the study timer starts.'
            : 'You’re ready. Speak naturally and take your time.';
  return `${head('02 / Practice', 'Your space. Your pace.', state.practiceMode === 'memorization' ? `You’ll study for ${state.memorizationMinutes} ${state.memorizationMinutes === 1 ? 'minute' : 'minutes'}, then speak from key points.` : 'Three quick steps, then the floor is yours.')}
    ${activePrompt(state)}<section class="ai-consent-panel" aria-labelledby="consent-heading">
      <div class="setup-step-heading"><span class="setup-number">${state.consent ? icon('check') : '1'}</span><h2 id="consent-heading">Accept AI processing</h2><span class="required-label">Required</span></div>
      <div class="consent-content"><p class="local-hint" id="ai-availability">${aiMessage}</p>
      <ul class="consent-facts"><li>Gemini receives your script for talking points and recall feedback, plus audio and, only if you enable your camera, up to 20 resized images for review and live transcription. Full video stays on your device.</li><li>Google’s free service may use content for product improvement and human review. Use non-sensitive material. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Read the terms</a>.</li></ul>
      <label class="privacy"><input id="consent" type="checkbox" aria-describedby="ai-availability" ${state.consent ? 'checked' : ''} ${state.busy || !aiReady ? 'disabled' : ''}><span>I agree to the AI processing described above.</span></label></div>
    </section>
    <div class="split setup-grid"><section class="panel camera-panel">
      <div class="setup-step-heading"><span class="setup-number">${state.camera ? icon('check') : '2'}</span><h2>Enable devices</h2><span class="step-status">${state.camera ? 'Ready' : 'Microphone'}</span></div>
      <label class="privacy camera-choice"><input id="camera-enabled" type="checkbox" ${state.cameraEnabled ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span>Include camera · optional<br><small>Add a local video replay and visual delivery review.</small></span></label>${previewMarkup()}<div class="setup-footer"><button class="button secondary" id="enable-camera" aria-describedby="camera-status" ${state.busy || !state.consent || !aiReady ? 'disabled' : ''}>${state.busy && !state.calibrating ? '<span class="spinner"></span>Connecting devices…' : `${icon(state.cameraEnabled ? 'video' : 'mic')}${state.camera ? 'Reconnect devices' : state.cameraEnabled ? 'Enable camera & microphone' : 'Enable microphone'}`}</button><span class="inline-status" id="camera-status" role="status">${deviceHint}</span></div>
      <div id="device-fields" class="field-row ${state.camera ? '' : 'hidden'}"><div class="field" ${!state.cameraEnabled ? 'hidden' : ''}><label for="camera-device">Camera</label><select id="camera-device" aria-label="Camera device"></select></div><div class="field"><label for="audio-device">Microphone</label><select id="audio-device" aria-label="Microphone device"></select></div></div></section>
      <aside class="panel settings-panel" ${!state.cameraEnabled ? 'hidden' : ''}><div class="settings-heading"><h2>Posture tracking</h2><span class="optional-label">Optional</span></div>
      <fieldset class="practice-mode" ${state.busy ? 'disabled' : ''}><legend class="mode-legend">Your position</legend><div class="mode-control"><label class="mode-choice"><input type="radio" name="mode" value="seated" ${state.mode === 'seated' ? 'checked' : ''}>Seated</label><label class="mode-choice"><input type="radio" name="mode" value="standing" ${state.mode === 'standing' ? 'checked' : ''}>Standing</label></div></fieldset>
      <p class="inline-status" id="framing-hint">${state.mode === 'standing' ? 'Keep your head, shoulders, and hips in frame.' : 'Keep your head and shoulders visible. Hips are excluded while seated.'}</p>
      <div class="setting-section"><p class="local-hint">Hold a comfortable upright position for 5 seconds to set your baseline.</p><button class="button secondary full-width calibration-button" id="calibrate" aria-describedby="calibration-status" ${!state.camera || !state.cameraEnabled || state.busy ? 'disabled' : ''}>${state.calibrating ? '<span class="spinner"></span>Setting your baseline…' : `${icon('scan')}${state.calibrated ? 'Recalibrate posture' : 'Calibrate posture'}`}</button>
      <p class="inline-status calibration-status" id="calibration-status" role="status">${state.calibrated ? 'Baseline ready.' : !state.camera ? 'Enable your devices first. You can also practice without calibration.' : 'Keep the camera fixed. Seated tracking checks visible head and shoulder alignment; hips are excluded.'}</p><div class="meter" aria-hidden="true"><span id="mic-meter"></span></div></div>
      <p class="local-hint posture-score-note">Below 80% usable posture tracking, you’ll receive a partial speech score.</p></aside>
      <section class="setup-actions" aria-labelledby="start-heading"><div class="setup-step-heading"><span class="setup-number">3</span><h2 id="start-heading">${state.practiceMode === 'memorization' ? 'Start your memorization test' : 'Start practice'}</h2><span class="step-status">${state.practiceMode === 'impromptu' ? `${state.speakingMinutes} min` : state.practiceMode === 'interview' ? '3 min / answer' : state.practiceMode === 'delivery' ? `${state.drillMinutes} min` : 'Up to 15 min'}</span></div>
      <p class="scoring-note">For an overall score, speak for at least <strong>30 seconds</strong> and <strong>50 timestamped words</strong>. Shorter takes are welcome; their overall score will be unavailable.</p>
      <div class="actions"><button class="text-button" id="back-script" ${state.busy ? 'disabled' : ''}>Back to preparation</button><button class="button primary" id="start-recording" aria-describedby="start-hint" ${!state.camera || !state.consent || !aiReady || state.busy ? 'disabled' : ''}>${icon(state.practiceMode === 'memorization' ? 'clock' : 'mic')}${state.practiceMode === 'interview' && state.interview?.question ? 'Record my answer' : state.practiceMode === 'impromptu' && state.impromptuTopic ? 'Start preparation timer' : practiceMode(state.practiceMode).startLabel}</button></div><p class="local-hint" id="start-hint" role="status">${startHint}</p></section></div>`;
}
