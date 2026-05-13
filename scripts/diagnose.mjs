#!/usr/bin/env node
/**
 * Troubleshooting checklist: filesystem models, SYCL linker paths Arena will use,
 * and `ldd` under that environment (evidence-backed, no guessing).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mergeRuntimeConfig, getConfig } from '../server/config.js';
import { scanModels } from '../server/lib/modelScanner.js';
import { buildLlamaProcessEnv } from '../server/lib/processManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/** Shallow `.env` — only fills keys not already exported in the shell. */
function mergeDotEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

mergeDotEnv();

mergeRuntimeConfig({
  modelsDir: process.env.MODELS_DIR
    ? path.isAbsolute(process.env.MODELS_DIR)
      ? process.env.MODELS_DIR
      : path.join(rootDir, process.env.MODELS_DIR)
    : path.join(rootDir, 'models')
});

const cfg = getConfig();

console.log('Arena diagnose');
console.log('  project:', rootDir);
console.log('  modelsDir:', cfg.modelsDir);
console.log('  llamaServerBin:', cfg.llamaServerBin);
console.log('  llamaPort:', cfg.llamaPort);
console.log('  ARENA_NO_SYCL_ENV:', process.env.ARENA_NO_SYCL_ENV ?? '(unset)');
console.log('  ARENA_AUTO_ONEAPI_LD:', process.env.ARENA_AUTO_ONEAPI_LD ?? '(unset)');
console.log(
  '  ARENA_ONEAPI_DEVICE_SELECTOR:',
  process.env.ARENA_ONEAPI_DEVICE_SELECTOR ?? '(unset — Arena only injects if you set this)'
);
console.log('');

const models = await scanModels(cfg.modelsDir);
console.log('GGUF files (recursive scan):', models.length);
for (const m of models) console.log('  •', m.name, `(${m.sizeGb} GB)`);
console.log('');

let exit = 0;
const binPath = cfg.llamaServerBin;
try {
  fs.accessSync(binPath, fs.constants.X_OK);
  console.log('OK: llama-server exists and is executable.');
} catch {
  console.error('FAIL: llama-server missing or not executable:', binPath);
  exit = 2;
}

const childEnv = buildLlamaProcessEnv(binPath);
console.log(
  '  ONEAPI_DEVICE_SELECTOR (effective on llama child):',
  childEnv.ONEAPI_DEVICE_SELECTOR ?? '(unset)'
);
console.log(
  '  SYCL_DEVICE_FILTER (effective on llama child):',
  childEnv.SYCL_DEVICE_FILTER ?? '(unset)'
);
const dirs = (childEnv.LD_LIBRARY_PATH || '').split(':').filter(Boolean);
console.log('');
console.log('LD_LIBRARY_PATH (Arena merges prepend + env):', dirs.length, 'entries');
dirs.slice(0, 26).forEach((d) => console.log('   ', d));
if (dirs.length > 26) console.log('   …', dirs.length - 26, 'more');

if (exit === 0) {
  try {
    const lddOut = execFileSync('ldd', [binPath], {
      encoding: 'utf8',
      env: { ...childEnv, PATH: process.env.PATH || '/usr/bin:/bin' }
    });
    const bad = lddOut
      .split('\n')
      .map((ln) => ln.trim())
      .filter((ln) => /not found/i.test(ln));
    console.log('');
    if (bad.length) {
      console.error('FAIL: unresolved libraries when linking with Arena’s spawn env:');
      bad.forEach((ln) => console.error('  ', ln));
      exit = 3;
    } else {
      console.log('');
      console.log('OK: `ldd` shows no unresolved libraries for that spawn env.');
    }
  } catch (e) {
    console.error('');
    console.error('SKIP/WARN: `ldd` failed:', e instanceof Error ? e.message : String(e));
  }
}

console.log('');
console.log(
  exit === 0
    ? 'Diagnose finished with no failures. Start the API (`npm run server`) and open the UI.'
    : 'Fix the failures above before expecting Generate / Ask to load models.'
);

process.exit(exit);
