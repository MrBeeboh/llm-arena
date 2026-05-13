<script>
  import { availableModels, modelsLoading } from '$lib/stores/models.js';
</script>

{#if !$modelsLoading && $availableModels.length === 0}
  <div class="rounded-lg border border-amber-300/80 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100/90">
    No <code class="rounded bg-black/30 px-1">.gguf</code> models found.
    Use <strong>Import</strong> in the header, or drop files in the models folder and click <strong>Refresh</strong>.
  </div>
{/if}
