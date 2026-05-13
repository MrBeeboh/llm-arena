/**
 * @param {number} n
 */
export function formatGb(n) {
  if (n == null || Number.isNaN(n)) return '';
  return `${n} GB`;
}

/**
 * @param {Record<string, number>} scores
 */
export function formatScoresLine(scores) {
  return Object.entries(scores || {})
    .map(([k, v]) => `${k}:${v}`)
    .join('  ');
}
