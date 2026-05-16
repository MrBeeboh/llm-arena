import { randomUUID } from 'node:crypto';
import * as processManager from './processManager.js';
import * as llamaClient from './llamaClient.js';
import * as db from './db.js';
import { getConfig } from '../config.js';
import { setVoteSession } from '../routes/vote.js';

/** @typedef {'idle' | 'running'} RunState */

/** @type {Set<(e: Record<string, unknown>) => void>} */
const listeners = new Set();

/** @type {RunState} */
let runState = 'idle';
/** @type {AbortController | null} */
let abortCtl = null;
/** @type {null | 'generate' | 'arena'} */
let activeJobKind = null;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function broadcast(e) {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      console.error('sequencer listener error', err);
    }
  }
}

export function isRunning() {
  return runState === 'running';
}

/** What the single shared sequencer is doing (for UI / error text). */
export function getActiveJobKind() {
  return activeJobKind;
}

export function abortRun() {
  abortCtl?.abort();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

function busyError() {
  if (activeJobKind === 'arena') {
    return new Error(
      'Arena is still running (Ask / Run All). Wait until the status bar shows "Round complete", or click Abort.'
    );
  }
  if (activeJobKind === 'generate') {
    return new Error(
      'Generate questions is still running — you should see ⟳ in the status bar. If it is stuck for several minutes, click Abort or restart the Arena API / llama-server.'
    );
  }
  return new Error('Sequencer is busy. Click Abort or wait, then try again.');
}

function parseJsonFromModel(text) {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) t = fence[1].trim();

  // Walk from first `{` or `[` and find the matching close using a depth counter,
  // so nested objects / trailing prose after closing brace don't confuse us.
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  if (firstObj === -1 && firstArr === -1) throw new Error('no JSON in response');

  const useArr = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj);
  const open = useArr ? '[' : '{';
  const close = useArr ? ']' : '}';
  const start = useArr ? firstArr : firstObj;

  let depth = 0;
  let inStr = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inStr) { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`invalid JSON ${useArr ? 'array' : 'object'}`);
  return JSON.parse(t.slice(start, end + 1));
}

/** @typedef {{ id?: string, name?: string, protocol: 'openai' | 'anthropic', baseUrl: string, apiKey: string, model: string }} CloudProviderConfig */

/**
 * Resolve a cloud provider config from a request body in a way that works for both
 * the new shape (judge.cloudProvider = full object) and the legacy shape
 * (judge.cloudProvider = string id + top-level apiKeys map).
 *
 * @param {any} body
 * @returns {CloudProviderConfig}
 */
export function resolveCloudConfig(body) {
  const judge = body?.roles?.judge || {};
  const cp = judge.cloudProvider;

  if (cp && typeof cp === 'object' && cp.baseUrl && cp.protocol) {
    return {
      id: cp.id,
      name: cp.name,
      protocol: cp.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: String(cp.baseUrl),
      apiKey: String(cp.apiKey || ''),
      model: String(cp.model || judge.cloudModel || '')
    };
  }

  const legacyId = (typeof cp === 'string' && cp) || body?.judgeConfig?.cloudProvider || 'xai';
  const apiKeys = body?.apiKeys || {};
  const legacyBase =
    legacyId === 'openai'
      ? 'https://api.openai.com/v1'
      : legacyId === 'anthropic'
        ? 'https://api.anthropic.com'
        : legacyId === 'xai'
          ? getConfig().judgeBaseUrl
          : 'https://api.openai.com/v1';
  return {
    id: legacyId,
    protocol: legacyId === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: legacyBase,
    apiKey: String(apiKeys[legacyId] || ''),
    model: String(judge.cloudModel || getConfig().judgeModel || '')
  };
}

/**
 * Format `cloud ${status}: …` errors with a hint about likely cause so the UI shows
 * something actionable in the status line instead of just the raw HTTP body.
 */
function cloudHttpError(provider, status, bodyText) {
  const tag = provider.name || provider.id || provider.protocol;
  let hint = '';
  if (status === 401 || status === 403) hint = ' — check API key';
  else if (status === 404) hint = ` — check model id "${provider.model}" or baseUrl`;
  else if (status === 429) hint = ' — rate limited / out of quota';
  else if (status >= 500) hint = ' — upstream provider error, retry';
  const tail = bodyText ? ` :: ${bodyText.slice(0, 600)}` : '';
  return new Error(`${tag} ${status}${hint}${tail}`);
}

