import { escape } from './text.js';
import { DRILLS, practiceMode } from '../shared/practice.js';

const select = (id, label, values, current) =>
  `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-option="${id}">${values.map(([value, text]) => `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
const difficulty = (state) =>
  select(
    'difficulty',
    'Difficulty',
    [
      ['easy', 'Gentle start'],
      ['standard', 'A little challenge'],
      ['challenging', 'Stretch yourself'],
    ],
    state.difficulty,
  );
export function modePreparation(state) {
  const mode = state.practiceMode;
  const options =
    mode === 'impromptu'
      ? `${select(
          'category',
          'Topic category',
          [
            ['everyday', 'Everyday life'],
            ['ideas', 'Ideas & opinions'],
            ['work', 'Work & collaboration'],
            ['storytelling', 'Storytelling'],
          ],
          state.category,
        )}${difficulty(state)}${select(
          'preparation',
          'Time to think',
          [
            [15, '15 seconds'],
            [30, '30 seconds'],
            [60, '60 seconds'],
          ],
          state.preparation,
        )}${select(
          'speakingMinutes',
          'Time to speak',
          [
            [1, '1 minute'],
            [2, '2 minutes'],
            [3, '3 minutes'],
          ],
          state.speakingMinutes,
        )}`
      : mode === 'interview'
        ? `${select(
            'interviewType',
            'Interview type',
            [
              ['job', 'Job interview'],
              ['university', 'University admission'],
              ['general', 'General conversation'],
            ],
            state.interviewType,
          )}${difficulty(state)}`
        : `${select(
            'drill',
            'Your focus',
            Object.entries(DRILLS).map(([key, value]) => [key, value[0]]),
            state.drill,
          )}${select(
            'drillMinutes',
            'Practice length',
            [
              [1, '1 minute'],
              [2, '2 minutes'],
              [3, '3 minutes'],
              [5, '5 minutes'],
              [10, '10 minutes'],
              [15, '15 minutes'],
            ],
            state.drillMinutes,
          )}`;
  return `<section class="mode-preparation"><div><p class="eyebrow">${escape(practiceMode(mode).title)}</p><h2>${mode === 'impromptu' ? 'Think on your feet.' : mode === 'interview' ? 'A conversation worth practicing.' : escape(DRILLS[state.drill][0])}</h2><p>${mode === 'impromptu' ? 'A fresh AI topic, a moment to gather your thoughts, then the floor is yours. No script to hide behind.' : mode === 'interview' ? 'Three questions, one at a time. Your answers shape the follow-ups. Speak for up to three minutes per answer.' : escape(DRILLS[state.drill][1])}</p><p class="local-hint">${mode === 'delivery' ? 'Repeat the same drill to compare your measured pace, fillers and pauses in this tab.' : 'Gemini generates prompts and reviews your recorded answers after you accept processing.'}</p></div><div class="mode-options">${options}<button class="button primary" id="to-setup">Set up my recording →</button></div></section>`;
}
export function activePrompt(state) {
  if (state.practiceMode === 'impromptu' && !state.impromptuTopic) return '';
  if (state.practiceMode === 'impromptu')
    return `<section class="active-prompt"><p class="eyebrow">Your topic</p><h2>${escape(state.impromptuTopic)}</h2><p>Make a point. Give an example. Bring it home.</p></section>`;
  if (state.practiceMode === 'interview')
    return `<section class="active-prompt"><p class="eyebrow">Question ${(state.interview?.index ?? 0) + 1} of 3</p><h2>${escape(state.interview?.question || 'Your interviewer is ready.')}</h2><p>Answer directly, then make it concrete with an example.</p></section>`;
  if (state.practiceMode === 'delivery')
    return `<section class="active-prompt"><p class="eyebrow">Your focus</p><h2>${escape(DRILLS[state.drill][0])}</h2><p>${escape(DRILLS[state.drill][1])}</p></section>`;
  return '';
}
export function interviewReview(state) {
  if (state.practiceMode !== 'interview' || !state.interview) return '';
  const interview = state.interview;
  const summary = interview.summary;
  return `<section class="interview-conversation"><p class="eyebrow">Your interview · ${(interview.index ?? 0) + 1} of 3 questions</p><h2>${summary ? 'Take your next answer further.' : 'One answer at a time.'}</h2>${
    summary
      ? `<p>${escape(summary.summary)}</p>${summary.strengths
          .concat(summary.improvements)
          .slice(0, 6)
          .map(
            (item) =>
              `<article><h3>${escape(item.title)}</h3><p>${escape(item.detail)}</p></article>`,
          )
          .join(
            '',
          )}${summary.limitations.map((text) => `<p class="local-hint">${escape(text)}</p>`).join('')}`
      : ''
  }<ol class="interview-turns">${interview.turns.map((turn, i) => (turn ? `<li><p class="content-label">Question ${i + 1}</p><h3>${escape(turn.question)}</h3><details><summary>Your answer & feedback</summary><p>${escape(turn.transcript)}</p><p>${escape(turn.review.summary)}</p></details><button class="text-button" data-retry-answer="${i}" ${state.busy ? 'disabled' : ''}>Retry this answer</button></li>` : '')).join('')}</ol><div class="actions">${!summary && interview.index < 2 ? `<button class="button primary" id="next-question" ${state.busy || !state.report?.stages?.audio ? 'disabled' : ''}>${state.busy ? 'Preparing…' : 'Next question →'}</button>` : ''}<button class="button secondary" id="finish-interview" ${state.busy || !state.report?.stages?.audio ? 'disabled' : ''}>${state.busy ? 'Preparing…' : summary ? 'Refresh interview feedback' : 'Review my interview'}</button></div><p class="local-hint">Follow-ups use your completed transcript. Retry AI analysis first if an answer’s review is unavailable.</p></section>`;
}
export function comparisonView(state) {
  if (state.practiceMode !== 'delivery') return '';
  const attempts = state.attempts.filter((a) => a.drill === state.drill).slice(-2);
  if (attempts.length < 2)
    return '<p class="local-hint">Repeat this drill to compare two completed takes. Comparisons stay in this tab.</p>';
  return `<section class="attempt-comparison"><h2>Your practice, side by side.</h2><p>Compare the same drill. Filler and pause counts are per minute so different take lengths remain readable.</p><table><caption class="sr-only">Latest two delivery attempts</caption><thead><tr><th>Measure</th><th>Previous</th><th>Latest</th></tr></thead><tbody>${[
    ['Pace · WPM', 'wpm'],
    ['Fillers / min', 'fillers'],
    ['Pause cues / min', 'pauses'],
  ]
    .map(
      ([label, key]) =>
        `<tr><th>${label}</th>${attempts.map((a) => `<td>${a[key].toFixed(1)}</td>`).join('')}</tr>`,
    )
    .join('')}</tbody></table></section>`;
}
