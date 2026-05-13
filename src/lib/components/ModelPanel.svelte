<script>
  let {
    role,
    label,
    text = '',
    active = false,
    waiting = false,
    blind = false,
    tokens = 0,
    temperature = 0.7,
    maxTokens = 1024,
    tps = 0,
    durationMs = 0
  } = $props();

  const displayLabel = $derived(blind ? `Model ${role}` : label);
  const hasStats = $derived(tps > 0 || durationMs > 0);
  const durationDisplay = $derived(
    durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
  );
</script>

<div
  class="flex min-h-[220px] flex-col rounded-lg border border-slate-200 bg-white/90 shadow-inner transition-opacity dark:border-slate-700 dark:bg-slate-900/60"
  class:opacity-40={waiting}
  class:ring-2={active}
  class:ring-emerald-500={active}
>
  <header
    class="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700"
  >
    <span class="text-sm font-semibold text-slate-800 dark:text-slate-200">{displayLabel}</span>
    <span
      class="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      >{tokens} tok</span>
  </header>
  <div
    class="flex-1 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-100"
  >
    {text}<span class:hidden={!active} class="animate-pulse">▍</span>
  </div>
  <footer
    class="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-500"
  >
    {#if hasStats}
      <span class="font-medium text-emerald-700 dark:text-emerald-400">{tps} tok/s</span>
      <span class="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
      <span>{durationDisplay}</span>
      <span class="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
    {/if}
    temp {temperature} · max {maxTokens}
  </footer>
</div>
