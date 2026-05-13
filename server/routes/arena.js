import { PassThrough } from 'node:stream';
import { mergeRuntimeConfig, getConfigForClient } from '../config.js';
import * as sequencer from '../lib/sequencer.js';
import { cloudChatCompletion } from '../lib/sequencer.js';
import * as db from '../lib/db.js';

export default async function arenaRoutes(fastify) {
  fastify.get('/api/sequencer/stream', async (request, reply) => {
    const stream = new PassThrough();
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');

    const send = (obj) => {
      if (!stream.destroyed) {
        stream.write(`data: ${JSON.stringify(obj)}\n\n`);
      }
    };

    send({ type: 'hello', running: sequencer.isRunning(), job: sequencer.getActiveJobKind() });

    const unsub = sequencer.subscribe(send);
    request.raw.on('close', () => {
      unsub();
      stream.end();
    });

    return reply.send(stream);
  });

  fastify.post('/api/config', async (request) => {
    const b = request.body || {};
    mergeRuntimeConfig({
      llamaServerBin: b.llamaServerBin,
      llamaPort: b.llamaPort != null ? parseInt(String(b.llamaPort), 10) : undefined,
      modelsDir: b.modelsDir,
      loadTimeoutMs: b.loadTimeoutMs != null ? parseInt(String(b.loadTimeoutMs), 10) : undefined,
      judgeBaseUrl: b.judgeBaseUrl,
      judgeModel: b.judgeModel,
      judgeApiKey: b.judgeApiKey
    });
    return { ok: true, config: getConfigForClient() };
  });

  fastify.post('/api/arena/abort', async () => {
    sequencer.abortRun();
    return { ok: true };
  });

  fastify.post('/api/cloud/test', async (request, reply) => {
    const b = request.body || {};
    const protocol = b.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const baseUrl = String(b.baseUrl || '').trim();
    const apiKey = String(b.apiKey || '').trim();
    const model = String(b.model || '').trim();
    if (!baseUrl) return reply.code(400).send({ error: 'baseUrl required' });
    if (!apiKey) return reply.code(400).send({ error: 'apiKey required' });
    if (!model) return reply.code(400).send({ error: 'model required' });

    try {
      const out = await cloudChatCompletion({
        provider: { protocol, baseUrl, apiKey, model, id: 'test', name: 'test' },
        messages: [
          { role: 'system', content: 'Reply with the single word: pong.' },
          { role: 'user', content: 'ping' }
        ],
        temperature: 0,
        maxTokens: 32,
        timeoutMs: 20000
      });
      return { ok: true, modelEcho: model, sample: String(out || '').trim() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });

  fastify.post('/api/arena/generate-questions', async (request, reply) => {
    try {
      const result = await sequencer.runGenerateQuestions(request.body || {});
      return result;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return reply.code(499).send({ aborted: true });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });

  fastify.post('/api/arena/run', async (request, reply) => {
    try {
      const result = await sequencer.runArenaRound(request.body || {});
      return result;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return reply.code(499).send({ aborted: true });
      }
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });

  fastify.get('/api/arena/session/:id/questions', async (request) => {
    const rows = db.listQuestionsForSession(request.params.id);
    return {
      questions: rows.map((r) => ({
        id: r.id,
        text: r.question,
        category: r.category,
        position: r.position
      }))
    };
  });
}
