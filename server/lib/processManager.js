import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config.js';

/** @type {import('node:child_process').ChildProcess | null} */
let llamaProcess = null;
let currentModelPath = null;
/** @type {'idle' | 'loading' | 'ready' | 'unloading' | 'error'} */
let status = 'idle';

/** @type {string} */
let lastStderrTail = '';
/** Monotonic ms of the last stderr/stdout chunk. 0 == nothing yet. */
let lastStderrAt = 0;
/** @type {((s: string) => void) | null} progress reporter set by loadModel */
let progressListener = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function debugLog(msg) {
  if (process.env.DEBUG_LLAMA) console.error('[llama]', msg);
}

const PROGRESS_PATTERNS = [
  /^load_tensors:\s*offloaded\s+\d+\/\d+\s+layers/i,
  /^load_tensors:\s*[A-Z0-9_]+\s+model buffer size/i,
  /llama_kv_cache.*size\s*=/i,
  /server is listening on/i,
  /HTTP server listening/i
];

function appendStderr(chunk) {
  const s = chunk.toString();
  lastStderrTail = (lastStderrTail + s).slice(-16000);
  lastStderrAt = Date.now();
  debugLog(s);
  if (progressListener) {
    for (const line of s.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (PROGRESS_PATTERNS.some((re) => re.test(t))) {
        try {
          progressListener(t);
        } catch {
          /* listener errors should never break loading */
        }
      }
    }
  }
}

export function getStatus() {
  return status;
}

export function getCurrentModel() {
  return currentModelPath;
}

export function getLastLlamaStderr() {
  return lastStderrTail;
}

