import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'arena_settings';

/** @typedef {{
 *   id: string,
 *   name: string,
 *   protocol: 'openai' | 'anthropic',
 *   baseUrl: string,
 *   apiKey: string,
 *   defaultModel: string,
 *   knownModels: string,
 *   signupUrl?: string,
 *   notes?: string
 * }} CloudProvider
 */

/** @returns {CloudProvider[]} */
export function defaultCloudProviders() {
  return [
    {
      id: 'xai',
      name: 'xAI (Grok)',
      protocol: 'openai',
      baseUrl: 'https://api.x.ai/v1',
      apiKey: '',
      defaultModel: 'grok-4-1-fast-non-reasoning',
      knownModels: 'grok-4-1-fast-non-reasoning, grok-4-1-fast-reasoning, grok-3',
      signupUrl: 'https://console.x.ai',
      notes: 'OpenAI-compatible. Get a key at console.x.ai → API Keys.'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      defaultModel: 'gpt-4o-mini',
      knownModels: 'gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o3-mini',
      signupUrl: 'https://platform.openai.com/api-keys',
      notes: 'platform.openai.com → API keys.'
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      defaultModel: 'claude-sonnet-4-20250514',
      knownModels:
        'claude-sonnet-4-20250514, claude-opus-4-20250514, claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022',
      signupUrl: 'https://console.anthropic.com/settings/keys',
      notes: 'Native messages API; system messages handled automatically.'
    }
  ];
}

const defaults = {
  llamaServerBin: '',
  llamaPort: 8080,
  loadTimeoutSec: 600,
  ctxSize: 8192,
  maxTokens: 1024,
  temperature: 0.7,
  cloudProviders: defaultCloudProviders(),
  apiKeys: {
    xai: '',
    openai: '',
    anthropic: ''
  }
};

/**
 * Build cloudProviders from older saved data so existing users do not lose configuration.
 * @param {any} legacy
 * @returns {CloudProvider[]}
 */
function migrateProviders(legacy) {
  if (Array.isArray(legacy?.cloudProviders) && legacy.cloudProviders.length) {
    return legacy.cloudProviders.map((p) => ({
      id: String(p.id || '').trim(),
      name: String(p.name || p.id || ''),
      protocol: p.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: String(p.baseUrl || ''),
      apiKey: String(p.apiKey || ''),
      defaultModel: String(p.defaultModel || ''),
      knownModels: String(p.knownModels || ''),
      signupUrl: p.signupUrl ? String(p.signupUrl) : undefined,
      notes: p.notes ? String(p.notes) : undefined
    }));
  }
  const built = defaultCloudProviders();
  const legacyKeys = legacy?.apiKeys || {};
  for (const p of built) {
    if (typeof legacyKeys[p.id] === 'string' && legacyKeys[p.id]) p.apiKey = legacyKeys[p.id];
  }
  return built;
}

function read() {
  if (!browser) return { ...defaults, cloudProviders: defaultCloudProviders() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults, cloudProviders: defaultCloudProviders() };
    const p = JSON.parse(raw);
    const cloudProviders = migrateProviders(p);
    const apiKeys = { ...defaults.apiKeys, ...(p.apiKeys || {}) };
    for (const prov of cloudProviders) {
      if (prov.id in apiKeys && prov.apiKey) apiKeys[prov.id] = prov.apiKey;
    }
    return {
      ...defaults,
      ...p,
      cloudProviders,
      apiKeys
    };
  } catch {
    return { ...defaults, cloudProviders: defaultCloudProviders() };
  }
}

export const settings = writable(read());

settings.subscribe((v) => {
  if (!browser) return;
  localStorage.setItem(KEY, JSON.stringify(v));
});

export function updateSettings(patch) {
  settings.update((s) => ({ ...s, ...patch }));
}

/** @param {string} id @returns {CloudProvider | undefined} */
export function findProviderById(list, id) {
  return list?.find?.((p) => p.id === id);
}

/** Parse "a, b, c" or "a\nb\nc" into an array of trimmed non-empty tokens. */
export function splitCsvList(s) {
  return String(s || '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
