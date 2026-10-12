const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9']/g, '');
const endsClause = (text) => /[,;:.!?]["'”’)]*$/.test(text);
export const isFiller = (text) => /^(u+m+|u+h+|u+hm+|e+r+|e+rm+|a+h+|h+m+)$/i.test(normalize(text));
const phrases = [
  ['you', 'know'],
  ['i', 'mean'],
  ['kind', 'of'],
  ['sort', 'of'],
];
const contextual = new Set(['like', 'basically', 'actually', 'literally', 'well', 'so', 'right']);

// These are conservative, reproducible cues, not a semantic judgment by the AI.
// Ambiguous content uses ("I like trees", "you know the answer") are left uncounted.
export function detectFillers(words) {
  const tokens = words.map((w) => normalize(w.text));
  const matches = [];
  for (let i = 0; i < words.length; i++) {
    let length = isFiller(words[i].text) ? 1 : 0;
    const before = i === 0 || endsClause(words[i - 1].text);
    const bracketed = i > 0 && before && endsClause(words[i].text);
    if (!length && contextual.has(tokens[i]) && bracketed) length = 1;
    for (const phrase of phrases) {
      if (length || !phrase.every((token, j) => tokens[i + j] === token)) continue;
      // Don't span a sentence, a missing timing interval, or an internal clause break.
      if (endsClause(words[i].text)) continue;
      if (Number.isFinite(words[i + 1]?.startMs) && words[i + 1].startMs - words[i].endMs > 1000)
        continue;
      const after = endsClause(words[i + phrase.length - 1].text);
      if (before && after) length = phrase.length;
    }
    if (!length) continue;
    const last = words[i + length - 1];
    matches.push({
      index: i,
      text: words
        .slice(i, i + length)
        .map((w) => w.text)
        .join(' '),
      startMs: words[i].startMs,
      endMs: last.endMs,
    });
    i += length - 1;
  }
  return matches;
}

// Word annotations sometimes omit punctuation. Only align punctuation from the
// actual transcript when every lexical token matches; never infer it from a script.
export function withTranscriptPunctuation(words, transcript = '') {
  const tokens = transcript.trim().split(/\s+/).filter(Boolean);
  if (
    tokens.length !== words.length ||
    !tokens.every((t, i) => normalize(t) === normalize(words[i].text))
  )
    return words;
  return words.map((w, i) => ({ ...w, text: tokens[i] }));
}

export function pauseBoundary(text) {
  const token = text.replace(/["'”’)]*$/, '');
  if (token.endsWith(',')) return { kind: 'comma', minMs: 150, maxMs: 500 };
  if (/[.!?]$/.test(token)) {
    if (
      /^(mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e)\.$/i.test(token) ||
      /^([A-Z]\.)+$/.test(token) ||
      /\.{2,}$/.test(token)
    )
      return null;
    return { kind: 'sentence', minMs: 300, maxMs: 900 };
  }
  return null;
}

export function analyzePauses(words) {
  const events = [],
    boundaries = [];
  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1],
      next = words[i];
    const gapMs = next.startMs - previous.endMs;
    if (gapMs < 0) continue; // Overlapping annotations cannot establish a pause.
    const boundary = pauseBoundary(previous.text);
    if (boundary) {
      const factor =
        gapMs < boundary.minMs
          ? 1 - gapMs / boundary.minMs
          : gapMs > boundary.maxMs
            ? Math.min(1, (gapMs - boundary.maxMs) / (2 * boundary.maxMs))
            : 0;
      boundaries.push({ ...boundary, gapMs, factor });
      if (factor > 0)
        events.push({
          id: `pause-${i}`,
          category: 'pause',
          startMs: previous.endMs,
          endMs: next.startMs,
          kind: boundary.kind,
          issue: gapMs < boundary.minMs ? 'too-short' : 'too-long',
          gapMs,
          excessMs: Math.max(0, gapMs - 3000),
        });
    } else if (gapMs > 3000)
      events.push({
        id: `pause-${i}`,
        category: 'pause',
        startMs: previous.endMs,
        endMs: next.startMs,
        kind: 'internal',
        issue: 'too-long',
        gapMs,
        excessMs: gapMs - 3000,
      });
  }
  return { events, boundaries };
}
