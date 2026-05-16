<script>
  let { tokenEst = {}, maxTokens = 1024, activeSlots = [], activeRole = null, running = false } = $props();

  const slots = ['A', 'B', 'C', 'D'];
  const colors = { A: '#34d399', B: '#60a5fa', C: '#f59e0b', D: '#f472b6' };
  const darkColors = { A: '#065f46', B: '#1e3a5f', C: '#78350f', D: '#831843' };

  function pct(slot) {
    return Math.min(100, Math.max(0, ((tokenEst[slot] ?? 0) / Math.max(1, maxTokens)) * 100));
  }

  function isLeading(slot) {
    const active = activeSlots.length ? activeSlots : slots;
    if (!active.includes(slot)) return false;
    const max = Math.max(...active.map((s) => tokenEst[s] ?? 0));
    return max > 0 && (tokenEst[slot] ?? 0) === max;
  }

  const active = $derived(activeSlots.length ? activeSlots : slots);
</script>

<div class="w-full rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 backdrop-blur">
  <div class="mb-1.5 flex items-center gap-2">
    <span class="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-500">Race</span>
    {#if running && activeRole}
      <span class="animate-pulse text-[10px] text-emerald-400">▶ Slot {activeRole} running</span>
    {/if}
  </div>
  <div class="flex flex-col gap-1">
    {#each active as slot}
      {@const p = pct(slot)}
      {@const lead = isLeading(slot)}
      {@const color = colors[slot]}
      <div class="flex items-center gap-2">
        <span class="w-5 shrink-0 font-mono text-[11px] font-bold" style="color:{color}">{slot}</span>
        <div class="relative h-4 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
            style="width:{p}%; background:{color}; opacity:{lead ? 1 : 0.65}"
          ></div>
          {#if p > 5}
            <span
              class="absolute inset-y-0 left-2 flex items-center font-mono text-[9px] font-bold text-black/70"
            >{Math.round(p)}%</span>
          {/if}
          {#if lead && p > 0}
            <span
              class="absolute right-1 top-1/2 -translate-y-1/2 text-[10px]"
              style="filter:drop-shadow(0 0 4px {color})"
            >🏎️</span>
          {/if}
        </div>
        <span class="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-slate-400">
          {tokenEst[slot] ?? 0}
        </span>
      </div>
    {/each}
  </div>
</div>
