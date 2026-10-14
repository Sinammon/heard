import { SCRIPT_DRAFT_TIMEOUT_MS } from '../shared/limits.js';

const networkMessage = 'The studio could not be reached. Check your connection and try again.';

async function responseJson(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error('The studio returned an unreadable response. Please try again.');
  }
  if (!response.ok) {
    const error = new Error(typeof value?.error === 'string' ? value.error : 'The request failed.');
    error.status = response.status;
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The studio returned an incomplete response. Please try again.');
  return value;
}

export async function api(
  path,
  {
    timeoutMs = path === '/api/scripts' ? SCRIPT_DRAFT_TIMEOUT_MS + 5000 : 180000,
    ...options
  } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      signal,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) return null;
    return await responseJson(response);
  } catch (error) {
    if (timeout.aborted)
      throw new Error(
        path === '/api/scripts'
          ? 'Drafting took too long. Your current script is unchanged; try again.'
          : 'The studio took too long to respond. Please try again.',
      );
    if (error instanceof TypeError) throw new Error(networkMessage);
    throw error;
  }
}
export const post = (path, value) => api(path, { method: 'POST', body: JSON.stringify(value) });

export async function streamChat(id, message, onText, signal) {
  const timeout = AbortSignal.timeout(180000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let reader;
  try {
    const response = await fetch(`/api/sessions/${id}/chat`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: requestSignal,
    });
    if (!response.ok) await responseJson(response);
    if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson'))
      throw new Error('The coaching reply was unreadable. Please try again.');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '',
      done = false,
      characters = 0;
    const parse = (line) => {
      if (!line.trim()) return;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        throw new Error('The coaching reply was incomplete. Please try again.');
      }
      if (!item || typeof item !== 'object') throw new Error('Invalid coaching reply.');
      if (typeof item.error === 'string') throw new Error(item.error);
      if (typeof item.text === 'string' && !done) {
        characters += item.text.length;
        if (characters > 12000)
          throw new Error('The coaching reply was too long. Try a shorter question.');
        onText(item.text);
      }
      if (item.done === true) done = true;
    };
    while (!done) {
      const result = await reader.read();
      pending += decoder.decode(result.value, { stream: !result.done });
      if (pending.length > 64000)
        throw new Error('The coaching reply was unreadable. Please try again.');
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(parse);
      if (result.done) {
        parse(pending);
        break;
      }
    }
    if (!done || !characters) throw new Error('The coaching reply was interrupted. Try again.');
  } catch (error) {
    if (timeout.aborted) throw new Error('Your coach took too long to reply. Please try again.');
    if (error instanceof TypeError) throw new Error(networkMessage);
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