/**
 * Single entry point for cloud chat completions, dispatched by `protocol` not provider id.
 *
 * @param {{ provider: CloudProviderConfig, messages: Array<{role:string,content:string}>, temperature: number, maxTokens: number, timeoutMs: number, abortSignal?: AbortSignal }} p
 */
async function cloudChatCompletion(p) {
  const { provider, messages, temperature, maxTokens, timeoutMs, abortSignal } = p;
  if (!provider) throw new Error('cloud provider config missing');
  if (!provider.apiKey) throw new Error(`missing API key for ${provider.name || provider.id || provider.protocol}`);
  if (!provider.baseUrl) throw new Error(`missing base URL for ${provider.name || provider.id || provider.protocol}`);
  if (!provider.model) throw new Error(`missing model id for ${provider.name || provider.id || provider.protocol}`);

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  /** @type {(() => void)[]} */
  const cleanups = [];
  if (abortSignal) {
    if (abortSignal.aborted) {
      clearTimeout(tid);
      throw abortError();
    }
    const onAbort = () => ctrl.abort();
    abortSignal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => abortSignal.removeEventListener('abort', onAbort));
  }

  const baseTrimmed = provider.baseUrl.replace(/\/$/, '');

  try {
    if (provider.protocol === 'anthropic') {
      const url = `${baseTrimmed}/v1/messages`;
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
      const nonSystem = messages.filter((m) => m.role !== 'system');
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: maxTokens,
          temperature,
          system: system || undefined,
          messages: nonSystem.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          }))
        })
      });
      if (!res.ok) throw cloudHttpError(provider, res.status, await res.text().catch(() => ''));
      const data = await res.json();
      return data.content?.map((c) => (c.type === 'text' ? c.text : '')).join('') ?? '';
    }

    /* OpenAI-compatible. baseUrl already includes whatever path prefix the provider needs (…/v1). */
    const url = `${baseTrimmed}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      })
    });
    if (!res.ok) throw cloudHttpError(provider, res.status, await res.text().catch(() => ''));
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(tid);
    for (const f of cleanups) f();
  }
}

export { cloudChatCompletion };

function buildScoringPrompt(question, responsesByRole, blind, judgeFeedback) {
  const roles = /** @type {const} */ (['A', 'B', 'C', 'D']);
  const active = roles.filter((r) => responsesByRole[r]);
  let body = '';
  /** @type {Record<string, string>} */
  const anonToRole = {};
  if (blind) {
    const labels = ['alpha', 'beta', 'gamma', 'delta'];
    const perm = [...active].sort(() => Math.random() - 0.5);
    perm.forEach((role, i) => {
      const lab = labels[i];
      anonToRole[lab] = role;
      body += `Response ${lab}:\n${responsesByRole[role]}\n\n`;
    });
    const header = `You are an impartial judge scoring AI responses to a question.
Evaluate on: accuracy, completeness, reasoning quality, conciseness.

Question: ${question}

`;
    const keys = Object.keys(anonToRole);
    const scoreKeys = keys.map((k) => `"${k}":0`).join(',');
    const tail = judgeFeedback
      ? `\nCorrection hint from user: ${judgeFeedback}\n`
      : '';
    return {
      prompt:
        `${header}${body.trim()}${tail}\nReturn ONLY valid JSON, no text outside the JSON object:\n{"scores":{${scoreKeys}},"reasoning":"one concise paragraph"}\n\nOnly include keys that have responses. Scores are integers 0–10.`.trim(),
      anonToRole
    };
  }
  for (const r of active) {
    body += `Response ${r}:\n${responsesByRole[r]}\n\n`;
  }
  const scoreKeys = active.map((r) => `"${r}":0`).join(',');
  const tail = judgeFeedback ? `\nCorrection hint from user: ${judgeFeedback}\n` : '';
  return {
    prompt: `You are an impartial judge scoring AI responses to a question.
Evaluate on: accuracy, completeness, reasoning quality, conciseness.

Question: ${question}

${body.trim()}${tail}
Return ONLY valid JSON, no text outside the JSON object:
{"scores":{${scoreKeys}},"reasoning":"one concise paragraph"}