function splitLdPaths(s) {
  return (s || '')
    .split(':')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Paths that exist under a typical `/opt/intel/oneapi` install. Modern compilers ship
 * `libsvml.so` under `compiler/<ver>/lib` (not only `linux/compiler/lib/intel64_lin`).
 * MKL/DNNL/TBB dirs are needed too — verified with `env -i LD_LIBRARY_PATH=… ldd llama-server`.
 */
function discoverOneApiLibDirs() {
  /** @type {string[]} */
  const found = [];

  /** @param {string} dir */
  const pushIfDir = (dir) => {
    if (!dir) return;
    try {
      if (fs.statSync(dir).isDirectory()) found.push(dir);
    } catch {
      /* skip */
    }
  };

  /** @param {string} root oneAPI root */
  const walkToolkit = (root, toolkit, /** @type {(libRoot: string) => void} */ pushLib) => {
    const base = path.join(root, toolkit);
    try {
      for (const ver of fs.readdirSync(base)) {
        pushLib(path.join(base, ver));
      }
    } catch {
      /* skip */
    }
  };

  const roots = ['/opt/intel/oneapi', process.env.ONEAPI_ROOT].filter(Boolean);
  for (const root of [...new Set(roots)]) {
    pushIfDir(path.join(root, 'compiler', 'latest', 'lib'));
    pushIfDir(path.join(root, 'compiler', 'latest', 'linux', 'lib'));
    pushIfDir(path.join(root, 'compiler', 'latest', 'linux', 'compiler', 'lib', 'intel64_lin'));

    try {
      const compRoot = path.join(root, 'compiler');
      for (const ver of fs.readdirSync(compRoot)) {
        if (ver === 'latest') continue;
        pushIfDir(path.join(compRoot, ver, 'lib'));
        pushIfDir(path.join(compRoot, ver, 'linux', 'lib'));
        pushIfDir(path.join(compRoot, ver, 'linux', 'compiler', 'lib', 'intel64_lin'));
      }
    } catch {
      /* skip */
    }

    walkToolkit(root, 'mkl', (b) => pushIfDir(path.join(b, 'lib')));
    walkToolkit(root, 'dnnl', (b) => pushIfDir(path.join(b, 'lib')));
    walkToolkit(root, 'tbb', (b) => {
      pushIfDir(path.join(b, 'lib'));
      pushIfDir(path.join(b, 'lib', 'intel64', 'gcc4.8'));
    });
  }

  const seen = new Set();
  return found.filter((d) => (seen.has(d) ? false : (seen.add(d), true)));
}

/**
 * Prepends dirs so dynamically linked SYCL/OpenMP libs (libsvml.so, …) resolve when the
 * desktop shell never ran `source /opt/intel/oneapi/setvars.sh`.
 */
function shouldAppendOneApiLd(binaryPath) {
  if (process.env.ARENA_AUTO_ONEAPI_LD === '0') return false;
  if (process.env.ARENA_AUTO_ONEAPI_LD === '1') return true;
  return /(?:sycl|oneapi)/i.test(String(binaryPath || ''));
}

/**
 * Exported for `npm run diagnose` — same env Arena uses when spawning llama-server.
 * @returns {Record<string, string | undefined>}
 */
export function buildLlamaProcessEnv(llamaBin) {
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = { ...process.env };

  const prepend = [...splitLdPaths(process.env.ARENA_EXTRA_LD_LIBRARY_PATH)];
  if (shouldAppendOneApiLd(llamaBin)) prepend.push(...discoverOneApiLibDirs());

    const seen = new Set();
    /** @type {string[]} */
    const merged = [];

    // Parent env order is canonical (setvars.sh arranges it carefully).
    // Append discovered paths AFTER the parent's so we never reorder.
    for (const p of splitLdPaths(process.env.LD_LIBRARY_PATH || '')) {
      if (!seen.has(p)) {
        seen.add(p);
        merged.push(p);
      }
    }
    // Only add discovered dirs that the parent didn't already have.
    for (const p of prepend) {
      if (!seen.has(p)) {
        seen.add(p);
        merged.push(p);
      }
    }
    if (merged.length) childEnv.LD_LIBRARY_PATH = merged.join(':');

  /**
   * SYCL / llama.cpp: `ggml_sycl_init` → `dpct::dev_mgr` calls `select_device`. With no
   * `ONEAPI_DEVICE_SELECTOR` and a minimal parent env (Cursor, systemd, no setvars),
   * that path often throws "No device of requested type available" even when the GPU
   * works under `sycl-ls` after a proper login shell.
   *
   * - `ARENA_NO_SYCL_ENV=1` — leave SYCL-related vars exactly as in the parent process.
   * - Otherwise strip deprecated `SYCL_DEVICE_FILTER` from the child.
   * - `ARENA_ONEAPI_DEVICE_SELECTOR` — always wins (explicit override).
   * - Else if parent did not set `ONEAPI_DEVICE_SELECTOR` and the binary looks SYCL:
   *   set `ARENA_SYCL_DEFAULT_DEVICE_SELECTOR` or default `level_zero:gpu` (Arc on
   *   Linux). Try `opencl:gpu` if Level Zero fails (see `sycl-ls`).
   */
  if (process.env.ARENA_NO_SYCL_ENV === '1') {
    /* leave ONEAPI_DEVICE_SELECTOR / SYCL_DEVICE_FILTER untouched */
  } else {
    delete childEnv.SYCL_DEVICE_FILTER;
    const forced = process.env.ARENA_ONEAPI_DEVICE_SELECTOR?.trim();
    if (forced) {
      childEnv.ONEAPI_DEVICE_SELECTOR = forced;
    } else if (
      !childEnv.ONEAPI_DEVICE_SELECTOR?.trim() &&
      shouldAppendOneApiLd(llamaBin) &&
      process.env.ARENA_SYCL_SKIP_DEVICE_SELECTOR !== '1'
    ) {
      childEnv.ONEAPI_DEVICE_SELECTOR =
        process.env.ARENA_SYCL_DEFAULT_DEVICE_SELECTOR?.trim() || 'level_zero:gpu';
    }
  }

  return childEnv;
}

function sharedLibsHintTail() {
  const s = lastStderrTail.trim();
  if (!s) return '';
  if (/No device of requested type available/i.test(s)) {
    return `\n\nSYCL failed during device selection inside llama-server (not the Arena UI). Set \`ARENA_ONEAPI_DEVICE_SELECTOR\` in \`.env\` — try \`level_zero:gpu\` or \`opencl:gpu\` (see \`sycl-ls\`). Source \`setvars.sh\` before \`npm run dev\` or use the desktop launcher. If \`sycl-ls\` is clean but this persists, rebuild llama.cpp against this oneAPI and update Level Zero / GPU user-space packages (README). Non-SYCL binary: \`ARENA_NO_SYCL_ENV=1\`.`;
  }
  if (!/(?:shared libraries|libsvml|libimf\.so|cannot open shared object)/i.test(s)) return '';
  return `\n\nIf you use a SYCL/Intel-linked llama-server: Intel runtime must be on LD_LIBRARY_PATH (e.g. /opt/intel/oneapi/compiler/latest/lib plus mkl/dnnl/tbb — Arena prepends these when the binary path contains “sycl”, or use ARENA_EXTRA_LD_LIBRARY_PATH / source setvars.sh; set ARENA_AUTO_ONEAPI_LD=0 to disable auto-prepending).`;
}

async function unloadCurrentModel() {
  if (!llamaProcess) {
    currentModelPath = null;
    status = 'idle';
    return;
  }
  status = 'unloading';
  const proc = llamaProcess;
  llamaProcess = null;
  currentModelPath = null;

  /**
   * If llama-server ignores SIGTERM, waiting on 'close' never resolves and the
   * sequencer stays "running" forever — users only see "busy". Cap wait, then SIGKILL.
   */
  const termMs = Math.max(3000, parseInt(process.env.ARENA_UNLOAD_TERM_MS || '12000', 10) || 12000);
  const killMs = Math.max(2000, parseInt(process.env.ARENA_UNLOAD_KILL_MS || '6000', 10) || 6000);

  const waitClose = async (maxMs) => {
    if (proc.exitCode !== null) return;
    await Promise.race([
      new Promise((resolve) => proc.once('close', resolve)),
      sleep(maxMs).then(() => {})
    ]);
  };

  proc.kill('SIGTERM');
  await waitClose(termMs);

  if (proc.exitCode === null) {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    await waitClose(killMs);
  }

  // GPU drivers (especially Intel Arc Level Zero) need time to release VRAM
  // and tear down the device context after SIGKILL. Without this, the next
  // model load often hits a fragmented or locked device and SIGABRTs.
  const cooldownMs = Math.max(1000, parseInt(process.env.ARENA_GPU_COOLDOWN_MS || '3000', 10) || 3000);
  await sleep(cooldownMs);
  status = 'idle';
}

/**
 * llama.cpp prints a huge GDB backtrace (via ggml_print_backtrace) on uncaught SYCL
 * exceptions — it overwhelms the UI status line. Strip frames; keep the real error.
 * @param {number} maxLen
 */
function stderrUserHint(maxLen = 3500) {
  let s = lastStderrTail;
  if (!s.trim()) return '';
  s = s.replace(
    /warning: File "[^"]*libsycl[^"]*gdb\.py"[\s\S]*?(?=terminate called after throwing)/i,
    ''
  );
  const lines = s.split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\[Thread debugging using libthread_db/.test(t)) continue;
    if (/^Using host libthread_db/.test(t)) continue;
    if (/^#\d+\s+0x[0-9a-f]+ in /.test(t)) continue;
    if (/^\[Inferior \d+[^\]]*\]/.test(t)) continue;
    if (/^warning:.*No such file or directory$/.test(t)) continue;
    if (/^\d+\s+in\s+.*No such file or directory/.test(t)) continue;
    out.push(line);
  }
  s = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.slice(-maxLen);
}

