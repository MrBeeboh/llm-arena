/**
 * In dev, large multipart uploads should hit the API port directly (Vite proxy can choke on huge bodies).
 * @param {string} path e.g. '/api/models/import'
 */
export function apiUrl(path) {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.port === '5173') {
    return `http://${window.location.hostname}:5175${path}`;
  }
  return path;
}
