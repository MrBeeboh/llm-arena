/**
 * @param {(data: Record<string, unknown>) => void} onEvent
 * @param {(err: Event) => void} [onError]
 */
export function openSequencerStream(onEvent, onError) {
  const es = new EventSource('/api/sequencer/stream');
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      onEvent(data);
    } catch {
      /* ignore parse errors */
    }
  };
  es.onerror = (err) => {
    onError?.(err);
  };
  return () => {
    es.close();
  };
}