function formatChildExit(
  /** @type {number | null | undefined} */ code,
  /** @type {NodeJS.Signals | null} */ signal,
  /** @type {import('node:child_process').ChildProcess | null} */ proc
) {
  if (signal) return `signal ${signal}`;
  if (typeof code === 'number') return `code ${code}`;
  const ps = proc?.signalCode;
  if (ps) return `signal ${ps}`;
  const pc = proc?.exitCode;
  if (typeof pc === 'number') return `code ${pc}`;
  return 'exit reason unknown (see stderr below)';
}

/**
 * @param {number} timeoutMs
 * @param {() => boolean} isExited
 * @param {() => string} getExitSummary
 * @param {(s: string) => void} onHeartbeat
 * @param {AbortSignal | null | undefined} abortSignal
 */
async function waitForHealth(
  timeoutMs = 600000,
  /** @type {() => boolean} */ isExited = () => false,
  /** @type {() => string} */ getExitSummary = () => 'unknown',
  /** @type {(s: string) => void} */ onHeartbeat = () => {},
  /** @type {AbortSignal | null | undefined} */ abortSignal
) {
  const config = getConfig();
  const stallMs = Math.max(15000, parseInt(process.env.ARENA_LOAD_STALL_MS || '60000', 10) || 60000);
  const startedAt = Date.now();
  const hardDeadline = startedAt + Math.max(timeoutMs, stallMs * 2);
  const hardLimitSec = Math.round((hardDeadline - startedAt) / 1000);
  let lastHeartbeatAt = 0;

  const throwIfAborted = () => {
    if (abortSignal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
  };

  while (Date.now() < hardDeadline) {
    throwIfAborted();
    if (isExited()) {
      const tail = stderrUserHint();
      const hint = tail ? `\nLast llama-server output:\n${tail}` : '';
      throw new Error(
        `llama-server exited (${getExitSummary()}) before the model finished loading.${hint}${sharedLibsHintTail()}`
      );
    }
    try {
      const r = await fetch(`http://127.0.0.1:${config.llamaPort}/health`, {
        signal: AbortSignal.timeout(8000)
      });
      let j = {};
      try {
        j = await r.json();
      } catch {
        await sleep(500);
        continue;
      }
      if (r.status === 200 && j.status === 'ok') return;
    } catch {
      /* connection refused, timeout, etc. */
    }

    /* Heartbeat to the UI every ~3s so the status bar shows progress. */
    if (Date.now() - lastHeartbeatAt > 3000) {
      lastHeartbeatAt = Date.now();
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      try {
        onHeartbeat(`loading ${elapsedSec}s elapsed`);
      } catch {
        /* heartbeat listener errors must not stop loading */
      }
    }

    /* Stall only after we have seen stderr/stdout — silent startup can be minutes on huge models. */
    if (lastStderrAt > 0) {
      const sinceStderr = Date.now() - lastStderrAt;
      if (sinceStderr > stallMs) {
        const tail = stderrUserHint();
        const hint = tail ? ` Last llama-server output:\n${tail}` : '';
        throw new Error(
          `llama-server has been silent for ${Math.round(sinceStderr / 1000)}s — load appears stalled.${hint}${sharedLibsHintTail()}`
        );
      }
    }

    await sleep(500);
  }
  const tail = stderrUserHint();
  const hint = tail ? ` Last llama-server output:\n${tail}` : '';
  throw new Error(
    `llama-server failed to become ready within ${hardLimitSec}s (wall limit for this wait).${hint}${sharedLibsHintTail()}`
  );
}

/**
 * @param {string} modelPath
 * @param {{
 *   ctxSize?: number,
 *   batchSize?: number,
 *   onProgress?: (s: string) => void,
 *   abortSignal?: AbortSignal | null
 * }=} options
 */
async function loadModel(modelPath, options = {}) {
  const config = getConfig();
  await unloadCurrentModel();
  status = 'loading';
  lastStderrTail = '';
  lastStderrAt = 0;
  progressListener = typeof options.onProgress === 'function' ? options.onProgress : null;

  const args = [
    '--model',
    modelPath,
    '--alias',
    path.basename(modelPath),
    '--n-gpu-layers',
    '-1',
    '--ctx-size',
    String(options.ctxSize ?? 8192),
    '--batch-size',
    String(options.batchSize ?? 512),
    '--parallel',
    '1',
    '--host',
    '127.0.0.1',
    '--port',
    String(config.llamaPort),
    '--no-warmup'
  ];

  const childEnv = buildLlamaProcessEnv(config.llamaServerBin);

  llamaProcess = spawn(config.llamaServerBin, args, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let processExited = false;
  let exitCode = /** @type {number | null | undefined} */ (undefined);
  /** @type {NodeJS.Signals | null} */
  let exitSignal = null;
  const proc = llamaProcess;
  proc.stderr?.on('data', appendStderr);
  proc.stdout?.on('data', appendStderr);
  proc.once('exit', (code, signal) => {
    processExited = true;
    exitCode = code;
    exitSignal = signal || null;
    if (status !== 'unloading') {
      status = 'error';
      const why =
        code === null && signal
          ? `signal ${signal}`
          : `code ${code === null ? 'null' : code}`;
      console.error(`llama-server exited unexpectedly: ${why}`);
    }
  });

  try {
    await new Promise((resolve, reject) => {
      const onErr = (/** @type {Error} */ e) => {
        proc.off('spawn', onSpawn);
        reject(new Error(`llama-server failed to start: ${e.message}. Check LLAMA_BIN in Settings / .env`));
      };
      const onSpawn = () => {
        proc.off('error', onErr);
        resolve(undefined);
      };
      proc.once('error', onErr);
      proc.once('spawn', onSpawn);
    });
  } catch (e) {
    llamaProcess = null;
    status = 'idle';
    throw e;
  }

  const sig = options.abortSignal;
  const throwIfAborted = () => {
    if (sig?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
  };
  throwIfAborted();

  try {
    await waitForHealth(
      config.loadTimeoutMs,
      () => processExited,
      () => formatChildExit(exitCode, exitSignal, proc),
      (s) => progressListener?.(s),
      sig
    );
  } catch (e) {
    try {
      await unloadCurrentModel();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    progressListener = null;
  }
  currentModelPath = modelPath;
  status = 'ready';
}

export { loadModel, unloadCurrentModel, waitForHealth };
