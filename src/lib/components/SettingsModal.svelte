<script>
  import { get } from 'svelte/store';
  import { settings, updateSettings, defaultCloudProviders, splitCsvList, findProviderById } from '$lib/stores/settings.js';
  import { roles, availableModels } from '$lib/stores/models.js';
  import { formatGb } from '$lib/utils/format.js';

  let { open = $bindable(false) } = $props();

  /** @type {any} */
  let local = $state(structuredClone(get(settings)));
  let saveMsg = $state('');
  let testMsg = $state({});

  $effect(() => {
    if (open) {
      const s = get(settings);
      local = structuredClone(s);
      saveMsg = '';
      testMsg = {};
    }
  });

  function uniqueId(base) {
    const ids = new Set(local.cloudProviders.map((p) => p.id));
    if (!ids.has(base)) return base;
    let i = 2;
    while (ids.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  function addProvider() {
    local.cloudProviders = [
      ...local.cloudProviders,
      {
        id: uniqueId('custom'),
        name: 'Custom provider',
        protocol: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        defaultModel: '',
        knownModels: '',
        signupUrl: '',
        notes: 'OpenAI-compatible /chat/completions endpoint.'
      }
    ];
  }

  function addPreset(kind) {
    const presets = {
      openrouter: {
        id: uniqueId('openrouter'),
        name: 'OpenRouter',
        protocol: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: '',
        defaultModel: 'openai/gpt-4o-mini',
        knownModels:
          'openai/gpt-4o, openai/gpt-4o-mini, anthropic/claude-3.5-sonnet, google/gemini-2.5-pro, meta-llama/llama-3.3-70b-instruct',
        signupUrl: 'https://openrouter.ai/keys',
        notes: 'Aggregator. Model ids use `vendor/model` form.'
      },
      groq: {
        id: uniqueId('groq'),
        name: 'Groq',
        protocol: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: '',
        defaultModel: 'llama-3.3-70b-versatile',
        knownModels: 'llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768',
        signupUrl: 'https://console.groq.com/keys',
        notes: 'OpenAI-compatible.'
      },
      deepseek: {
        id: uniqueId('deepseek'),
        name: 'DeepSeek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        defaultModel: 'deepseek-chat',
        knownModels: 'deepseek-chat, deepseek-reasoner',
        signupUrl: 'https://platform.deepseek.com/api_keys',
        notes: 'OpenAI-compatible.'
      },
      together: {
        id: uniqueId('together'),
        name: 'Together AI',
        protocol: 'openai',
        baseUrl: 'https://api.together.xyz/v1',
        apiKey: '',
        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        knownModels:
          'meta-llama/Llama-3.3-70B-Instruct-Turbo, deepseek-ai/DeepSeek-V3, Qwen/Qwen2.5-72B-Instruct-Turbo',
        signupUrl: 'https://api.together.xyz/settings/api-keys',
        notes: 'OpenAI-compatible.'
      },
      mistral: {
        id: uniqueId('mistral'),
        name: 'Mistral AI',
        protocol: 'openai',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKey: '',
        defaultModel: 'mistral-large-latest',
        knownModels: 'mistral-large-latest, mistral-small-latest, codestral-latest',
        signupUrl: 'https://console.mistral.ai/api-keys',
        notes: 'OpenAI-compatible.'
      },
      google: {
        id: uniqueId('google'),
        name: 'Google Gemini (OpenAI-compat)',
        protocol: 'openai',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: '',
        defaultModel: 'gemini-2.5-pro',
        knownModels: 'gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash',
        signupUrl: 'https://aistudio.google.com/apikey',
        notes: 'OpenAI-compat endpoint for Gemini.'
      },
      ollama: {
        id: uniqueId('ollama'),
        name: 'Local Ollama',
        protocol: 'openai',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        defaultModel: 'llama3.1',
        knownModels: 'llama3.1, qwen2.5, mistral, phi3',
        signupUrl: '',
        notes: 'Local Ollama, OpenAI-compatible. Any non-empty key works.'
      }
    };
    const p = presets[kind];
    if (p) local.cloudProviders = [...local.cloudProviders, p];
  }

  function removeProvider(i) {
    local.cloudProviders = local.cloudProviders.filter((_, idx) => idx !== i);
  }

  function resetDefaults() {
    local.cloudProviders = defaultCloudProviders();
  }

  function syncLegacyApiKeys() {
    const next = { ...(local.apiKeys || {}) };
    for (const p of local.cloudProviders) {
      if (p.id === 'xai' || p.id === 'openai' || p.id === 'anthropic') next[p.id] = p.apiKey;
    }
    local.apiKeys = next;
  }

  async function save() {
    syncLegacyApiKeys();
    const seen = new Set();
    for (const p of local.cloudProviders) {
      p.id = String(p.id || '').trim();
      if (!p.id) {
        saveMsg = 'Provider id cannot be empty.';
        return;
      }
      if (seen.has(p.id)) {
        saveMsg = `Duplicate provider id: ${p.id}`;
        return;
      }
      seen.add(p.id);
      if (!p.baseUrl) {
        saveMsg = `Provider ${p.id}: Base URL is required.`;
        return;
      }
    }

    updateSettings(local);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          llamaServerBin: local.llamaServerBin,
          llamaPort: local.llamaPort,
          loadTimeoutMs: local.loadTimeoutSec * 1000
        })
      });
    } catch {
      /* server may be offline; settings still persist client-side */
    }
    saveMsg = 'Saved.';
    setTimeout(() => (open = false), 350);
  }

  async function testProvider(i) {
    const p = local.cloudProviders[i];
    testMsg = { ...testMsg, [i]: '⟳ Testing…' };
    try {
      const res = await fetch('/api/cloud/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: p.protocol,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          model: p.defaultModel
        })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        testMsg = { ...testMsg, [i]: `✗ ${j.error || res.statusText || 'failed'}` };
        return;
      }
      const sample = (j.sample || '').toString().slice(0, 60);
      testMsg = {
        ...testMsg,
        [i]: `✓ OK — ${j.modelEcho || p.defaultModel}${sample ? ` · "${sample}"` : ''}`
      };
    } catch (e) {
      testMsg = { ...testMsg, [i]: `✗ ${e instanceof Error ? e.message : String(e)}` };
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && (open = false)}
  >
    <div
      class="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <h2 id="settings-title" class="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
        Settings
      </h2>

      <section class="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <h3 class="col-span-full text-sm font-medium text-slate-600 dark:text-slate-400">
          Local llama-server
        </h3>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Binary path</span>
          <input
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.llamaServerBin}
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Port</span>
          <input
            type="number"
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.llamaPort}
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Load timeout (s)</span>
          <input
            type="number"
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.loadTimeoutSec}
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Context size</span>
          <input
            type="number"
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.ctxSize}
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Max tokens</span>
          <input
            type="number"
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.maxTokens}
          />
        </label>
        <label class="block text-sm">
          <span class="text-slate-700 dark:text-slate-300">Temperature</span>
          <input
            type="number"
            step="0.1"
            class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            bind:value={local.temperature}
          />
        </label>
      </section>

      <section class="mb-6">
        <h3 class="mb-3 text-sm font-medium text-slate-600 dark:text-slate-400">Judge</h3>

        <div class="mb-3 flex gap-3 text-sm">
          <label class="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="settings-judge-type"
              checked={$roles.judge.type === 'local'}
              onchange={() => roles.update((r) => ({ ...r, judge: { ...r.judge, type: 'local' } }))}
            />
            <span class="text-slate-700 dark:text-slate-300">Local GGUF</span>
          </label>
          <label class="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="settings-judge-type"
              checked={$roles.judge.type === 'cloud'}
              onchange={() => roles.update((r) => ({ ...r, judge: { ...r.judge, type: 'cloud' } }))}
            />
            <span class="text-slate-700 dark:text-slate-300">Cloud API</span>
          </label>
        </div>

        {#if $roles.judge.type === 'local'}
          <select
            class="w-full max-w-sm rounded border border-slate-300 bg-white py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            value={$roles.judge.model?.path ?? ''}
            onchange={(e) => {
              const v = e.currentTarget.value;
              const m = $availableModels.find((x) => x.path === v) || null;
              roles.update((r) => ({ ...r, judge: { ...r.judge, model: m } }));
            }}
          >
            <option value="">None</option>
            {#each $availableModels as m}
              <option value={m.path}>{m.name} ({formatGb(m.sizeGb)})</option>
            {/each}
          </select>
        {:else}
          <div class="space-y-2 max-w-sm">
            <select
              class="w-full rounded border border-slate-300 bg-white py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              value={$roles.judge.cloudProviderId}
              disabled={$settings.cloudProviders.length === 0}
              onchange={(e) => roles.update((r) => ({ ...r, judge: { ...r.judge, cloudProviderId: e.currentTarget.value, cloudModel: '' } }))}
            >
              {#each $settings.cloudProviders as p}
                <option value={p.id}>{p.name} ({p.protocol}{p.apiKey ? '' : ' · no key'})</option>
              {/each}
            </select>
            {#if $roles.judge.cloudProviderId}
              {@const prov = findProviderById($settings.cloudProviders, $roles.judge.cloudProviderId)}
              {@const suggestions = splitCsvList(prov?.knownModels)}
              <input
                list="judge-model-suggestions"
                class="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                placeholder={prov?.defaultModel || 'model id…'}
                value={$roles.judge.cloudModel}
                oninput={(e) => roles.update((r) => ({ ...r, judge: { ...r.judge, cloudModel: e.currentTarget.value } }))}
              />
              <datalist id="judge-model-suggestions">
                {#each suggestions as m}
                  <option value={m}></option>
                {/each}
              </datalist>
              {#if prov && !prov.apiKey}
                <p class="text-xs text-amber-700 dark:text-amber-400">No API key saved for this provider — add one below.</p>
              {/if}
            {/if}
          </div>
        {/if}
      </section>

      <section class="mb-6">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-slate-600 dark:text-slate-400">Cloud providers</h3>
          <div class="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addProvider()}>+ Custom</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('openrouter')}>+ OpenRouter</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('groq')}>+ Groq</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('deepseek')}>+ DeepSeek</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('together')}>+ Together</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('mistral')}>+ Mistral</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('google')}>+ Gemini</button
            >
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-1 text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
              onclick={() => addPreset('ollama')}>+ Ollama</button
            >
            <button
              type="button"
              class="rounded border border-amber-400/70 px-2 py-1 text-amber-800 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
              onclick={() => resetDefaults()}>Reset list</button
            >
          </div>
        </div>
        <p class="mb-3 text-xs text-slate-500 dark:text-slate-500">
          Keys are stored only in this browser (localStorage). Use the <strong>Test</strong> button to verify a key+model
          combo before running an arena.
        </p>

        <div class="space-y-3">
          {#each local.cloudProviders as p, i (i)}
            <div
              class="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/60"
            >
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    class="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.name}
                    placeholder="Display name"
                  />
                  <input
                    class="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-slate-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
                    bind:value={p.id}
                    placeholder="id"
                  />
                  <select
                    class="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.protocol}
                  >
                    <option value="openai">openai-compatible</option>
                    <option value="anthropic">anthropic messages</option>
                  </select>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded border border-emerald-600/60 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/60 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                    onclick={() => testProvider(i)}>Test</button
                  >
                  <button
                    type="button"
                    class="rounded border border-rose-400/70 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-500/50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    onclick={() => removeProvider(i)}>Remove</button
                  >
                </div>
              </div>

              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <label class="block text-xs">
                  <span class="text-slate-700 dark:text-slate-300">Base URL</span>
                  <input
                    class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.baseUrl}
                    placeholder={p.protocol === 'anthropic'
                      ? 'https://api.anthropic.com'
                      : 'https://api.example.com/v1'}
                  />
                </label>
                <label class="block text-xs">
                  <span class="text-slate-700 dark:text-slate-300">API key</span>
                  <input
                    type="password"
                    autocomplete="off"
                    class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.apiKey}
                    placeholder="sk-…"
                  />
                </label>
                <label class="block text-xs">
                  <span class="text-slate-700 dark:text-slate-300">Default model id</span>
                  <input
                    class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.defaultModel}
                    placeholder="model id"
                  />
                </label>
                <label class="block text-xs">
                  <span class="text-slate-700 dark:text-slate-300">Known models (CSV)</span>
                  <input
                    class="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                    bind:value={p.knownModels}
                    placeholder="model-a, model-b, model-c"
                  />
                </label>
              </div>

              <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                {#if p.signupUrl}
                  <a
                    class="text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
                    href={p.signupUrl}
                    target="_blank"
                    rel="noreferrer">Get API key →</a
                  >
                {:else}
                  <span></span>
                {/if}
                {#if p.notes}
                  <span class="max-w-xl break-words text-right">{p.notes}</span>
                {/if}
              </div>

              {#if testMsg[i]}
                <p class="mt-2 text-xs font-mono text-slate-700 dark:text-slate-200">{testMsg[i]}</p>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      {#if saveMsg}
        <p class="mb-3 text-sm text-amber-700 dark:text-amber-300">{saveMsg}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          onclick={() => (open = false)}>Cancel</button
        >
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          onclick={save}>Save</button
        >
      </div>
    </div>
  </div>
{/if}
