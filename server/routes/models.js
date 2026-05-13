import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import multipart from '@fastify/multipart';
import { scanModels } from '../lib/modelScanner.js';
import * as processManager from '../lib/processManager.js';
import * as sequencer from '../lib/sequencer.js';
import { getConfig } from '../config.js';

function safeGgufName(filename) {
  const base = path.basename(filename || 'model.gguf');
  if (!base.toLowerCase().endsWith('.gguf')) return null;
  if (base.includes('..') || base.includes('/') || base.includes('\\')) return null;
  return base;
}

function openInFileManager(dir) {
  const platform = process.platform;
  if (platform === 'win32') {
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [dir], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
  }
}

export default async function modelsRoutes(fastify) {
  const maxBytes = Number(process.env.MAX_MODEL_UPLOAD_BYTES) || 120 * 1024 * 1024 * 1024;

  await fastify.register(multipart, {
    limits: { fileSize: maxBytes }
  });

  fastify.get('/api/models', async () => {
    const cfg = getConfig();
    await mkdir(cfg.modelsDir, { recursive: true });
    const available = await scanModels(cfg.modelsDir);
    return {
      available,
      modelsDir: cfg.modelsDir,
      process: {
        status: processManager.getStatus(),
        currentModel: processManager.getCurrentModel()
      }
    };
  });

  fastify.get('/api/models/info', async () => {
    const cfg = getConfig();
    await mkdir(cfg.modelsDir, { recursive: true });
    return {
      modelsDir: cfg.modelsDir,
      maxUploadBytes: maxBytes
    };
  });

  fastify.post('/api/models/open-folder', async (_request, reply) => {
    if (sequencer.isRunning()) {
      return reply.code(409).send({ error: 'wait until the arena run finishes' });
    }
    const cfg = getConfig();
    await mkdir(cfg.modelsDir, { recursive: true });
    try {
      openInFileManager(cfg.modelsDir);
      return { ok: true, opened: cfg.modelsDir };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  fastify.post('/api/models/import', async (request, reply) => {
    if (sequencer.isRunning()) {
      return reply.code(409).send({ error: 'wait until the arena run finishes' });
    }
    const cfg = getConfig();
    await mkdir(cfg.modelsDir, { recursive: true });

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'no file in multipart upload (field name: file)' });
    }

    const safe = safeGgufName(data.filename);
    if (!safe) {
      return reply.code(400).send({ error: 'only a single .gguf filename is allowed' });
    }

    let destPath = path.join(cfg.modelsDir, safe);
    if (fs.existsSync(destPath)) {
      const stem = safe.slice(0, -5);
      destPath = path.join(cfg.modelsDir, `${stem}.import-${Date.now()}.gguf`);
    }

    try {
      await pipeline(data.file, createWriteStream(destPath));
    } catch (e) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }

    const available = await scanModels(cfg.modelsDir);
    const added = available.find((m) => m.path === destPath);
    return {
      ok: true,
      path: destPath,
      model: added || { name: path.basename(destPath), path: destPath, sizeGb: 0 }
    };
  });
}
