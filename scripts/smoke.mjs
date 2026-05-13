#!/usr/bin/env node
/**
 * Quick API smoke check. Start the Arena server first (e.g. npm run server).
 * Usage: PORT=5175 node scripts/smoke.mjs
 */
import http from 'node:http';

const port = process.env.PORT || '5175';
const base = `http://127.0.0.1:${port}`;

function get(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${base}${path}`, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode ?? 0, json, body });
        });
      })
      .on('error', reject);
  });
}

try {
  const h = await get('/api/health');
  if (h.status !== 200) {
    console.error('FAIL /api/health', h.status, h.body?.slice(0, 200));
    process.exit(1);
  }
  const m = await get('/api/models');
  if (m.status !== 200) {
    console.error('FAIL /api/models', m.status);
    process.exit(1);
  }
  console.log('smoke ok', { arena: h.json?.arena, modelsDir: m.json?.modelsDir });
} catch (e) {
  console.error('smoke: server not reachable on', base, '- start with: npm run server');
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
