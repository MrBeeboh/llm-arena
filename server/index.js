import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { getConfig, mergeRuntimeConfig } from './config.js';
import healthRoutes from './routes/health.js';
import modelsRoutes from './routes/models.js';
import inferenceRoutes from './routes/inference.js';
import arenaRoutes from './routes/arena.js';
import { buildLlamaProcessEnv } from './lib/processManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

mergeRuntimeConfig({
  modelsDir: process.env.MODELS_DIR
    ? path.isAbsolute(process.env.MODELS_DIR)
      ? process.env.MODELS_DIR
      : path.join(rootDir, process.env.MODELS_DIR)
    : path.join(rootDir, 'models')
});

fs.mkdirSync(getConfig().modelsDir, { recursive: true });

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

await fastify.register(healthRoutes);
await fastify.register(modelsRoutes);
await fastify.register(inferenceRoutes);
await fastify.register(arenaRoutes);

if (isProd) {
  const buildDir = path.join(rootDir, 'build');
  await fastify.register(fastifyStatic, {
    root: buildDir,
    prefix: '/'
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith('/api')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
}

const cfg = getConfig();
try {
  await fastify.listen({ port: cfg.port, host: '0.0.0.0' });
  fastify.log.info(`Arena API on http://127.0.0.1:${cfg.port}`);

  /* One-shot snapshot of what env Arena will hand to llama-server. Hugely useful when
     a stale Node process is the actual cause of an LD_LIBRARY_PATH-style failure. */
  try {
    const childEnv = buildLlamaProcessEnv(cfg.llamaServerBin);
    const lds = (childEnv.LD_LIBRARY_PATH || '').split(':').filter(Boolean);
    fastify.log.info(
      {
        llamaServerBin: cfg.llamaServerBin,
        llamaPort: cfg.llamaPort,
        ldLibraryPathCount: lds.length,
        ldLibraryPathSample: lds.slice(0, 8),
        arenaNoSyclEnv: process.env.ARENA_NO_SYCL_ENV === '1',
        arenaAutoOneapiLd: process.env.ARENA_AUTO_ONEAPI_LD ?? 'auto',
        oneapiDeviceSelector: childEnv.ONEAPI_DEVICE_SELECTOR ?? '(unset — not forced by Arena)'
      },
      'llama-server spawn env'
    );
  } catch (e) {
    fastify.log.warn(`Could not preview llama-server env: ${e instanceof Error ? e.message : String(e)}`);
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
