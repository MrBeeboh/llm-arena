# Arena

Standalone **LLM Arena** for sequential model competitions against a local [llama.cpp](https://github.com/ggerganov/llama.cpp) `llama-server` (SYCL / Intel Arc). The app loads **one GGUF at a time** — spawn, infer, unload, repeat.

## Requirements

- Node.js 20+
- Built `llama-server` (paths in `.env.example`)
- GGUF files in `./models/`

## Setup

```bash
cd "/home/mike/Documents/Coding Projects/New Arena"
npm install
cp .env.example .env
# Edit .env: LLAMA_BIN, optional JUDGE_API_KEY for cloud judge
```

Copy models:

```bash
cp /path/to/*.gguf ./models/
```

## Development

Runs the Fastify API on port **5175** (or `PORT`) and Vite on **5173** with `/api` proxied to the API.

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Do **not** start `llama-server` manually; Arena starts it per phase.

### Desktop shortcut (`desktop/Arena.desktop`)

The launcher script runs **`npm run dev` in the background** (no terminal window) and opens the UI after a short delay. Logs go to **`.arena-dev.log`** in the project root; the process id is stored in **`.arena-dev.pid`**. If the app is already running, double-clicking only opens the browser again.

## Production

```bash
npm run build
npm start
```

Serves the static SPA and `/api` from the same process on `PORT` (default 5175).

## If you see `llama-server failed to become ready within timeout`

1. **Binary path** — In **Settings**, set **llama-server binary** to the real path of `llama-server` (must match your build: SYCL, CUDA, CPU, etc.).
2. **Intel Arc / SYCL** — Source `setvars.sh` before `npm run dev` (or use `scripts/launch-arena.sh`). For SYCL-looking `llama-server` paths, Arena sets `ONEAPI_DEVICE_SELECTOR=level_zero:gpu` when the parent env left it unset (fixes many `ggml_sycl_init` / `select_device` failures under Cursor/systemd). Override with `ARENA_ONEAPI_DEVICE_SELECTOR` or `ARENA_SYCL_DEFAULT_DEVICE_SELECTOR` (e.g. `opencl:gpu`), or set `ARENA_SYCL_SKIP_DEVICE_SELECTOR=1` to leave it unset. Strip `SYCL_DEVICE_FILTER` on the child unless `ARENA_NO_SYCL_ENV=1`. Non-SYCL binaries: `ARENA_NO_SYCL_ENV=1`.
3. **Long loads** — Large GGUFs can take several minutes. Increase **Model load timeout** in Settings (or `LOAD_TIMEOUT_MS` in `.env`). The server default is **600s**; errors append a short tail of **llama-server stderr** when available.
4. **Logs** — Run the API with `DEBUG_LLAMA=1` to print llama-server stdout/stderr to the terminal.

## If `sycl-ls` shows the GPU but SYCL init still fails

- **Rebuild `llama-server`** against the same oneAPI release that is installed now. A binary linked to an older `libsycl` while the loader picks `/opt/intel/oneapi/compiler/…/libsycl.so.*` from a newer toolkit is a common source of opaque `ggml_sycl_init` / “no device” style failures.
- **Sanity check:** after `source setvars`, run `ldd "$(which llama-server)"` (or on your full path to the binary) and confirm `libsycl` resolves where you expect.
- **Compute stack vs kernel:** on recent kernels (e.g. 6.17) keep **Level Zero** / **OpenCL** user-space packages in sync with the GPU driver (e.g. distro packages such as `intel-level-zero-gpu`, `intel-opencl-icd`). `sycl-ls` can list a device while queue creation still fails if that stack lags.

## GPU monitoring

```bash
watch -n1 intel_gpu_top
```
