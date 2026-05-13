<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import ModelLibrary from '$lib/components/ModelLibrary.svelte';
  import SequencerStatus from '$lib/components/SequencerStatus.svelte';
  import JudgeConfig from '$lib/components/JudgeConfig.svelte';
  import QuestionLoader from '$lib/components/QuestionLoader.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import { settings, findProviderById } from '$lib/stores/settings.js';
  import { roles, availableModels, refreshModels, modelsDirectory } from '$lib/stores/models.js';
  import {
    questions,
    currentQuestionIndex,
    liveResponses,
    sessionId,
    scoresByQuestion,
    setQuestions,
    resetRound,
    appendLiveResponse,
    mergeScores
  } from '$lib/stores/arena.js';
  import {
    applySequencerEvent,
    sequencerRunning,
    activeInferRole,
    statusLine,
    clearSequencerBusy
  } from '$lib/stores/sequencer.js';
  import { openSequencerStream } from '$lib/utils/sse.js';
  import { syncServerConfigFromSettings } from '$lib/utils/syncServerConfig.js';
  import { formatGb } from '$lib/utils/format.js';

  let settingsOpen = $state(false);
  let questionsOpen = $state(false);
  let showJudgePanel = $state(false);

  let themeIsDark = $state(true);

  let judgeConfig = $state({
    difficulty: 3,
    categories: 'reasoning, science, coding',
    questionCount: 10,
    judgeInstructions: '',
    judgeFeedback: '',
    answerPrecision: 'any',
    blindReview: false,
    deterministicJudge: true,
    timeoutSec: 120
  });

  let tokenEst = $state({ A: 0, B: 0, C: 0, D: 0 });
  let slotStats = $state({ A: null, B: null, C: null, D: null });
  let generateQuestionsInFlight = $state(false);
  let arenaRunInFlight = $state(false);
  let uploadBusy = $state(false);
  let uploadMsg = $state('');

  let fileInput;

  const slots = ['A', 'B', 'C', 'D'];

  onMount(() => {
    themeIsDark = document.documentElement.classList.contains('dark');
    void syncServerConfigFromSettings();
    refreshModels();
    const close = openSequencerStream(
      (e) => {
        if (e.type === 'phase' && e.phase === 'QUESTION_START') {
          const qlen = get(questions).length;
          const raw = typeof e.index === 'number' && Number.isFinite(e.index) ? e.index : 0;
          const idx = qlen > 0 ? Math.max(0, Math.min(qlen - 1, raw)) : 0;
          currentQuestionIndex.set(idx);
          liveResponses.set({});
          tokenEst = { A: 0, B: 0, C: 0, D: 0 };
          slotStats = { A: null, B: null, C: null, D: null };
        }
        if (e.type === 'token' && e.role && typeof e.content === 'string') {
          appendLiveResponse(/** @type {string} */ (e.role), e.content);
          const r = /** @type {string} */ (e.role);
          tokenEst = {
            ...tokenEst,
            [r]: (tokenEst[r] || 0) + e.content.split(/\s+/).filter(Boolean).length
          };
        }
        if (e.type === 'stats' && e.role) {
          const r = /** @type {string} */ (e.role);
          slotStats = {
            ...slotStats,
            [r]: {
              tokens: /** @type {number} */ (e.tokens),
              durationMs: /** @type {number} */ (e.duration_ms),
              tokensPerSec: /** @type {number} */ (e.tokens_per_sec)
            }
          };
        }
        applySequencerEvent(e, {
          onScores: (ev) => {
            const qid = String(ev.questionId ?? '');
            const sc = /** @type {Record<string, number>} */ (ev.scores || {});
            mergeScores(qid, sc);
          }
        });
        if (e.type === 'questions_ready' && e.sessionId) {
          fetch(`/api/arena/session/${e.sessionId}/questions`)
            .then((r) => r.json())
            .then((j) => {
              setQuestions(
                (j.questions || []).map((q) => ({ id: q.id, text: q.text, category: q.category })),
                e.sessionId
              );
            })
            .catch(() => {
              statusLine.set('! Could not load generated questions from server — try Refresh or restart');
            });
        }
        if (e.type !== 'token') refreshModels();
      },
      () => {}
    );
    return close;
  });

  const currentQ = $derived($questions[$currentQuestionIndex] ?? null);
  const blind = $derived(judgeConfig.blindReview);

  /** Running score total per slot for the scoreboard strip */
  const slotScores = $derived(
    Object.fromEntries(
      slots.map((r) => {
        const sum = $questions.reduce((acc, q) => acc + ($scoresByQuestion[q.id]?.[r] ?? 0), 0);
        return [r, sum];
      })
    )
  );

  function setRoleModel(slot, m) {
    roles.update((r) => ({ ...r, [slot]: { ...r[slot], model: m } }));
  }

  function toks(role) { return tokenEst[role] ?? 0; }
  function tps(role) { return slotStats[role]?.tokensPerSec ?? 0; }
  function dur(role) { return slotStats[role]?.durationMs ?? 0; }
  function hasStats(role) { return slotStats[role] != null; }
  function durDisplay(role) {
    const ms = dur(role);
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  function nav(d) {
    currentQuestionIndex.update((i) => {
      return Math.max(0, Math.min($questions.length - 1, i + d));
    });
    liveResponses.set({});
    tokenEst = { A: 0, B: 0, C: 0, D: 0 };
    slotStats = { A: null, B: null, C: null, D: null };
  }

  function buildCloudJudge(r, s) {
    const prov = findProviderById(s.cloudProviders, r.judge.cloudProviderId);
    if (!prov) return null;
    return {
      id: prov.id, name: prov.name, protocol: prov.protocol,
      baseUrl: prov.baseUrl, apiKey: prov.apiKey,
      model: r.judge.cloudModel || prov.defaultModel
    };
  }

  function buildPayload(mode) {
    const s = get(settings);
    const r = get(roles);
    const qs = get(questions);
    const cloudJudge = buildCloudJudge(r, s);
    return {
      mode,
      sessionId: get(sessionId) || undefined,
      roles: { ...r, judge: { ...r.judge, cloudProvider: cloudJudge } },
      questions: qs.map((q) => ({ id: q.id, text: q.text, category: q.category })),
      startIndex: get(currentQuestionIndex),
      judgeConfig: { ...judgeConfig },
      apiKeys: s.apiKeys,
      inferenceDefaults: { ctxSize: s.ctxSize, batchSize: 512, maxTokens: s.maxTokens, temperature: s.temperature },
      panelOverrides: {}
    };
  }

  async function postRun(mode) {
    if (arenaRunInFlight) { statusLine.set('⟳ Arena run already starting…'); return; }
    const r = get(roles);
    const qs = get(questions);
    if (!qs.length) { statusLine.set('! Load questions first'); return; }
    if (!slots.some((x) => r[x]?.model)) { statusLine.set('! Assign at least one contestant model'); return; }
    if (r.judge.type === 'local' && !r.judge.model) {
      statusLine.set('! Assign a local judge model or switch judge to Cloud API in Settings');
      return;
    }
    if (r.judge.type === 'cloud') {
      const cj = buildCloudJudge(r, get(settings));
      if (!cj) { statusLine.set('! No cloud provider selected — open Settings'); return; }
      if (!cj.apiKey) { statusLine.set(`! No API key for "${cj.name || cj.id}" — open Settings`); return; }
      if (!cj.model) { statusLine.set(`! No model id set for "${cj.name || cj.id}" — open Settings or pick a model`); return; }
      if (!cj.baseUrl) { statusLine.set(`! Base URL missing for "${cj.name || cj.id}" — open Settings`); return; }
    }
    arenaRunInFlight = true;
    try {
      statusLine.set('⟳ Running arena…');
      const res = await fetch('/api/arena/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(mode))
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 499) { statusLine.set('● Run aborted'); clearSequencerBusy(); return; }
      if (!res.ok) { statusLine.set(`! ${j.error || res.statusText || 'run failed'}`); clearSequencerBusy(); return; }
      if (j.sessionId) sessionId.set(j.sessionId);
    } catch (e) {
      statusLine.set(`! ${e instanceof Error ? e.message : String(e)}`);
      clearSequencerBusy();
    } finally { arenaRunInFlight = false; }
  }

  async function generateQuestions() {
    if (generateQuestionsInFlight) { statusLine.set('⟳ Generate already in progress…'); return; }
    const r = get(roles);
    if (r.judge.type === 'local' && !r.judge.model) {
      statusLine.set('! Assign a local judge model or use Cloud API in Settings'); return;
    }
    if (r.judge.type === 'cloud') {
      const cj = buildCloudJudge(r, get(settings));
      if (!cj) { statusLine.set('! No cloud provider selected — open Settings'); return; }
      if (!cj.apiKey) { statusLine.set(`! No API key for "${cj.name || cj.id}" — open Settings`); return; }
      if (!cj.model) { statusLine.set(`! No model id set for "${cj.name || cj.id}" — open Settings or pick a model`); return; }
      if (!cj.baseUrl) { statusLine.set(`! Base URL missing for "${cj.name || cj.id}" — open Settings`); return; }
    }
    generateQuestionsInFlight = true;
    try {
      statusLine.set('⟳ Generating questions…');
      const cloudJudge = buildCloudJudge(r, get(settings));
      const res = await fetch('/api/arena/generate-questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roles: { ...r, judge: { ...r.judge, cloudProvider: cloudJudge } },
          judgeConfig: { ...judgeConfig },
          apiKeys: get(settings).apiKeys,
          inferenceDefaults: { ctxSize: get(settings).ctxSize, batchSize: 512 }
        })
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 499 || j.aborted) { statusLine.set('● Generation aborted'); clearSequencerBusy(); return; }
      if (!res.ok) { statusLine.set(`! ${j.error || res.statusText || 'generate failed'}`); clearSequencerBusy(); return; }
      if (j.sessionId && Array.isArray(j.questions) && j.questions.length) {
        setQuestions(j.questions.map((q) => ({ id: q.id, text: q.text ?? q.question ?? '', category: q.category ?? 'general' })), j.sessionId);
      } else if (j.sessionId) {
        const rq = await fetch(`/api/arena/session/${j.sessionId}/questions`);
        const pack = await rq.json().catch(() => ({}));
        if (pack.questions?.length) setQuestions(pack.questions.map((q) => ({ id: q.id, text: q.text ?? q.question ?? '', category: q.category ?? 'general' })), j.sessionId);
      }
      const n = get(questions).length;
      statusLine.set(n > 0 ? `✓ ${n} question${n === 1 ? '' : 's'} loaded` : '! No questions returned — check judge model and server logs');
    } catch (e) {
      statusLine.set(`! ${e instanceof Error ? e.message : String(e)}`);
      clearSequencerBusy();
    } finally { generateQuestionsInFlight = false; }
  }

  async function onPickFile(ev) {
    const file = ev.currentTarget.files?.[0];
    ev.currentTarget.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.gguf')) { uploadMsg = 'Choose a .gguf file.'; return; }
    uploadBusy = true;
    uploadMsg = `Uploading ${file.name}…`;
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await fetch('/api/models/import', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      uploadMsg = res.ok ? `Added ${j.model?.name || file.name}` : (j.error || res.statusText);
      await refreshModels();
    } catch (e) {
      uploadMsg = e instanceof Error ? e.message : String(e);
    } finally { uploadBusy = false; }
  }

  async function openModelsFolder() {
    uploadMsg = '';
    try {
      const res = await fetch('/api/models/open-folder', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) uploadMsg = j.error || res.statusText;
    } catch (e) { uploadMsg = e instanceof Error ? e.message : String(e); }
  }

  async function copyModelsPath() {
    let p = $modelsDirectory;
    if (!p) { const j = await refreshModels(); p = j?.modelsDir || $modelsDirectory; }
    if (p && navigator.clipboard) {
      await navigator.clipboard.writeText(p);
      uploadMsg = 'Path copied.';
    }
  }

  function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    themeIsDark = document.documentElement.classList.contains('dark');
    try { localStorage.setItem('arena_theme', themeIsDark ? 'dark' : 'light'); } catch {}
  }
