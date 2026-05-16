import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const config = {
  llamaServerBin: process.env.LLAMA_BIN || '',
  llamaPort: parseInt(process.env.LLAMA_PORT || '8080', 10),
  modelsDir: process.env.MODELS_DIR || path.join(rootDir, 'models'),
  port: parseInt(process.env.PORT || '5175', 10),
  loadTimeoutMs: parseInt(process.env.LOAD_TIMEOUT_MS || '600000', 10),
  judgeBaseUrl: process.env.JUDGE_BASE_URL || 'https://api.x.ai/v1',
  judgeModel: process.env.JUDGE_MODEL || 'grok-3-fast',
  judgeApiKey: process.env.JUDGE_API_KEY || ''
};

/** @param {Partial<typeof config>} patch */
export function mergeRuntimeConfig(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) config[k] = v;
  }
}

export function getConfig() {
  return config;
}

/** Safe for `GET`/`POST` responses — never expose `judgeApiKey`. */
export function getConfigForClient() {
  return { ...config, judgeApiKey: config.judgeApiKey ? '***' : '' };
}

export default config;
