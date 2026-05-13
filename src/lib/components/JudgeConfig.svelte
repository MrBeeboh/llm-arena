<script>
  let { config = $bindable() } = $props();

  const field =
    'mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';
  const lab = 'text-slate-600 dark:text-slate-400';
</script>

<div
  class="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/50"
>
  <h3 class="mb-3 text-sm font-semibold text-amber-800 dark:text-amber-200/90">Judge &amp; round options</h3>
  <div class="grid gap-3 md:grid-cols-2">
    <label class="text-sm">
      <span class={lab}>Difficulty (1–5)</span>
      <input type="number" min="1" max="5" class={field} bind:value={config.difficulty} />
    </label>
    <label class="text-sm">
      <span class={lab}>Number of questions (generate)</span>
      <input type="number" min="1" max="100" class={field} bind:value={config.questionCount} />
    </label>
    <label class="text-sm md:col-span-2">
      <span class={lab}>Categories / topics (comma-separated)</span>
      <textarea class={field} rows="2" bind:value={config.categories}></textarea>
    </label>
    <label class="text-sm md:col-span-2">
      <span class={lab}>Judge instructions (rubric, optional)</span>
      <textarea class={field} rows="2" bind:value={config.judgeInstructions}></textarea>
    </label>
    <label class="text-sm md:col-span-2">
      <span class={lab}>Judge feedback / correction hint (optional)</span>
      <textarea class={field} rows="2" bind:value={config.judgeFeedback}></textarea>
    </label>
    <label class="text-sm">
      <span class={lab}>Numeric answer precision</span>
      <select class={field} bind:value={config.answerPrecision}>
        <option value="any">Any</option>
        <option value="integer">Integer</option>
        <option value="2dp">2 decimal places</option>
      </select>
    </label>
    <label class="text-sm">
      <span class={lab}>Timeout (seconds)</span>
      <input type="number" min="30" max="600" class={field} bind:value={config.timeoutSec} />
    </label>
    <label class="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
      <input type="checkbox" bind:checked={config.blindReview} />
      Blind review (anonymize responses for judge)
    </label>
    <label class="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
      <input type="checkbox" bind:checked={config.deterministicJudge} />
      Deterministic judge (temperature 0)
    </label>
  </div>
</div>
