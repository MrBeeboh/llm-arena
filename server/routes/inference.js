import { PassThrough } from 'node:stream';
import * as processManager from '../lib/processManager.js';
import * as llamaClient from '../lib/llamaClient.js';

export default async function inferenceRoutes(fastify) {
  fastify.post('/api/inference/stream', async (request, reply) => {
    if (processManager.getStatus() !== 'ready') {
      return reply.code(503).send({ error: 'llama-server not ready' });
    }

    const { prompt, maxTokens, temperature } = request.body || {};
    const stream = llamaClient.streamCompletion(String(prompt ?? ''), {
      maxTokens: maxTokens ?? 1024,
      temperature: temperature ?? 0.7
    });

    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');

    const pt = new PassThrough();
    (async () => {
      try {
        for await (const chunk of stream) {
          pt.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (e) {
        pt.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n\n`);
      } finally {
        pt.end();
      }
    })();

    return reply.send(pt);
  });
}
