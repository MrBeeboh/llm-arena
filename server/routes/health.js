import { getConfig } from '../config.js';
import * as processManager from '../lib/processManager.js';

export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    const cfg = getConfig();
    let llama = { ok: false, detail: 'unknown' };
    try {
      const r = await fetch(`http://127.0.0.1:${cfg.llamaPort}/health`);
      const j = await r.json();
      llama = { ok: j.status === 'ok', detail: j };
    } catch (e) {
      llama = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    return {
      arena: 'ok',
      processManager: {
        status: processManager.getStatus(),
        currentModel: processManager.getCurrentModel(),
        lastLlamaStderrTail: processManager.getLastLlamaStderr()
      },
      llama
    };
  });
}
