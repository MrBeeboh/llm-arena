<script>
  import { onMount, onDestroy } from 'svelte';

  /** @type {{ A?: number, B?: number, C?: number, D?: number }} */
  let { speedStats = {}, running = false, activeSlots = [] } = $props();

  const slots = ['A', 'B', 'C', 'D'];
  let odds = $state({ A: 2.0, B: 2.0, C: 2.0, D: 2.0 });
  let drift = $state({ A: 0, B: 0, C: 0, D: 0 });
  let tickId;

  function recalcOdds() {
    const active = activeSlots.length ? activeSlots : slots;
    const speeds = active.map((s) => speedStats[s] ?? 0);
    const totalSpeed = speeds.reduce((a, b) => a + b, 0);

    const raw = {};
    for (let i = 0; i < active.length; i++) {
      const s = active[i];
      const spd = speedStats[s] ?? 0;
      if (totalSpeed > 0 && spd > 0) {
        // Faster = lower odds (favourite). Base inversely proportional.
        const inverseShare = (totalSpeed - spd) / totalSpeed;
        raw[s] = 1.2 + inverseShare * 4.5;
      } else {
        raw[s] = 2.0 + Math.random() * 0.4 - 0.2;
      }
    }

    // Normalise so implied probability sums to ~105% (bookmaker margin)
    const impliedSum = active.reduce((a, s) => a + 1 / raw[s], 0);
    const margin = 1.05;
    odds = Object.fromEntries(
      active.map((s) => [s, Math.max(1.1, parseFloat((raw[s] * (impliedSum / margin)).toFixed(1)))])
    );
  }

  function tick() {
    if (!running) return;
    // Micro-drift so the board feels live even without new data
    drift = Object.fromEntries(
      slots.map((s) => [s, (Math.random() - 0.5) * 0.08])
    );
    recalcOdds();
  }

  $effect(() => {
    // Re-run whenever speedStats or running changes
    recalcOdds();
  });

  onMount(() => { tickId = setInterval(tick, 800); });
  onDestroy(() => clearInterval(tickId));

  function displayOdds(slot) {
    const base = odds[slot] ?? 2.0;
    const d = drift[slot] ?? 0;
    return Math.max(1.1, base + d).toFixed(1);
  }

  function isFav(slot) {
    const active = activeSlots.length ? activeSlots : slots;
    if (!active.includes(slot)) return false;
    const min = Math.min(...active.map((s) => odds[s] ?? 99));
    return (odds[slot] ?? 99) === min;
  }
</script>

<div class="flex items-center gap-1 rounded-lg border border-amber-800/40 bg-amber-950/60 px-3 py-1.5 font-mono text-xs backdrop-blur">
  <span class="mr-2 shrink-0 font-bold uppercase tracking-widest text-amber-500">LIVE ODDS</span>
  {#each (activeSlots.length ? activeSlots : slots) as slot}
    {@const fav = isFav(slot)}
    <span class="flex items-center gap-1">
      <span class="font-semibold text-slate-400">{slot}:</span>
      <span class="tabular-nums transition-all duration-300"
        class:text-emerald-400={fav}
        class:font-bold={fav}
        class:text-amber-300={!fav}>
        {displayOdds(slot)}x
      </span>
      {#if fav}<span class="text-[9px] text-emerald-500 uppercase tracking-wider">FAV</span>{/if}
    </span>
    <span class="text-amber-800/60 last:hidden">│</span>
  {/each}
  {#if !running}
    <span class="ml-2 text-amber-700/60 italic">pre-race</span>
  {/if}
</div>
