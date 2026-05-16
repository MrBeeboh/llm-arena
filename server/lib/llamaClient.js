import { getConfig } from '../config.js';
import { getStatus } from './processManager.js';

/**
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number, abortSignal?: AbortSignal }=} options
 */
export async function* streamCompletion(prompt, options = {}) {
  if (getStatus() !== 'ready') {
    throw new Error('llama-server not ready');
  }
  const config = getConfig();
  const body = {
    prompt,
    model: options.model ?? 'local',
    stream: true,
    n_predict: options.maxTokens ?? 1024,
    temperature: options.temperature ?? 0.7,
    cache_prompt: true
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 300_000);
  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${config.llamaPort}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`completion failed: ${res.status} ${t}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no response body');
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(jsonStr);
      } catch {
        continue;
      }
      const content = chunk.content ?? '';
      // tokens_predicted is the authoritative llama.cpp token count when stop=true
      const tokensActual = chunk.tokens_predicted ?? null;
      if (content) yield { content, stop: !!chunk.stop, tokensActual };
      if (chunk.stop) return;
    }
  }
}

/**
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ maxTokens?: number, temperature?: number, abortSignal?: AbortSignal }=} options
 */
export async function chatCompletion(messages, options = {}) {
  if (getStatus() !== 'ready') {
    throw new Error('llama-server not ready');
  }
  const config = getConfig();
  const body = {
    messages,
    model: options.model ?? 'local',
    stream: false,
    temperature: options.temperature ?? 0,
    n_predict: options.maxTokens ?? 2048
  };

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 300_000);
  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${config.llamaPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`chat failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}
