import { describe, it, expect } from 'vitest';
import { detectFillers, withTranscriptPunctuation, analyzePauses } from '../shared/speech.js';
const timed = (text) =>
  text.split(/\s+/).map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 300 }));

describe('transcript-backed filler cues', () => {
  it('counts extended hesitation spellings and phrases once per occurrence', () => {
    const result = detectFillers(
      timed('Umm, uhh er ah hmm. You know, practice, I mean, helps. It is, kind of, useful.'),
    );
    expect(result.map((w) => w.text)).toEqual([
      'Umm,',
      'uhh',
      'er',
      'ah',
      'hmm.',
      'You know,',
      'I mean,',
      'kind of,',
    ]);
    expect(result.at(-1).endMs - result.at(-1).startMs).toBe(800);
  });
  it('recognizes bracketed crutches without counting literal and grammatical uses', () => {
    expect(detectFillers(timed('I, like, forgot. This is, basically, useful.'))).toHaveLength(2);
    expect(
      detectFillers(
        timed(
          'I like trees. You know the answer. I mean this seriously. A kind of bird. It actually works. So we left.',
        ),
      ),
    ).toEqual([]);
    expect(detectFillers(timed('You. Know, this.'))).toEqual([]);
  });
  it('only aligns punctuation from a matching transcript, never a different script', () => {
    const words = timed('Hello there Next idea');
    expect(withTranscriptPunctuation(words, 'Hello there, Next idea.')[1].text).toBe('there,');
    expect(withTranscriptPunctuation(words, 'Hello changed, Next idea.')).toEqual(words);
  });
});

describe('punctuation pauses', () => {
  const pair = (text, gapMs) => [
    { text, startMs: 0, endMs: 500 },
    { text: 'next', startMs: 500 + gapMs, endMs: 800 + gapMs },
  ];
  it.each([
    ['idea,', 150],
    ['idea,', 500],
    ['idea.', 300],
    ['idea.', 900],
  ])('accepts the target edge for %s at %d ms', (text, gap) => {
    const result = analyzePauses(pair(text, gap));
    expect(result.events).toEqual([]);
    expect(result.boundaries[0].factor).toBe(0);
  });
  it('flags a rushed boundary, a long boundary, and an internal long gap', () => {
    expect(analyzePauses(pair('idea,', 20)).events[0].issue).toBe('too-short');
    const long = analyzePauses(pair('idea.', 5000));
    expect(long.events).toHaveLength(1);
    expect(long.events[0].excessMs).toBe(2000);
    expect(analyzePauses(pair('idea', 5000)).events[0].kind).toBe('internal');
  });
  it.each(['Dr.', 'A.', 'U.S.', '3.14', 'wait...'])(
    'does not invent a sentence boundary for %s',
    (text) => {
      expect(analyzePauses(pair(text, 10)).boundaries).toEqual([]);
    },
  );
  it('skips overlapping annotations and trailing sentence punctuation', () => {
    expect(analyzePauses(pair('idea.', -50)).boundaries).toEqual([]);
    expect(analyzePauses(pair('idea.', 500).slice(0, 1)).events).toEqual([]);
  });
});
