import { escape } from './text.js';

export function scoreExplanation(score) {
  if (score?.score == null)
    return score?.reasons?.join(' ') || 'At least 30 seconds and 50 timestamped words are needed.';
  const combination = score.combination;
  const audio = score.components?.audio.score;
  const posture = score.components?.posture.score;
  const formula =
    audio != null && posture != null
      ? `Audio ${audio} × 70% + posture ${posture} × 30% = ${combination.weightedScore.toFixed(1)}.`
      : 'Only available evidence contributes; missing posture is not a perfect result.';
  const ceiling =
    combination && combination.weightedScore > combination.ceiling + 0.05
      ? ` A substantial category weakness limits the overall score to ${Math.round(combination.ceiling)}.`
      : '';
  return `${formula}${ceiling} ${(score.warnings || []).join(' ')}`.trim();
}

function priorityDetail(category, metrics) {
  switch (category) {
    case 'filler':
      return `${metrics.fillers} fillers${Number.isFinite(metrics.fillerRate) ? ` · ${metrics.fillerRate.toFixed(1)} per minute` : ''}. Replace repeated fillers with a brief deliberate pause.`;
    case 'pace':
      return `${Math.round(metrics.wpm)} WPM overall. Both uneven 10-second sections and sustained fast or slow pacing lower the score. Aim for a natural 125–165 WPM.`;
    case 'pause':
      return `${metrics.pauses} pause issues. Keep punctuation pauses deliberate; repeated gaps beyond 1.5 seconds interrupt the flow.`;
    case 'clarity':
      return `${metrics.unclearMarkers || 0} explicit unclear-transcript markers${Number.isFinite(metrics.clippedFraction) ? ` · ${(metrics.clippedFraction * 100).toFixed(1)}% clipped audio samples` : ''}. Check microphone distance and replay unclear passages. These cues do not fully measure intelligibility.`;
    case 'posture':
      return `${Math.round(metrics.postureDeviationPercent)}% of tracked delivery away from your calibrated alignment. Return to a comfortable baseline; brief natural adjustments are allowed.`;
    case 'movement':
      return `${Math.round(metrics.movementPercent)}% sustained upper-body movement in measured frames. Keep the camera fixed and reduce repeated sway. Normal gestures and isolated head nods are not measured as excessive movement.`;
    default:
      return '';
  }
}

export function reviewScoreMarkup(state, stage) {
  const score = state.report?.score;
  const component =
    stage === 'combined' ? score : score?.components?.[stage === 'video' ? 'posture' : 'audio'];
  const value = component?.score;
  const title =
    stage === 'combined'
      ? value == null
        ? 'Overall score unavailable'
        : score.partial
          ? 'Partial practice score'
          : 'Your final practice score'
      : stage === 'audio'
        ? 'Audio analysis score'
        : 'Posture analysis score';
  const explanation =
    stage === 'combined'
      ? scoreExplanation(score)
      : stage === 'video'
        ? !state.recording.hasVideo
          ? 'Camera was off. Posture and movement are unavailable and cannot contribute to a combined score.'
          : value == null
            ? 'A posture score needs at least 30 seconds and 80% usable calibrated tracking. Images alone do not establish a numeric score.'
            : 'Uses measured alignment and sustained upper-body movement. Keep the camera fixed; movement of the camera can affect these measurements.'
        : value == null
          ? scoreExplanation(score)
          : 'Uses actual filler cues, pacing, pauses, and available audio clarity evidence. Missing categories are excluded.';
  const priorities = (score?.feedback || []).filter(
    (item) =>
      stage === 'combined' ||
      (stage === 'video'
        ? ['posture', 'movement'].includes(item.category)
        : !['posture', 'movement'].includes(item.category)),
  );
  return `<section class="review-score" aria-label="${title}"><div class="final-score"><div><strong>${value ?? '—'}</strong>${value != null ? '<small> / 100</small>' : ''}</div><div><h3>${title}</h3><p>${escape(explanation)}</p></div></div>${value != null ? `<p class="score-band">${value >= 90 ? 'Excellent on the measured criteria.' : value >= 80 ? 'Strong foundation, with clear room to improve.' : value >= 65 ? 'Developing delivery. Focus on the priorities below.' : 'Significant delivery issues need practice.'}${component?.partial ? ' This is a partial evaluation.' : ''}</p>` : ''}${
    priorities.length
      ? `<div class="measured-priorities"><h3>Measured priorities</h3><ul>${priorities
          .slice(0, 4)
          .map(
            (item) =>
              `<li><strong>${escape(item.title)} · ${item.severity === 'major' ? 'major issue' : item.severity === 'moderate' ? 'needs attention' : 'small adjustment'}</strong><p>${escape(priorityDetail(item.category, score.metrics))}</p></li>`,
          )
          .join('')}</ul></div>`
      : ''
  }</section>`;
}

export function rubricMarkup(state) {
  const score = state.report?.score;
  const categories = [
    ['filler', 'Fillers', 25],
    ['pace', 'Pacing', 20],
    ['pause', 'Pauses', 15],
    ['clarity', 'Audio clarity evidence', 10],
    ['posture', 'Posture', 20],
    ['movement', 'Upper-body movement', 10],
  ];
  return `<details class="rubric"><summary>How scoring works</summary><p>Rubric v3 uses measured delivery, not internal confidence. Audio contributes 70% and posture/movement 30%. Each component starts at 100 and loses points for measured weaknesses. A weakness ceiling (100 minus 50 times the largest category loss factor) prevents serious problems from being hidden by strong categories. Scores of 90+ require every measured factor to stay near its best range.</p><ul><li>Fillers: 25 points. Frequency per minute and density per word both matter; more than 0.5 per minute starts deductions.</li><li>Pacing: 20 points. Ten-second windows, overall pace, and variation matter. The strongest range is 125–165 WPM; 110–180 WPM is a wider coaching reference, not a penalty-free zone.</li><li>Pauses: 15 points. Commas target 150–500 ms and sentences 300–900 ms. Repeated or long gaps beyond 1.5 seconds increase deductions. Leading/trailing silence is excluded.</li><li>Audio clarity evidence: 10 points. Deductions use measured clipping and explicit unclear-transcript markers. This does not establish full intelligibility or judge accents.</li><li>Posture: 20 points. Sustained baseline deviation during 20% of tracked delivery exhausts this category.</li><li>Movement: 10 points. Sustained repeated shoulder-centre travel during 15% of observed delivery exhausts this category. Brief adjustments and isolated head nods are not excessive sway. A fixed camera is required.</li></ul><p>At least 30 seconds, 50 timestamped words, and 80% valid speech timing are required for an overall score. Posture and movement each require 80% usable observation coverage. Missing categories are excluded and clearly labeled partial; they never receive assumed perfect marks.</p>${score ? `<ul>${categories.map(([key, label, cap]) => `<li>${label}: ${score.availableCategories?.includes(key) || (!score.availableCategories && ['filler', 'pace', 'pause', 'posture'].includes(key)) ? `${(score.penalties[key] || 0).toFixed(1)} / ${cap} category points deducted` : 'excluded · insufficient evidence'}.</li>`).join('')}</ul><p>${escape(scoreExplanation(score))}</p>` : ''}<p>These transparent coaching thresholds require real-user validation; they are not a certified assessment of public-speaking ability. Pitch variation is descriptive and does not change the score.</p></details>`;
}
