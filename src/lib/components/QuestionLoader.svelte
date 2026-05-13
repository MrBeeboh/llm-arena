<script>
  import { setQuestions } from '$lib/stores/arena.js';

  let { open = $bindable(false) } = $props();

  function onFile(ev) {
    const f = ev.currentTarget.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const raw = JSON.parse(String(r.result));
        const list = Array.isArray(raw) ? raw : raw.questions;
        if (!Array.isArray(list)) throw new Error('expected array or { questions: [] }');
        const mapped = list.map((item, i) => ({
          id: crypto.randomUUID(),
          text: String(item.question ?? item.text ?? ''),
          category: String(item.category ?? 'general')
        }));
        setQuestions(mapped, null);
        open = false;
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    };
    r.readAsText(f);
    ev.currentTarget.value = '';
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && (open = false)}
  >
    <div
      class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <h2 class="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Load questions</h2>
      <p class="mb-4 text-sm text-slate-600 dark:text-slate-400">
        JSON file: an array of objects with <code class="text-emerald-700 dark:text-emerald-400">question</code> and
        <code class="text-emerald-700 dark:text-emerald-400">category</code>, or an object with a
        <code class="text-emerald-700 dark:text-emerald-400">questions</code> array of the same shape.
      </p>
      <input type="file" accept="application/json,.json" class="text-sm text-slate-800" onchange={onFile} />
      <button
        type="button"
        class="mt-6 w-full rounded border border-slate-300 py-2 text-sm text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        onclick={() => (open = false)}>Close</button>
    </div>
  </div>
{/if}
