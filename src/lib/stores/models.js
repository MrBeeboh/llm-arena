import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const ROLES_KEY = 'arena_roles';

/** @typedef {{ name: string, path: string, sizeGb: number }} ModelInfo */

function loadRoles() {
  const empty = {
    A: { model: null },
    B: { model: null },
    C: { model: null },
    D: { model: null },
    judge: {
      type: /** @type {'local'|'cloud'} */ ('local'),
      model: null,
      /** Reference into settings.cloudProviders[].id */
      cloudProviderId: 'xai',
      /** Free-text model id; UI suggests known models but does not constrain */
      cloudModel: ''
    }
  };
  if (!browser) return empty;
  try {
    const raw = localStorage.getItem(ROLES_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const legacy = parsed.judge?.cloudProvider;
    const cloudProviderId =
      parsed.judge?.cloudProviderId ||
      (typeof legacy === 'string' && legacy ? legacy : 'xai');
    return {
      ...empty,
      ...parsed,
      judge: {
        ...empty.judge,
        ...parsed.judge,
        cloudProviderId,
        cloudModel: parsed.judge?.cloudModel || ''
      }
    };
  } catch {
    return empty;
  }
}

export const availableModels = writable(/** @type {ModelInfo[]} */ ([]));
export const loadedModelPath = writable(/** @type {string | null} */ (null));
export const processStatus = writable(/** @type {string} */ ('idle'));

export const roles = writable(loadRoles());

roles.subscribe((v) => {
  if (!browser) return;
  localStorage.setItem(ROLES_KEY, JSON.stringify(v));
});

export const modelsLoading = writable(false);

export const modelsDirectory = writable(/** @type {string} */ (''));

export async function refreshModels() {
  modelsLoading.set(true);
  try {
    const r = await fetch('/api/models');
    const j = await r.json();
    availableModels.set(j.available || []);
    if (j.modelsDir) modelsDirectory.set(j.modelsDir);
    loadedModelPath.set(j.process?.currentModel ?? null);
    processStatus.set(j.process?.status ?? 'idle');
    return j;
  } finally {
    modelsLoading.set(false);
  }
}
