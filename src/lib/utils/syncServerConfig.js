import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings.js';

/** Push local Settings (llama path, port, load timeout) to the Arena API so processManager matches the UI. */
export async function syncServerConfigFromSettings() {
  const s = get(settings);
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llamaServerBin: s.llamaServerBin,
        llamaPort: s.llamaPort,
        loadTimeoutMs: Math.max(30_000, (s.loadTimeoutSec ?? 600) * 1000)
      })
    });
    if (!res.ok) {
      console.warn('syncServerConfigFromSettings:', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('syncServerConfigFromSettings failed', e);
  }
}
