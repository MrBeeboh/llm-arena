<script>
  import { scoresByQuestion, questions } from '$lib/stores/arena.js';
</script>

<div
  class="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
>
  <h3 class="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-300">Scoreboard</h3>
  <div class="space-y-2 font-mono text-sm">
    {#each ['A', 'B', 'C', 'D'] as r}
      {@const sum = $questions.reduce(
        (acc, q) => acc + ($scoresByQuestion[q.id]?.[r] ?? 0),
        0
      )}
      <div class="flex justify-between text-slate-800 dark:text-slate-200">
        <span>Slot {r}</span>
        <span class="text-emerald-600 dark:text-emerald-400">{sum.toFixed(1)}</span>
      </div>
    {/each}
  </div>
</div>