Only include roles that have responses. Scores are integers 0–10.`.trim(),
    anonToRole: null
  };
}

function remapBlindScores(scores, anonToRole) {
  if (!anonToRole) return scores;
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(scores)) {
    const role = anonToRole[k];
    if (role) out[role] = v;
  }
  return out;
}

/**
 * @param {object} body
 */
export async function runGenerateQuestions(body) {
  if (runState === 'running') throw busyError();
  runState = 'running';
  activeJobKind = 'generate';
  abortCtl = new AbortController();
  const signal = abortCtl.signal;
  broadcast({ type: 'run_start', job: 'generate' });

  const {
    roles,
    judgeConfig,
    apiKeys,
    inferenceDefaults
  } = body;

  const count = judgeConfig.questionCount ?? 5;
  const difficulty = judgeConfig.difficulty ?? 3;
  const categories = judgeConfig.categories ?? 'general';
  const judgeInstructions = judgeConfig.judgeInstructions ?? '';

  const questionGenPrompt = `
Generate ${count} challenging questions for an LLM competition.
Difficulty: ${difficulty}/5 (5 = frontier models only)
Categories: ${categories}
${judgeInstructions ? `Additional instructions: ${judgeInstructions}` : ''}

Return ONLY a valid JSON array, no text outside the array:
[{"question":"...","category":"..."},...]
`.trim();

  const sessionId = randomUUID();
  const now = Date.now();

  try {
    let raw = '';
    if (roles.judge.type === 'cloud') {
      const cfg = resolveCloudConfig(body);
      broadcast({
        type: 'phase',
        phase: 'JUDGE_GENERATE',
        model: cfg.model,
        provider: cfg.name || cfg.id || cfg.protocol
      });
      raw = await cloudChatCompletion({
        provider: cfg,
        messages: [{ role: 'user', content: questionGenPrompt }],
        temperature: 0.3,
        maxTokens: 8192,
        timeoutMs: (judgeConfig.timeoutSec ?? 120) * 1000,
        abortSignal: signal
      });
    } else {
      if (!roles.judge.model?.path) throw new Error('no local judge model');
      broadcast({ type: 'phase', phase: 'JUDGE_LOAD', role: 'judge', model: roles.judge.model.name });
      await processManager.loadModel(roles.judge.model.path, {
        ctxSize: inferenceDefaults?.ctxSize,
        batchSize: inferenceDefaults?.batchSize,
        abortSignal: signal,
        onProgress: (line) =>
          broadcast({ type: 'load_progress', role: 'judge', model: roles.judge.model.name, line })
      });
      if (signal.aborted) throw abortError();
      broadcast({ type: 'phase', phase: 'JUDGE_GENERATE' });
      raw = await llamaClient.chatCompletion([{ role: 'user', content: questionGenPrompt }], {
        temperature: 0.3,
        maxTokens: 8192,
        model: roles.judge.model?.name
      });
      broadcast({ type: 'phase', phase: 'JUDGE_UNLOAD', role: 'judge' });
      await processManager.unloadCurrentModel();
    }

    if (signal.aborted) throw abortError();
    const arr = parseJsonFromModel(raw);
    if (!Array.isArray(arr)) throw new Error('expected JSON array of questions');

    db.insertSession({
      id: sessionId,
      created_at: now,
      categories,
      difficulty,
      judge_type: roles.judge.type
    });

    const inserted = [];
    arr.forEach((q, i) => {
      const qid = randomUUID();
      db.insertQuestion({
        id: qid,
        session_id: sessionId,
        position: i,
        question: String(q.question),
        category: String(q.category ?? 'general')
      });
      inserted.push({
        id: qid,
        text: String(q.question),
        category: String(q.category ?? 'general')
      });
    });

    broadcast({ type: 'questions_ready', sessionId, count: arr.length });
    broadcast({ type: 'phase', phase: 'ROUND_COMPLETE' });
    return { sessionId, questions: inserted };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      broadcast({ type: 'phase', phase: 'IDLE' });
    } else {
      const message = e instanceof Error ? e.message : String(e);
      broadcast({ type: 'error', message, phase: 'JUDGE_GENERATE' });
    }
    throw e;
  } finally {
    try {
      await processManager.unloadCurrentModel();
    } catch {
      /* ignore */
    }
    activeJobKind = null;
    runState = 'idle';
    abortCtl = null;
  }
}

/**
 * @param {object} body
 */
export async function runArenaRound(body) {
  if (runState === 'running') throw busyError();
  runState = 'running';
  activeJobKind = 'arena';
  abortCtl = new AbortController();
  const signal = abortCtl.signal;
  broadcast({ type: 'run_start', job: 'arena' });

  const {
    mode,
    sessionId: inputSessionId,
    roles,
    questions,
    startIndex,
    judgeConfig,
    apiKeys,
    inferenceDefaults,
    panelOverrides
  } = body;

  const sessionId = inputSessionId || randomUUID();
  const activeSlots = /** @type {const} */ (['A', 'B', 'C', 'D']).filter((s) => roles[s]?.model?.path);
  setVoteSession(sessionId, activeSlots.length ? activeSlots : ['A', 'B', 'C', 'D']);
  const now = Date.now();
  const slots = /** @type {const} */ (['A', 'B', 'C', 'D']);

  const judgeTemp = judgeConfig?.deterministicJudge ? 0 : 0.7;
  const inferTemp = inferenceDefaults?.temperature ?? 0.7;
  const inferMax = inferenceDefaults?.maxTokens ?? 1024;
  const ctxSize = inferenceDefaults?.ctxSize ?? 8192;
  const batchSize = inferenceDefaults?.batchSize ?? 512;
  const timeoutMs = (judgeConfig?.timeoutSec ?? 120) * 1000;

  const start = Math.max(0, Math.min(startIndex ?? 0, questions.length - 1));
  const endIndex = mode === 'all' ? questions.length - 1 : start;

  try {
    if (!inputSessionId) {
      db.insertSession({
        id: sessionId,
        created_at: now,
        categories: judgeConfig?.categories ?? '',
        difficulty: judgeConfig?.difficulty ?? 3,
        judge_type: roles.judge.type
      });
      for (const slot of slots) {
        const m = roles[slot]?.model;
        if (m) {
          db.insertRoleAssignment({
            session_id: sessionId,
            role: slot,
            model_name: m.name,
            model_path: m.path,
            cloud_model: null
          });
        }
      }
      if (roles.judge.type === 'local' && roles.judge.model) {
        db.insertRoleAssignment({
          session_id: sessionId,
          role: 'judge',
          model_name: roles.judge.model.name,
          model_path: roles.judge.model.path,
          cloud_model: null
        });
      } else {
        db.insertRoleAssignment({
          session_id: sessionId,
          role: 'judge',
          model_name: 'cloud',
          model_path: '',
          cloud_model: roles.judge.cloudModel || getConfig().judgeModel
        });
      }
    }

    // ── The race: one round per question ──
    for (let qi = start; qi <= endIndex; qi++) {
      if (signal.aborted) throw abortError();
      const q = questions[qi];
      const qtext = q.text ?? q.question ?? '';
      broadcast({ type: 'progress', current: qi + 1, total: questions.length });
      broadcast({ type: 'phase', phase: 'QUESTION_START', questionId: q.id, index: qi });

      /** @type {Record<string, string>} */
      const responses = {};

      for (const slot of slots) {
        if (signal.aborted) throw abortError();
        const assignment = roles[slot];
        if (!assignment?.model?.path) continue;

        broadcast({ type: 'phase', phase: 'ROLE_LOAD', role: slot, model: assignment.model.name });
      await processManager.loadModel(assignment.model.path, {
        ctxSize,
        batchSize,
        abortSignal: signal,
        onProgress: (line) =>
          broadcast({ type: 'load_progress', role: slot, model: assignment.model.name, line })
      });
      if (signal.aborted) throw abortError();

        const prompt = `Answer clearly and completely:\n\n${qtext}\n`;
        const po = panelOverrides?.[slot] ?? {};
        const temperature = po.temperature ?? inferTemp;
        const maxTokens = po.maxTokens ?? inferMax;

        broadcast({ type: 'phase', phase: 'ROLE_INFER', role: slot });
        const t0 = Date.now();
        let text = '';
        let tokens = 0;
        let finalTokenCount = null;
        for await (const chunk of llamaClient.streamCompletion(prompt, { temperature, maxTokens, model: assignment.model.name })) {
          if (signal.aborted) throw abortError();
          if (chunk.content) {
            text += chunk.content;
            tokens += chunk.content.split(/\s+/).filter(Boolean).length;
            broadcast({ type: 'token', role: slot, content: chunk.content, stop: !!chunk.stop });
          }
          if (chunk.tokensActual != null) finalTokenCount = chunk.tokensActual;
          if (chunk.stop) break;
        }
        if (finalTokenCount != null) tokens = finalTokenCount;
        const duration = Date.now() - t0;
        responses[slot] = text;

        broadcast({
          type: 'stats',
          role: slot,
          questionId: q.id,
          tokens,
          duration_ms: duration,
          tokens_per_sec: duration > 0 ? Math.round(tokens / (duration / 1000)) : 0
        });

        db.insertResponse({
          id: randomUUID(),
          session_id: sessionId,
          question_id: q.id,
          role: slot,
          model_name: assignment.model.name,
          response: text,
          token_count: tokens,
          duration_ms: duration
        });

        broadcast({ type: 'phase', phase: 'ROLE_UNLOAD', role: slot });
        await processManager.unloadCurrentModel();
      }

      // ── The crowd watches the judge score this round ──
      if (signal.aborted) throw abortError();

      if (roles.judge.type === 'local') {
        if (!roles.judge.model?.path) throw new Error('no local judge model');
        broadcast({ type: 'phase', phase: 'JUDGE_LOAD', role: 'judge', model: roles.judge.model.name });
        await processManager.loadModel(roles.judge.model.path, {
          ctxSize,
          batchSize,
          abortSignal: signal,
          onProgress: (line) =>
            broadcast({ type: 'load_progress', role: 'judge', model: roles.judge.model.name, line })
        });
        if (signal.aborted) throw abortError();
      }

      broadcast({ type: 'phase', phase: 'JUDGE_PHASE_START', questionId: q.id });

      const activeRoles = slots.filter((s) => responses[s]);
      if (activeRoles.length === 0) {
        broadcast({ type: 'scores', questionId: q.id, scores: {}, reasoning: 'no contestant responses' });
        continue;
      }

      const { prompt: judgeUserPrompt, anonToRole } = buildScoringPrompt(
        qtext,
        responses,
        !!judgeConfig?.blindReview,
        judgeConfig?.judgeFeedback
      );

      let judgeRaw = '';
      if (roles.judge.type === 'cloud') {
        const cfg = resolveCloudConfig(body);
        broadcast({
          type: 'phase',
          phase: 'JUDGE_SCORE',
          questionId: q.id,
          model: cfg.model,
          provider: cfg.name || cfg.id || cfg.protocol
        });
        judgeRaw = await cloudChatCompletion({
          provider: cfg,
          messages: [{ role: 'user', content: judgeUserPrompt }],
          temperature: judgeTemp,
          maxTokens: 2048,
          timeoutMs,
          abortSignal: signal
        });
      } else {
        broadcast({ type: 'phase', phase: 'JUDGE_SCORE', questionId: q.id });
        judgeRaw = await llamaClient.chatCompletion([{ role: 'user', content: judgeUserPrompt }], {
          temperature: judgeTemp,
          maxTokens: 2048,
          model: roles.judge.model?.name
        });
      }

      const parsed = parseJsonFromModel(judgeRaw);
      const scoresRaw = parsed.scores || {};
      const reasoning = String(parsed.reasoning ?? '');
      const scores = remapBlindScores(scoresRaw, anonToRole);

      for (const role of Object.keys(scores)) {
        db.insertScore({
          session_id: sessionId,
          question_id: q.id,
          role,
          score: Number(scores[role]),
          reasoning,
          created_at: Date.now()
        });
      }

      broadcast({
        type: 'scores',
        questionId: q.id,
        scores,
        reasoning
      });
      broadcast({ type: 'phase', phase: 'QUESTION_SCORED', questionId: q.id });

      if (roles.judge.type === 'local') {
        broadcast({ type: 'phase', phase: 'JUDGE_UNLOAD', role: 'judge' });
        await processManager.unloadCurrentModel();
      }
    }

    broadcast({ type: 'phase', phase: 'ROUND_COMPLETE' });
    return { sessionId };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      broadcast({ type: 'phase', phase: 'IDLE' });
    } else {
      const message = e instanceof Error ? e.message : String(e);
      broadcast({ type: 'error', message });
    }
    throw e;
  } finally {
    try {
      await processManager.unloadCurrentModel();
    } catch {
      /* ignore */
    }
    activeJobKind = null;
    runState = 'idle';
    abortCtl = null;
  }
}
