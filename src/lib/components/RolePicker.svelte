<script>
  import { roles, availableModels, loadedModelPath, processStatus } from '$lib/stores/models.js';
  import { sequencerRunning } from '$lib/stores/sequencer.js';
  import { formatGb } from '$lib/utils/format.js';

  const slots = ['A', 'B', 'C', 'D'];

  let filter = $state({ A: '', B: '', C: '', D: '' });

  function setRoleModel(slot, m) {
    roles.update((r) => ({
      ...r,
      [slot]: { ...r[slot], model: m }
    }));
  }

  function filtered(list, q) {
    const s = (q || '').toLowerCase();
    if (!s) return list;
    return list.filter((m) => m.name.toLowerCase().includes(s));
  }

  function dotFor(path) {
    return path && $loadedModelPath === path;
  }
</script>

<div class="grid grid-cols-1 gap-3 md:grid-cols-4">
  {#each slots as slot}
    <div
      class="rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Slot {slot}</span>
        {#if $processStatus === 'ready' && dotFor($roles[slot]?.model?.path)}
          <span class="h-2 w-2 rounded-full bg-emerald-500" title="Loaded on GPU"></span>
        {/if}
      </div>
      <input
        class="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        placeholder="Filter…"
        bind:value={filter[slot]}
        disabled={$sequencerRunning}
      />
      <select
        class="w-full rounded border border-slate-300 bg-white py-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        disabled={$sequencerRunning}
        value={$roles[slot]?.model?.path ?? ''}
        onchange={(e) => {
          const v = e.currentTarget.value;
          const m = $availableModels.find((x) => x.path === v) || null;
          setRoleModel(slot, m);
        }}
      >
        <option value="">None</option>
        {#each filtered($availableModels, filter[slot]) as m}
          <option value={m.path}>{m.name} ({formatGb(m.sizeGb)})</option>
        {/each}
      </select>
    </div>
  {/each}
</div>
