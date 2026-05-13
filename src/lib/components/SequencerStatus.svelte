<script>
  import {
    statusLine,
    progress,
    sequencerRunning,
    sequencerJobKind
  } from '$lib/stores/sequencer.js';

  async function abortArena() {
    try {
      await fetch('/api/arena/abort', { method: 'POST' });
      statusLine.set('⟳ Abort requested…');
    } catch (e) {
      statusLine.set(`! Abort failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
</script>

<div
  class="border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90"
  aria-live="polite"
>
  <div class="flex flex-wrap items-center gap-3 font-mono text-sm text-slate-800 dark:text-slate-200">
    {#if $sequencerRunning}
      <span
        class="inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent dark:border-emerald-500"
        aria-hidden="true"
      ></span>
      {#if $sequencerJobKind === 'generate'}
        <span class="text-xs font-sans text-emerald-700 dark:text-emerald-400">Generating questions</span>
      {:else if $sequencerJobKind === 'arena'}
        <span class="text-xs font-sans text-emerald-700 dark:text-emerald-400">Arena round</span>
      {/if}
    {/if}
    <span class="min-w-0 flex-1 break-words">{$statusLine}</span>
    {#if $progress.total > 0}
      <span class="shrink-0 text-xs text-slate-500 dark:text-slate-500">
        Q {$progress.current} / {$progress.total}
      </span>
    {/if}
    {#if $sequencerRunning}
      <button
        type="button"
        class="shrink-0 rounded border border-amber-600/60 px-2 py-0.5 font-sans text-xs font-medium text-amber-800 hover:bg-amber-500/10 dark:border-amber-500/50 dark:text-amber-200 dark:hover:bg-amber-500/10"
        onclick={() => abortArena()}
      >
        Abort run
      </button>
    {/if}
  </div>
</div>
