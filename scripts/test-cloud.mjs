#!/usr/bin/env node
/**
 * End-to-end test for cloud judge wiring:
 *  - Starts the Arena API on an ephemeral port
 *  - Starts a tiny mock provider supporting both OpenAI-compat and Anthropic protocols
 *  - Calls /api/cloud/test for both protocols
 *  - Calls /api/arena/generate-questions with a cloud judge that points at the mock
 *
 * Run:  node scripts/test-cloud.mjs
 */
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const ARENA_PORT = 5191;
const MOCK_PORT = 5192;

/**
 * Mock provider:
 *   POST /v1/chat/completions  → OpenAI-compatible reply
 *   POST /v1/messages          → Anthropic reply
 */
function startMockProvider() {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const last = body.messages?.[body.messages.length - 1]?.content || body.prompt || '';
      const sample =
        last.includes('ping') ? 'pong'
        : last.includes('Generate ')
          ? JSON.stringify([
              { question: 'mock Q1', category: 'general' },
              { question: 'mock Q2', category: 'general' }
            ])
          : 'mock-reply';

      if (req.url === '/v1/messages') {
        if (!req.headers['x-api-key']) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'missing key' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: sample }] }));
      } else if (req.url === '/v1/chat/completions') {
        if (!req.headers.authorization) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'missing key' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: sample } }]
          })
        );
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

async function startArena() {
  const env = { ...process.env, PORT: String(ARENA_PORT), NODE_ENV: 'development' };
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let buf = '';
  child.stdout.on('data', (c) => (buf += c));
  child.stderr.on('data', (c) => (buf += c));

  /* wait for the listen log */
  for (let i = 0; i < 100; i++) {
    if (buf.includes('Arena API on') || buf.includes('Server listening')) break;
    await delay(100);
  }
  /* sanity probe */
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/health`);
      if (r.ok) break;
    } catch {
      /* still starting */
    }
    await delay(200);
  }
  return { child, output: () => buf };
}

let failures = 0;
function check(name, ok, extra = '') {
  if (ok) console.log(`OK    ${name}${extra ? ` — ${extra}` : ''}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function main() {
  const mock = await startMockProvider();
  const arena = await startArena();
  try {
    /* /api/cloud/test — openai-compat */
    {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/cloud/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
          apiKey: 'sk-mock',
          model: 'mock-1'
        })
      });
      const j = await r.json();
      check('cloud/test openai-compat', r.ok && j.ok && j.sample === 'pong', JSON.stringify(j));
    }

    /* /api/cloud/test — anthropic */
    {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/cloud/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'anthropic',
          baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
          apiKey: 'sk-mock',
          model: 'mock-claude'
        })
      });
      const j = await r.json();
      check('cloud/test anthropic', r.ok && j.ok && j.sample === 'pong', JSON.stringify(j));
    }

    /* /api/cloud/test — bad key (expect 401-style error from upstream) */
    {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/cloud/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'openai',
          baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
          apiKey: '',
          model: 'mock-1'
        })
      });
      const j = await r.json();
      check('cloud/test rejects missing key', !r.ok && typeof j.error === 'string', j.error);
    }

    /* /api/arena/generate-questions via cloud judge */
    {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/arena/generate-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roles: {
            judge: {
              type: 'cloud',
              cloudProvider: {
                id: 'mock',
                name: 'Mock',
                protocol: 'openai',
                baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
                apiKey: 'sk-mock',
                model: 'mock-1'
              }
            }
          },
          judgeConfig: { questionCount: 2, categories: 'general', difficulty: 2, timeoutSec: 30 }
        })
      });
      const j = await r.json();
      const okShape = r.ok && Array.isArray(j.questions) && j.questions.length === 2;
      check('arena/generate-questions cloud path', okShape, JSON.stringify(j).slice(0, 200));
    }

    /* /api/arena/generate-questions with missing key reports clearly */
    {
      const r = await fetch(`http://127.0.0.1:${ARENA_PORT}/api/arena/generate-questions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roles: {
            judge: {
              type: 'cloud',
              cloudProvider: {
                id: 'mock',
                name: 'Mock',
                protocol: 'openai',
                baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
                apiKey: '',
                model: 'mock-1'
              }
            }
          },
          judgeConfig: { questionCount: 1 }
        })
      });
      const j = await r.json();
      check(
        'generate-questions surfaces missing-key error',
        !r.ok && /missing API key/i.test(j.error || ''),
        j.error
      );
    }
  } finally {
    try { arena.child.kill('SIGTERM'); } catch { /* ignore */ }
    try { mock.close(); } catch { /* ignore */ }
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll cloud tests passed.');
}

main().catch((e) => {
  console.error('test-cloud crashed:', e);
  process.exit(2);
});
