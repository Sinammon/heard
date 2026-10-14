import { detectFillers, withTranscriptPunctuation, analyzePauses } from './speech.js';
export { isFiller } from './speech.js';

export const RUBRIC = Object.freeze({
  version: 'v3',
  caps: { filler: 25, pace: 20, pause: 15, clarity: 10, posture: 20, movement: 10 },
  minWords: 50,
  minDurationMs: 30000,
  minCoverage: 0.8,
  pace: [110, 180],
  idealPace: [125, 165],
  windowMs: 10000,
});
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const AUDIO = ['filler', 'pace', 'pause', 'clarity'];
const POSTURE = ['posture', 'movement'];
const names = {
  filler: 'Filler words',
  pace: 'Pacing',
  pause: 'Pauses',
  clarity: 'Audio clarity evidence',
  posture: 'Posture alignment',
  movement: 'Upper-body movement',
};

function grade(factors, categories) {
  if (!categories.length) return null;
  const weight = categories.reduce((sum, key) => sum + RUBRIC.caps[key], 0);
  const weighted =
    100 * (1 - categories.reduce((sum, key) => sum + RUBRIC.caps[key] * factors[key], 0) / weight);
  // One substantial weakness must not disappear behind otherwise perfect categories.
  const ceiling = 100 - 50 * Math.max(...categories.map((key) => factors[key]));
  return Math.round(clamp(Math.min(weighted, ceiling), 0, 100));
}

const paceLoss = (wpm) =>
  wpm < RUBRIC.idealPace[0]
    ? clamp((RUBRIC.idealPace[0] - wpm) / 55)
    : clamp((wpm - RUBRIC.idealPace[1]) / 65);
const fillerLoss = (count, durationMs, wordCount) =>
  Math.max(
    clamp(((count * 60000) / Math.max(1, durationMs) - 0.5) / 5),
    clamp((count / Math.max(1, wordCount) - 0.005) / 0.04),
  );

export function postureCoverage(samples, startMs, endMs) {
  let validMs = 0,
    deviationMs = 0,
    limitedMs = 0,
    movementMs = 0,
    movementObservedMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const end = Math.min(endMs, samples[i + 1]?.timeMs ?? sample.timeMs + 100, sample.timeMs + 250);
    const span = Math.max(0, end - Math.max(startMs, sample.timeMs));
    if (!sample.valid) continue;
    validMs += span;
    if (sample.deviation) deviationMs += span;
    if (sample.limited) limitedMs += span;
    if (typeof sample.movement === 'boolean') {
      movementObservedMs += span;
      if (sample.movement) movementMs += span;
    }
  }
  return {
    validMs,
    deviationMs,
    limitedMs,
    movementMs,
    movementObservedMs,
    coverage: clamp(validMs / Math.max(1, endMs - startMs)),
    movementCoverage: clamp(movementObservedMs / Math.max(1, endMs - startMs)),
  };
}

function assemble(factors, availableCategories, reasons, metrics, coverage, warnings = []) {
  const supported = reasons.length === 0;
  const audioCategories = AUDIO.filter((key) => availableCategories.includes(key));
  const postureCategories = POSTURE.filter((key) => availableCategories.includes(key));
  const component = (categories, weight) => ({
    score: (weight === 30 ? metrics.poseDurationMs >= RUBRIC.minDurationMs : supported)
      ? grade(factors, categories)
      : null,
    weight,
    availableCategories: categories,
    partial:
      categories.length < (weight === 70 ? AUDIO.length : POSTURE.length) ||
      (weight === 30 && (coverage.upperBodyOnly || 0) > 0.2),
  });
  const components = {
    audio: component(audioCategories, 70),
    posture: component(postureCategories, 30),
  };
  const present = Object.values(components).filter((item) => item.score != null);
  const weight = present.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = weight
    ? present.reduce((sum, item) => sum + item.score * item.weight, 0) / weight
    : null;
  const ceiling = availableCategories.length
    ? 100 - 50 * Math.max(...availableCategories.map((key) => factors[key]))
    : null;
  const score =
    !supported || components.audio.score == null || weightedScore == null
      ? null
      : Math.round(Math.min(weightedScore, ceiling));
  const penalties = Object.fromEntries(
    Object.keys(RUBRIC.caps).map((key) => [
      key,
      availableCategories.includes(key) ? RUBRIC.caps[key] * factors[key] : 0,
    ]),
  );
  const feedback = availableCategories
    .filter(
      (key) =>
        factors[key] > 0.05 &&
        (POSTURE.includes(key) ? components.posture.score != null : supported),
    )
    .sort((a, b) => factors[b] - factors[a])
    .map((category) => ({
      category,
      title: names[category],
      factor: factors[category],
      severity:
        factors[category] >= 0.5 ? 'major' : factors[category] >= 0.2 ? 'moderate' : 'minor',
      deduction: penalties[category],
    }));
  return {
    version: RUBRIC.version,
    score,
    partial: components.audio.partial || components.posture.partial,
    availableCategories,
    warnings,
    reasons,
    penalties,
    factors,
    components,
    combination: { weightedScore, ceiling, weights: { audio: 70, posture: 30 } },
    feedback,
    metrics,
    coverage,
  };
}

