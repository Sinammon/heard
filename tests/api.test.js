import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, streamChat } from '../src/api.js';

afterEach(() => vi.unstubAllGlobals());
const mockResponse = (body, options = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, options)),
  );

describe('API recovery', () => {
  it('rejects successful responses with malformed JSON', async () => {
    mockResponse('<html>A proxy error</html>');
    await expect(api('/api/scripts')).rejects.toThrow(/unreadable/);
  });
  it('rejects null and primitive responses', async () => {
    mockResponse('null');
    await expect(api('/api/scripts')).rejects.toThrow(/incomplete/);
  });
  it('preserves useful status and error messages', async () => {
    mockResponse('{"error":"Quota exhausted. Retry later."}', { status: 429 });
    await expect(api('/api/scripts')).rejects.toMatchObject({
      status: 429,
      message: 'Quota exhausted. Retry later.',
    });
  });
  it('explains network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(api('/api/health')).rejects.toThrow(/Check your connection/);
  });
  it('turns a script request deadline into a recoverable draft message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      ),
    );
    await expect(api('/api/scripts', { timeoutMs: 10 })).rejects.toThrow(
      /current script is unchanged; try again/i,
    );
  });
  it('accepts a final NDJSON record without a trailing newline', async () => {
    mockResponse('{"text":"Try a breath."}\n{"done":true}', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
    const parts = [];
    await streamChat('session', 'Help', (text) => parts.push(text));
    expect(parts).toEqual(['Try a breath.']);
  });
  it('rejects truncated, malformed, and empty coaching streams', async () => {
    for (const body of ['{"text":"Try"}\n', '{"text":broken}\n', '{"done":true}\n']) {
      mockResponse(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      await expect(streamChat('session', 'Help', () => {})).rejects.toThrow();
    }
  });
  it('propagates an error after a partial coaching reply', async () => {
    mockResponse('{"text":"Try"}\n{"error":"Service interrupted. Retry."}\n', {
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
    await expect(streamChat('session', 'Help', () => {})).rejects.toThrow(/Service interrupted/);
  });
});
