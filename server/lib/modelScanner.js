import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../config.js';

/** List any depth (cap) avoids runaway dirs under models/. */
const MAX_SCAN_DEPTH = 12;
const MAX_FILES = 500;

/** Multimodal projector shards from Hugging Face trees — not runnable as the main LM. */
function isLanguageModelGgufBasename(filename) {
  const b = filename.toLowerCase();
  if (b.startsWith('mmproj')) return false;
  return true;
}

/**
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, path: string, sizeGb: number }>>}
 */
export async function scanModels(dir) {
  const modelsDir = path.resolve(dir || getConfig().modelsDir);
  /** @type {{ d: string, depth: number }[]} */
  const queue = [{ d: modelsDir, depth: 0 }];
  const out = [];

  while (queue.length && out.length < MAX_FILES) {
    const { d, depth } = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth + 1 <= MAX_SCAN_DEPTH) queue.push({ d: full, depth: depth + 1 });
        continue;
      }
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.gguf')) continue;
      if (!isLanguageModelGgufBasename(e.name)) continue;
      try {
        const st = await fs.stat(full);
        const rel = path.relative(modelsDir, full).replace(/\\/g, '/') || e.name;
        out.push({
          name: rel,
          path: full,
          sizeGb: Math.round((st.size / 1e9) * 10) / 10
        });
      } catch {
        /* skip unreadable */
      }
    }
  }

  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