function visualFactors(pose) {
  return {
    posture: clamp(pose.deviationMs / Math.max(1, 0.2 * pose.validMs)),
    movement: clamp(pose.movementMs / Math.max(1, 0.15 * pose.movementObservedMs)),
  };
}

export function finalScore({
  words = [],
  transcript = '',
  poseSamples = [],
  durationMs = 0,
  acoustics,
}) {
  let canonical = withTranscriptPunctuation(
    words
      .filter(
        (w) =>
          typeof w.text === 'string' &&
          w.text.trim() &&
          Number.isFinite(w.startMs) &&
          Number.isFinite(w.endMs) &&
          w.endMs > w.startMs &&
          w.startMs >= 0 &&
          w.endMs <= durationMs + 250,
      )
      .sort((a, b) => a.startMs - b.startMs),
    transcript,
  );
  const coherent = [];
  for (const word of canonical) {
    const previous = coherent.at(-1);
    if (
      previous &&
      (word.startMs < previous.endMs - 100 ||
        (word.startMs === previous.startMs && word.endMs === previous.endMs))
    )
      continue;
    coherent.push(word);
  }
  canonical = coherent;
  const startMs = canonical[0]?.startMs ?? 0;
  const endMs = canonical.at(-1)?.endMs ?? 0;
  const deliveryMs = Math.max(0, endMs - startMs);
  const fillers = detectFillers(canonical);
  const { events: pauses, boundaries } = analyzePauses(canonical);
  const windows = [];
  for (let start = startMs; start < endMs; start += RUBRIC.windowMs) {
    const end = Math.min(endMs, start + RUBRIC.windowMs);
    if (end - start < 5000) continue;
    const count = canonical.filter((w) => w.startMs >= start && w.startMs < end).length;
    const wpm = (count * 60000) / (end - start);
    windows.push({
      startMs: start,
      endMs: end,
      wpm,
      factor: paceLoss(wpm),
      outside: wpm < RUBRIC.pace[0] || wpm > RUBRIC.pace[1],
    });
  }
  const wpm = (canonical.length * 60000) / Math.max(1, deliveryMs);
  const meanPace = windows.reduce((sum, w) => sum + w.wpm, 0) / Math.max(1, windows.length);
  const variability =
    Math.sqrt(
      windows.reduce((sum, w) => sum + (w.wpm - meanPace) ** 2, 0) / Math.max(1, windows.length),
    ) / Math.max(1, meanPace);
  const pose = postureCoverage(
    poseSamples,
    canonical.length ? startMs : 0,
    canonical.length ? endMs : durationMs,
  );
  const unclearMarkers = [
    ...transcript.matchAll(/[\[(](?:inaudible|unintelligible|unclear)(?: speech)?[\])]/gi),
  ].length;
  const clipped = acoustics?.clippedFraction;
  const hasClarity = Number.isFinite(clipped) && clipped >= 0 && clipped <= 1;
  const factors = {
    filler: fillerLoss(fillers.length, deliveryMs, canonical.length),
    pace: Math.max(
      paceLoss(wpm),
      windows.reduce((sum, w) => sum + w.factor, 0) / Math.max(1, windows.length),
      clamp((variability - 0.15) / 0.45),
    ),
    pause: Math.max(
      boundaries.length ? boundaries.reduce((sum, b) => sum + b.factor, 0) / boundaries.length : 0,
      clamp(pauses.reduce((sum, p) => sum + p.excessMs, 0) / Math.max(1, 0.08 * deliveryMs)),
    ),
    clarity: Math.max(
      hasClarity ? clamp((clipped - 0.001) / 0.029) : 0,
      clamp((unclearMarkers * 60000) / Math.max(1, deliveryMs) / 4),
    ),
    ...visualFactors(pose),
  };
  const availableCategories = [
    'filler',
    'pace',
    'pause',
    ...(hasClarity || unclearMarkers ? ['clarity'] : []),
    ...(pose.coverage >= RUBRIC.minCoverage ? ['posture'] : []),
    ...(pose.movementCoverage >= RUBRIC.minCoverage ? ['movement'] : []),
  ];
  const transcriptCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  const speechCoverage = Math.min(
    canonical.length / Math.max(1, words.length),
    transcriptCount
      ? Math.min(canonical.length, transcriptCount) / Math.max(1, canonical.length, transcriptCount)
      : 1,
  );
  const reasons = [];
  if (deliveryMs < RUBRIC.minDurationMs) reasons.push('Speak for at least 30 seconds.');
  if (canonical.length < RUBRIC.minWords) reasons.push('At least 50 timestamped words are needed.');
  if (!words.length || speechCoverage < RUBRIC.minCoverage)
    reasons.push('Speech timing covered less than 80% of the transcript.');
  const warnings = [];
  if (pose.coverage < RUBRIC.minCoverage)
    warnings.push(
      `Posture tracking covered ${Math.round(pose.coverage * 100)}% of your delivery. Posture is excluded; this is a partial speech score, not a combined performance score.`,
    );
  if (pose.movementCoverage < RUBRIC.minCoverage)
    warnings.push('Upper-body movement evidence is insufficient; movement is excluded.');
  if (!hasClarity && !unclearMarkers)
    warnings.push('Audio clarity evidence is unavailable; clarity is excluded.');
  if (pose.limitedMs > 0)
    warnings.push(
      'Part of the posture review uses upper-body alignment only; hips were not continuously visible.',
    );
  return {
    ...assemble(
      factors,
      availableCategories,
      reasons,
      {
        wordCount: canonical.length,
        deliveryMs,
        poseDurationMs: canonical.length ? deliveryMs : durationMs,
        wpm,
        fillers: fillers.length,
        fillerRate: (fillers.length * 60000) / Math.max(1, deliveryMs),
        pauses: pauses.length,
        longPauses: pauses.filter((p) => p.gapMs > 3000).length,
        punctuationPauses: boundaries.length,
        naturalPunctuationPauses: boundaries.filter((b) => b.factor === 0).length,
        postureDeviationPercent: pose.validMs ? (100 * pose.deviationMs) / pose.validMs : null,
        movementPercent: pose.movementObservedMs
          ? (100 * pose.movementMs) / pose.movementObservedMs
          : null,
        clippedFraction: hasClarity ? clipped : null,
        unclearMarkers,
      },
      {
        speech: clamp(speechCoverage),
        posture: pose.coverage,
        movement: pose.movementCoverage,
        upperBodyOnly: pose.limitedMs / Math.max(1, pose.validMs),
      },
      warnings,
    ),
    events: [
      ...fillers.map((w, i) => ({
        id: `filler-${i}`,
        category: 'filler',
        startMs: w.startMs,
        endMs: w.endMs,
        text: w.text,
      })),
      ...pauses,
      ...windows
        .filter((w) => w.factor > 0.2)
        .map((w, i) => ({
          id: `pace-${i}`,
          category: 'pace',
          startMs: w.startMs,
          endMs: w.endMs,
          wpm: w.wpm,
        })),
      ...movementEvents(poseSamples, startMs, endMs),
    ],
    windows,
  };
}

