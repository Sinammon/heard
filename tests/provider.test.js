import { describe, it, expect } from 'vitest';
import {
  extractTranscript,
  seconds,
  GeminiProvider,
  publicProviderError,
} from '../server/gemini.js';
describe('Gemini adapter', () => {
  it('parses official word_info annotations and preserves fillers', () => {
    const input = {
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: 'um hello',
              annotations: [
                { type: 'word_info', text: 'um', start_offset: '0.100s', end_offset: '0.400s' },
                { type: 'word_info', text: 'hello', start_offset: '0.500s', end_offset: '0.850s' },
              ],
            },
          ],
        },
      ],
    };
    expect(extractTranscript(input)).toEqual({
      text: 'um hello',
      words: [
        { text: 'um', startMs: 100, endMs: 400 },
        { text: 'hello', startMs: 500, endMs: 850 },
      ],
    });
    expect(seconds('broken')).toBeNaN();
  });
  it('normalizes duration objects and millisecond offsets', () => {
    expect(seconds({ seconds: 1, nanos: 250000000 })).toBe(1250);
    expect(seconds('1250ms')).toBe(1250);
    expect(
      extractTranscript(
        {
          output_text: 'hello world',
          steps: [
            {
              type: 'model_output',
              content: [
                {
                  annotations: [
                    { type: 'word_info', text: 'hello', start_offset: '0ms', end_offset: '400ms' },
                    { type: 'word_info', text: 'bad', start_offset: 'broken', end_offset: '500ms' },
                    {
                      type: 'word_info',
                      text: 'world',
                      start_offset: '500ms',
                      end_offset: '900ms',
                    },
                  ],
                },
              ],
            },
          ],
        },
        1000,
      ).words,
    ).toHaveLength(2);
  });
  it('rejects transcription without word timing instead of manufacturing evidence', () => {
    expect(() => extractTranscript({ output_text: 'hello', steps: [] })).toThrow(/word timestamps/);
  });
  it('fails without a key and never substitutes a paid provider', () => {
    const provider = new GeminiProvider({});
    expect(() => provider.requireKey()).toThrow();
    expect(publicProviderError({ status: 429 })).toMatch(/quota/);
  });
  it('uses verbatim word-timed transcription and disables interaction storage', async () => {
    const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
    let request;
    provider.run = (fn) => fn();
    provider.ai.interactions.create = async (value) => {
      request = value;
      return {
        steps: [
          {
            type: 'model_output',
            content: [
              {
                type: 'text',
                text: 'um',
                annotations: [
                  { type: 'word_info', text: 'um', start_offset: '0s', end_offset: '0.1s' },
                ],
              },
            ],
          },
        ],
      };
    };
    await provider.transcribe({ uri: 'test', mimeType: 'audio/wav' }, undefined, 1000);
    expect(request.store).toBe(false);
    expect(request.generation_config.transcription_config.mode).toEqual({
      type: 'verbatim',
      timestamp_granularities: ['word'],
    });
  });
  it('rejects invalid, reversed, and out-of-recording timestamps', () => {
    for (const [start, end] of [
      ['broken', '1s'],
      ['2s', '1s'],
      ['0s', '3s'],
    ]) {
      const interaction = {
        steps: [
          {
            type: 'model_output',
            content: [
              {
                type: 'text',
                text: 'hello',
                annotations: [
                  { type: 'word_info', text: 'hello', start_offset: start, end_offset: end },
                ],
              },
            ],
          },
        ],
      };
      expect(() => extractTranscript(interaction, 1000)).toThrow(/invalid word timing/);
    }
  });
  it('validates review structure and removes unsupported evidence IDs', async () => {
    const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
    provider.run = (fn) => fn();
    const review = {
      summary: 'A clear opening.',
      strengths: [
        { title: 'Clear', detail: 'An easy-to-follow idea.', evidenceIds: ['known', 'invented'] },
      ],
      improvements: [],
      limitations: [],
    };
    provider.ai.interactions.create = async () => ({
      status: 'completed',
      output_text: JSON.stringify(review),
    });
    const result = await provider.review('audio', { evidence: [{ id: 'known' }] }, []);
    expect(result.strengths[0].evidenceIds).toEqual(['known']);
    provider.ai.interactions.create = async () => ({
      status: 'completed',
      output_text: '{broken}',
    });
    await expect(provider.review('audio', {}, [])).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
    provider.ai.interactions.create = async () => ({
      status: 'completed',
      output_text: JSON.stringify({ ...review, summary: '' }),
    });
    await expect(provider.review('audio', {}, [])).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });
  it('bounds queued requests and releases the queue after cancellation', async () => {
    const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
    const controller = new AbortController();
    controller.abort();
    await expect(provider.run(async () => {}, { signal: controller.signal })).rejects.toThrow();
    expect(provider.pending).toBe(0);
    provider.pending = 16;
    expect(() => provider.run(async () => {})).toThrow(/busy/);
  });
  it('does not mark truncated provider streams as successful coaching', async () => {
    const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
    provider.run = (fn) => fn();
    provider.ai.interactions.create = async () =>
      (async function* () {
        yield { event_type: 'step.delta', delta: { type: 'text', text: 'Try a breath.' } };
      })();
    const consume = async () => {
      for await (const text of provider.chat({ report: {}, messages: [] }, 'Help')) void text;
    };
    await expect(consume()).rejects.toThrow(/interrupted/);
    provider.ai.interactions.create = async () =>
      (async function* () {
        yield { event_type: 'step.delta', delta: { type: 'text', text: 'Try a breath.' } };
        yield { event_type: 'interaction.completed', interaction: { status: 'completed' } };
      })();
    await expect(consume()).resolves.toBeUndefined();
  });
});

it('generates structured topics and grounded interview questions without storing interactions', async () => {
  const provider = new GeminiProvider({ GEMINI_API_KEY: 'test-key' });
  provider.run = (fn) => fn();
  let request;
  provider.ai.interactions.create = async (input) => {
    request = input;
    return {
      output_text: JSON.stringify({ question: 'What did you learn from organizing that garden?' }),
    };
  };
  const input = {
    type: 'job',
    difficulty: 'standard',
    turns: [{ question: 'Tell me about teamwork.', transcript: 'We planted a garden.' }],
    number: 2,
  };
  expect((await provider.practicePrompt('question', input)).question).toContain('garden');
  expect(request.store).toBe(false);
  expect(request.system_instruction).toContain('actual preceding answers');
  expect(JSON.parse(request.input).turns[0].transcript).toBe('We planted a garden.');
  provider.ai.interactions.create = async (input) => {
    request = input;
    return {
      output_text: JSON.stringify({ topic: 'Would you rather learn a craft or a language?' }),
    };
  };
  expect(
    (await provider.practicePrompt('topic', { category: 'everyday', difficulty: 'easy' })).topic,
  ).toContain('craft');
  expect(request.system_instruction).toContain('never a script');
  provider.ai.interactions.create = async () => ({ output_text: 'not JSON' });
  await expect(provider.practicePrompt('topic', {})).rejects.toMatchObject({
    code: 'INVALID_OUTPUT',
  });
});
