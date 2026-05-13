import { writable, derived } from 'svelte/store';

export const sequencerRunning = writable(false);

/** Idle: null. While running: `'generate'` | `'arena'` (from SSE). */
export const sequencerJobKind = writable(/** @type {null | string} */ (null));

/** @type {import('svelte/store').Writable<string>} */
export const statusLine = writable('● Idle — assign models and load questions to begin');

/** @type {import('svelte/store').Writable<Record<string, unknown> | null>} */
export const lastPhase = writable(null);

export const progress = writable({ current: 0, total: 0 });

/** Client-side reset when HTTP fails before SSE catches up. */
export function clearSequencerBusy() {
  sequencerRunning.set(false);
  sequencerJobKind.set(null);
}

export const activeInferRole = derived(lastPhase, ($p) => {
  if (!$p || $p.phase !== 'ROLE_INFER') return null;
  return String($p.role ?? '');
});

/**
 * @param {Record<string, unknown>} e
 * @param {{ onScores?: (e: Record<string, unknown>) => void }} [hooks]
 */
export function applySequencerEvent(e, hooks) {
  if (e.type === 'run_start') {
    sequencerRunning.set(true);
    sequencerJobKind.set(typeof e.job === 'string' ? e.job : null);
    return;
  }
  if (e.type === 'hello') {
    // Only literal true counts — avoids sticky UI when `running` is missing or a stray truthy string.
    sequencerRunning.set(e.running === true);
    sequencerJobKind.set(typeof e.job === 'string' ? e.job : null);
    return;
  }
  if (e.type === 'phase') {
    lastPhase.set(e);
    const ph = e.phase;
    if (ph === 'ROLE_LOAD') {
      statusLine.set(`⟳ Loading: ${e.model}  [role: Contestant ${e.role}]`);
    } else if (ph === 'ROLE_INFER') {
      statusLine.set(`▶ ${e.role} inferring…`);
    } else if (ph === 'ROLE_UNLOAD') {
      statusLine.set(`⟳ Unloading contestant ${e.role}…`);
    } else if (ph === 'JUDGE_LOAD') {
      statusLine.set(`⟳ Loading judge: ${e.model}`);
    } else if (ph === 'JUDGE_GENERATE') {
      statusLine.set(
        e.model ? `⟳ Judge generating questions… (${e.model})` : '⟳ Judge generating questions…'
      );
    } else if (ph === 'JUDGE_SCORE') {
      statusLine.set(`⟳ Judge scoring…  ${e.model ? `[cloud: ${e.model}]` : ''}`);
    } else if (ph === 'JUDGE_UNLOAD') {
      statusLine.set('⟳ Unloading judge model…');
    } else if (ph === 'ROUND_COMPLETE') {
      statusLine.set('✓ Round complete');
      sequencerRunning.set(false);
      sequencerJobKind.set(null);
    } else if (ph === 'QUESTION_START') {
      statusLine.set(`▶ Question ${(e.index ?? 0) + 1}`);
    } else if (ph === 'QUESTION_SCORED') {
      statusLine.set('✓ Question scored');
    } else if (ph === 'JUDGE_PHASE_START') {
      statusLine.set('▶ Judge phase');
    } else if (ph === 'IDLE') {
      statusLine.set('● Idle — assign models and load questions to begin');
      sequencerRunning.set(false);
      sequencerJobKind.set(null);
    }
    return;
  }
  if (e.type === 'progress') {
    progress.set({ current: /** @type {number} */ (e.current), total: /** @type {number} */ (e.total) });
    return;
  }
  if (e.type === 'load_progress') {
    const who = e.role === 'judge' ? 'judge' : `slot ${e.role}`;
    const detail = typeof e.line === 'string' && e.line ? ` — ${e.line}` : '';
    statusLine.set(`⟳ Loading ${who} (${e.model})${detail}`);
    return;
  }
  if (e.type === 'error') {
    statusLine.set(`! ${e.message}`);
    sequencerRunning.set(false);
    sequencerJobKind.set(null);
    return;
  }
  if (e.type === 'scores') {
    hooks?.onScores?.(e);
    const s = /** @type {Record<string, number>} */ (e.scores || {});
    const parts = Object.entries(s).map(([k, v]) => `${k}:${v}`);
    statusLine.set(`✓ Scored — ${parts.join('  ')}`);
    return;
  }
  if (e.type === 'questions_ready') {
    statusLine.set(`✓ Generated ${e.count} questions`);
    sequencerRunning.set(false);
    sequencerJobKind.set(null);
    return;
  }
  if (e.type === 'token') {
    return;
  }
}

/** Dev/HMR can leave sequencerRunning=true with no SSE to clear it; reset when this module reloads. */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sequencerRunning.set(false);
    sequencerJobKind.set(null);
    lastPhase.set(null);
    progress.set({ current: 0, total: 0 });
    statusLine.set('● Idle — assign models and load questions to begin');
  });
}