export function liveScore(events, { durationMs = 60000, wordCount = 120 } = {}) {
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const factor = (category) =>
    clamp(
      unique
        .filter((e) => e.category === category)
        .reduce((sum, e) => sum + Math.max(0, (e.endMs ?? 0) - (e.startMs ?? 0)), 0) /
        Math.max(1, durationMs * (category === 'posture' ? 0.2 : 0.08)),
    );
  const factors = {
    filler: fillerLoss(unique.filter((e) => e.category === 'filler').length, durationMs, wordCount),
    pace: factor('pace'),
    pause: factor('pause'),
    posture: factor('posture'),
    clarity: 0,
    movement: 0,
  };
  const deductions = Object.fromEntries(
    Object.entries(RUBRIC.caps).map(([key, weight]) => [key, weight * factors[key]]),
  );
  return { score: grade(factors, ['filler', 'pace', 'pause', 'posture']), deductions };
}

export function provisionalScore({ events = [], turns = [], poseSamples = [], liveReady }) {
  const count = turns.reduce(
    (sum, turn) => sum + turn.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  const startMs = turns[0]?.startMs ?? 0;
  const endMs = turns.at(-1)?.endMs ?? 0;
  const durationMs = Math.max(1, endMs - startMs);
  const pose = postureCoverage(poseSamples, startMs, endMs);
  const { deductions } = liveScore(events, { durationMs, wordCount: count });
  const factors = Object.fromEntries(
    Object.entries(deductions).map(([key, value]) => [key, value / RUBRIC.caps[key]]),
  );
  factors.pace = Math.max(factors.pace, paceLoss((count * 60000) / durationMs));
  Object.assign(factors, visualFactors(pose));
  const categories = [
    'filler',
    'pace',
    'pause',
    ...(pose.coverage >= RUBRIC.minCoverage ? ['posture'] : []),
    ...(pose.movementCoverage >= RUBRIC.minCoverage ? ['movement'] : []),
  ];
  const result = assemble(
    factors,
    categories,
    liveReady && count >= RUBRIC.minWords && durationMs >= RUBRIC.minDurationMs
      ? []
      : ['Collecting finalized speech evidence.'],
    { poseDurationMs: durationMs },
    { posture: pose.coverage },
  );
  return { ...result, deductions: result.penalties };
}

function movementEvents(samples, startMs, endMs) {
  const events = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample.valid || !sample.movement || sample.timeMs < startMs || sample.timeMs >= endMs)
      continue;
    const end = Math.min(endMs, samples[i + 1]?.timeMs ?? sample.timeMs + 100, sample.timeMs + 250);
    const previous = events.at(-1);
    if (previous?.endMs === sample.timeMs) previous.endMs = end;
    else
      events.push({
        id: `movement-${i}`,
        category: 'movement',
        startMs: sample.timeMs,
        endMs: end,
      });
  }
  return events;
}