</script>

<div class="flex min-h-screen flex-col">
  <header class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
    <!-- Left cluster: Arena workflow -->
    <span class="font-bold tracking-tight text-emerald-600 dark:text-emerald-400">ARENA</span>
    <button type="button" class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 dark:bg-emerald-700 dark:hover:bg-emerald-600"
      onclick={generateQuestions} disabled={$sequencerRunning}>Generate Questions</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => (showJudgePanel = !showJudgePanel)}>Judge ▾</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => (questionsOpen = true)} disabled={$sequencerRunning}>Load</button>
    <span class="text-slate-300 dark:text-slate-600">|</span>
    <div class="flex items-center gap-1">
      <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
        onclick={() => nav(-1)} disabled={$sequencerRunning}>&larr;</button>
      <span class="px-2 font-mono text-xs text-slate-500 dark:text-slate-400">{$currentQuestionIndex + 1} / {Math.max(1, $questions.length)}</span>
      <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
        onclick={() => nav(1)} disabled={$sequencerRunning}>&rarr;</button>
    </div>
    <span class="text-slate-300 dark:text-slate-600">|</span>
    <button type="button" class="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600"
      onclick={() => postRun('single')} disabled={$sequencerRunning}>Ask</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => { nav(1); }} disabled={$sequencerRunning}>Next</button>
    <button type="button" class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600"
      onclick={() => postRun('all')} disabled={$sequencerRunning}>Run All</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => resetRound()} disabled={$sequencerRunning}>Reset</button>

    <!-- Spacer pushes tool cluster to the right -->
    <div class="flex-1"></div>

    <!-- Right cluster: model management + app settings -->
    <input type="file" accept=".gguf,application/octet-stream" class="hidden" bind:this={fileInput}
      disabled={$sequencerRunning || uploadBusy} onchange={onPickFile} />
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
      disabled={$sequencerRunning || uploadBusy} onclick={() => fileInput?.click()}>Import</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
      disabled={$sequencerRunning} onclick={openModelsFolder}>Open</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={copyModelsPath}>Copy</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => refreshModels()}>Refresh</button>
    <a class="rounded border border-slate-300 px-2 py-1 text-xs text-sky-600 hover:bg-slate-100 dark:border-slate-600 dark:text-sky-400 dark:hover:bg-slate-800"
      href="https://huggingface.co/models?library=gguf&sort=trending" target="_blank" rel="noreferrer">HF</a>
    <span class="text-slate-300 dark:text-slate-600">|</span>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={() => (settingsOpen = true)}>Settings</button>
    <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      onclick={toggleTheme}>{themeIsDark ? 'Light mode' : 'Dark mode'}</button>
  </header>

  <SequencerStatus />

  <main class="flex flex-1 flex-col gap-3 p-3">
    {#if showJudgePanel}
      <JudgeConfig bind:config={judgeConfig} />
    {/if}

    <ModelLibrary />

    {#if currentQ}
      <div class="sticky top-2 z-10 rounded-lg border border-slate-300 bg-white/95 p-3 text-sm shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/85">
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Question {$currentQuestionIndex + 1} of {$questions.length}
            {#if currentQ.category} · <span class="text-slate-400">{currentQ.category}</span>{/if}
          </span>
        </div>
        <p class="mt-1 whitespace-pre-wrap text-slate-800 dark:text-slate-100">{currentQ.text}</p>
      </div>
    {/if}

    <!-- Scoreboard strip -->
    {#if $questions.length > 0}
      <div class="rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900/60">
        <div class="flex items-center gap-4 font-mono text-xs">
          <span class="font-semibold text-slate-500 dark:text-slate-400">Scores</span>
          {#each slots as r}
            <span class="text-slate-800 dark:text-slate-200">Slot {r}</span>
            <span class="font-bold text-emerald-600 dark:text-emerald-400">{slotScores[r].toFixed(1)}</span>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Unified slot cards -->
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {#each slots as slot}
        {@const model = $roles[slot]?.model}
        {@const label = blind ? `Model ${slot}` : (model?.name ?? '—')}
        {@const waiting = $sequencerRunning && !!model && $activeInferRole !== slot && !$liveResponses[slot]}
        {@const active = $activeInferRole === slot}
        {@const st = slotStats[slot]}
        <div class="flex min-h-[260px] flex-col rounded-lg border border-slate-200 bg-white/90 shadow-sm transition-opacity dark:border-slate-700 dark:bg-slate-900/80"
          class:opacity-40={waiting}
          class:ring-2={active}
          class:ring-emerald-500={active}>

          <!-- Header: slot label + model selector -->
          <header class="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <span class="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Slot {slot}</span>
            <select
              class="flex-1 min-w-0 rounded border border-slate-300 bg-white py-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              disabled={$sequencerRunning}
              value={model?.path ?? ''}
              onchange={(e) => {
                const v = e.currentTarget.value;
                const m = $availableModels.find((x) => x.path === v) || null;
                setRoleModel(slot, m);
              }}>
              <option value="">— pick model —</option>
              {#each $availableModels as m}
                <option value={m.path}>{m.name} ({formatGb(m.sizeGb)})</option>
              {/each}
            </select>
            <span class="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{tokenEst[slot] ?? 0} tok</span>
          </header>

          <!-- Body: answer text -->
          <div class="flex-1 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs text-slate-800 dark:text-slate-100">
            {$liveResponses[slot] ?? ''}<span class:hidden={!active} class="animate-pulse">▍</span>
          </div>

          <!-- Footer: stats -->
          <footer class="border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-500">
            {#if st}
              <span class="font-medium text-emerald-700 dark:text-emerald-400">{st.tokensPerSec} tok/s</span>
              <span class="mx-1 text-slate-300 dark:text-slate-600">·</span>
              <span>{durDisplay(slot)}</span>
              <span class="mx-1 text-slate-300 dark:text-slate-600">·</span>
            {/if}
            temp {$settings.temperature} · max {$settings.maxTokens}
          </footer>
        </div>
      {/each}
    </div>
  </main>
</div>

<SettingsModal bind:open={settingsOpen} />
<QuestionLoader bind:open={questionsOpen} />
