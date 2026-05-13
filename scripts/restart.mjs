#!/usr/bin/env node
/**
 * Clean restart of Arena: kills any stray `node server/index.js` processes started
 * from this project root, waits for the port to free, then starts a fresh one.
 *
 * Why this exists: when source files change, in-memory Node modules of older runs
 * keep serving with the old code — so users see "fixes don't work" until they
 * restart. This script makes that one command.
 *
 * Usage:
 *   node scripts/restart.mjs        # kills strays + starts foreground server
 *   node scripts/restart.mjs --kill # just kill (don't start)
 *   node scripts/restart.mjs --dev  # restart as `npm run dev` (concurrently+vite)
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '5175', 10);
/** Vite default; free this too when recycling `npm run dev`. */
const VITE_PORT = parseInt(process.env.VITE_DEV_PORT || '5173', 10);

const args = new Set(process.argv.slice(2));
const killOnly = args.has('--kill');
const startDev = args.has('--dev');

function listArenaPids() {
  /** @type {number[]} */
  const pids = [];
  let out = '';
  try {
    out = execFileSync('ps', ['-ww', '-eo', 'pid,command'], { encoding: 'utf8' });
  } catch {
    return pids;
  }
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (pid === process.pid) continue;
    const cmd = m[2];
    /* Match only nodes serving from THIS project to avoid touching unrelated dev servers. */
    const isArenaServer =
      cmd.includes('node') &&
      cmd.includes(path.join(root, 'server', 'index.js'));
    const isProjectVite =
      cmd.includes('vite') && cmd.includes(root);
    const isProjectConcurrently =
      cmd.includes('concurrently') &&
      cmd.includes(root) &&
      (cmd.includes('vite') || cmd.includes('server/index.js'));
    const isNpmArenaDev =
      /\bnpm\b/.test(cmd) && cmd.includes(root) && /run\s+dev\b/.test(cmd);
    if (isArenaServer || isProjectVite || isProjectConcurrently || isNpmArenaDev) pids.push(pid);
  }
  return pids;
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.on('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => {
      s.close(() => resolve(true));
    });
  });
}

async function waitPortsFree(ports, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const flags = await Promise.all(ports.map((p) => isPortFree(p)));
    if (flags.every(Boolean)) return true;
    await delay(200);
  }
  return false;
}

/** Last resort: anything still LISTENing on these ports (stale vite / node). */
function killListenersOnPorts(ports) {
  for (const port of ports) {
    try {
      const out = execFileSync(
        'bash',
        ['-c', `lsof -ti TCP:${port} -sTCP:LISTEN 2>/dev/null | sort -u`],
        { encoding: 'utf8' }
      );
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (pid > 0 && pid !== process.pid) killPid(pid, 'SIGTERM');
      }
    } catch {
      /* lsof missing or nothing listening */
    }
  }
}

async function main() {
  console.log(`Arena restart helper (project: ${root})`);
  const pids = [...new Set(listArenaPids())];
  if (pids.length === 0) {
    console.log('No existing Arena processes detected.');
  } else {
    console.log(`Killing ${pids.length} stale process(es): ${pids.join(', ')}`);
    for (const pid of pids) killPid(pid, 'SIGTERM');
    await delay(1500);
    for (const pid of pids) {
      if (killPid(pid, 0)) {
        console.log(`  still alive: SIGKILL ${pid}`);
        killPid(pid, 'SIGKILL');
      }
    }
  }

  const devPorts = [PORT, VITE_PORT];
  let free = await waitPortsFree(devPorts, 12000);
  if (!free) {
    console.warn('Ports still busy — sending SIGTERM to listeners via lsof…');
    killListenersOnPorts(devPorts);
    await delay(800);
    free = await waitPortsFree(devPorts, 8000);
  }
  if (!free) console.warn(`Warning: ports ${devPorts.join(', ')} did not all free — start may fail.`);
  else console.log(`Ports ${devPorts.join(' + ')} are free.`);

  if (killOnly) {
    console.log('--kill given: not starting a new server.');
    return;
  }

  const cmd = startDev ? 'npm' : 'node';
  const cmdArgs = startDev ? ['run', 'dev'] : ['server/index.js'];
  console.log(`Starting: ${cmd} ${cmdArgs.join(' ')}`);
  const child = spawn(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
