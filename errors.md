# Errors & Fixes — Campus Handbook Bot on NVIDIA Jetson Orin

> This document records every issue encountered during deployment to the Jetson Orin
> board (aarch64, JetPack, edgeai.aiproff.ai booked slot) and the fix applied.
> Read this before your demo day run to avoid repeating these mistakes.

---

## 1. Venv not activated in backend script (silent failure)

### Symptom

The backend starts but immediately exits. No server listens on port 8000.
The `/tmp/uvicorn.log` shows:

```
File "/home/codex/.local/lib/python3.10/site-packages/sentence_transformers/__init__.py"
FileNotFoundError: /usr/share/zoneinfo/tzdata.zi
```

### Root Cause

The startup command in `deploy_jetson.sh` and `preflight_check.sh` uses:

```bash
. .venv/bin/activate && python3 -m uvicorn main:app ...
```

This assumes the **current working directory** is the project root where `.venv/`
lives. When the script is run from `backend/` (or the working directory is
`backend/`), `.venv/bin/activate` resolves to `backend/.venv/bin/activate`
which **does not exist**. The `.` (source) command fails silently, and `python3`
falls back to the **system Python** at `/usr/bin/python3`. The system Python
loads packages from `~/.local/lib/python3.10/site-packages/` (user site) and
`/usr/local/lib/python3.10/dist-packages/` (system site), which are **different**
from the venv packages — leading to version conflicts and missing dependencies.

### Fix

Always use the **absolute path** to the venv's Python interpreter:

```bash
PYTHONNOUSERSITE=1 /home/codex/edgeAI_RAG/.venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

The `PYTHONNOUSERSITE=1` environment variable prevents Python from adding
`~/.local/lib/python3.10/site-packages/` to `sys.path`, which eliminates
.venv-vs-.local import shadowing entirely.

### How to Avoid

- Never use relative `. .venv/bin/activate` when `workdir` may differ from
  the project root. Always `cd "$PROJECT_DIR"` first.
- Use the absolute path to the venv Python: `$PROJECT_DIR/.venv/bin/python3`.
- Set `PYTHONNOUSERSITE=1` on every Python invocation.
- Add this check after activation:
  ```python
  import sentence_transformers
  assert '.local' not in sentence_transformers.__file__, "Import is loading from .local!"
  ```

---

## 2. pytz/tzdata missing `/usr/share/zoneinfo/tzdata.zi`

### Symptom

Importing `sentence_transformers` fails with:

```
File ".../pytz/__init__.py", line 29, in _read_olson_version
    with tzdata_zi.open(encoding="utf-8") as tzdata_zi_file:
FileNotFoundError: [Errno 2] No such file or directory:
  '/usr/share/zoneinfo/tzdata.zi'
```

### Root Cause

The venv was created with `--system-site-packages`, which means system-installed
packages (pandas, pytz, scipy) from `/usr/lib/python3/dist-packages/` are visible.
The system's `pytz` (version 2022.1) calls `_read_olson_version()` at import time,
which reads `/usr/share/zoneinfo/tzdata.zi`. This file is provided by the
`tzdata` system package, which is **not installed** on the Jetson container image.

Even though no Python packages exist in `~/.local/`, the **system** pytz is
loaded (via `--system-site-packages`), and it crashes on the missing file.

### Fix

Install a newer `pytz` **inside the venv** so it takes precedence over the system
version:

```bash
. .venv/bin/activate
pip install --no-user --ignore-installed pytz
```

The `--ignore-installed` flag is critical: without it, pip sees the system
pytz in the path and reports "Requirement already satisfied" without installing
it in the venv.

As a belt-and-suspenders approach, also install the `tzdata` Python package:

```bash
pip install --no-user tzdata
```

### How to Avoid

- Create the venv with `--system-site-packages` only when you truly need system
  torch (for GPU). Otherwise, create a clean venv: `python3 -m venv .venv`.
- After creating the venv, always verify import paths:
  ```python
  import pytz; print(pytz.__file__)
  # Must show .venv/... not /usr/lib/python3/dist-packages/...
  ```
- If `--system-site-packages` is needed, install all packages that have
  system-level dependencies (pytz, pandas, scipy) **in the venv** to shadow
  the broken system versions.

---

## 3. Node.js version too old for Vite 8 (frontend build failure)

### Symptom

```
> vite build
You are using Node.js 18.20.8. Vite requires Node.js version 20.19+ or 22.12+.
```

Followed by:

```
Error: Cannot find native binding.
Cannot find module '@rolldown/binding-linux-arm64-gnu'
```

### Root Cause

Two compounding issues:
1. The system Node.js is v18.20.8, but Vite 8 requires Node v20.19+ or v22.12+.
2. `npm install` was run with Node 18, so the optional native dependency
   `@rolldown/binding-linux-arm64-gnu` (a platform-specific binary) was not
   downloaded. The npm bug referenced in the error
   (https://github.com/npm/cli/issues/4828) causes optional dependencies to
   be skipped under certain conditions.

### Fix (for reference — frontend is optional for demos)

Download a prebuilt Node.js 22 for aarch64:

```bash
cd /tmp
curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-arm64.tar.xz -o node22.tar.xz
tar -xf node22.tar.xz
export PATH="/tmp/node-v22.14.0-linux-arm64/bin:$PATH"
```

Then clean and reinstall:

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
cp -r dist/ ../backend/public/
```

### How to Avoid

- Check Node.js version before starting: `node --version` (needs >= 20.19).
- Always install npm dependencies with the **same** Node.js version you'll
  use to build. Mismatched versions cause native binding failures.
- Add to `.nvmrc` or note in README: `engine: ">=20.19.0"`.
- For demo day: the frontend is **not required**. The FastAPI backend serves
  the UI only if `backend/public/dist/` exists. The API works perfectly
  without it. Focus on the backend.

---

## 4. numpy / scipy version mismatch warning

### Symptom

```
UserWarning: A NumPy version >=1.17.3 and <1.25.0 is required for this
version of SciPy (detected version 1.26.4)
```

### Root Cause

The venv (created with `--system-site-packages`) has:
- numpy 1.26.4 (installed by sentence-transformers from PyPI)
- scipy from system packages (at `/usr/lib/python3/dist-packages/scipy/`)
  which was compiled against numpy < 1.25.0

The venv's numpy (1.26.4) supersedes the system numpy, but the system's scipy
was compiled against an older numpy ABI.

### Impact

**Cosmetic only.** This is a `UserWarning`, not an error. The RAG pipeline
(embedding, FAISS search, cross-encoder reranking, Ollama API calls) does not
use scipy directly. sentence-transformers uses torch, not scipy.

### Fix (optional)

If you want to silence the warning, install a compatible scipy in the venv:

```bash
pip install --no-user "scipy>=1.13.0"
```

Or, pin numpy to a compatible version:

```bash
pip install --no-user "numpy>=1.17.3,<1.25.0"
```

### How to Avoid

- Use `--system-site-packages` only when system torch with CUDA is needed.
- If CPU-only inference is acceptable (which it is for this project — the LLM
  runs in Ollama, not in Python), create a clean venv without system packages:
  `python3 -m venv .venv` (no `--system-site-packages`).
- Add `numpy==1.26.4` and a compatible `scipy` to `requirements.txt`.

---

## 5. Ollama cold-start timeout on first generate call

### Symptom

```
Connection Error: ... ReadTimeoutError: HTTPConnectionPool(host='172.17.0.1', port=11434):
Read timed out. (read timeout=30)
```

### Root Cause

The Ollama server on the Jetson runs the Llama 3.2 1B model. When the board has
been idle, the GPU context is unloaded to save memory. The first
`POST /api/generate` call triggers a GPU context cold-start which takes >30
seconds. A single short timeout (e.g., 30s) will result in a `ReadTimeout`.

### Fix

The backend's `llm.py` already handles this with two mechanisms:

1. **Retry logic**: 3 attempts with 2-second delays between retries.
2. **Long timeout**: `requests.post(..., timeout=120)` — 120 seconds.

The `deploy_jetson.sh` script also pre-warms the model with a test call before
starting the backend. The `jetson_setup_track2.sh` script retries 5 times.

For manual testing, always use a generous timeout:

```python
requests.post(API_URL, json=payload, timeout=120)
```

### How to Avoid

- Never use `timeout=30` for Ollama generate calls on the Jetson.
- Always wrap Ollama calls with retry logic (at least 3 attempts).
- Run the Ollama pre-warm test before starting the backend:
  ```bash
  curl -s http://172.17.0.1:11434/api/generate \
    -d '{"model":"llama3.2:1b","prompt":"OK","stream":false,
         "options":{"num_ctx":1024,"num_gpu":1,"use_mmap":true}}'
  ```
- On demo day, do a full dry run at least 3 times before the actual demo slot.

---

## 6. CONFIDENCE_THRESHOLD set to 0.0 (all queries bypass gate)

### Symptom

Queries with very low relevance scores still get answered by the LLM, sometimes
with hallucinated or generic responses.

### Root Cause

The `.env` file in the project root (`backend/.env`) has:

```
CONFIDENCE_THRESHOLD=0.0
```

The README recommends `0.35`. With `0.0`, any cross-encoder score >= 0 passes
the confidence gate, which means almost all queries reach the LLM. The
cross-encoder `ms-marco-MiniLM-L-6-v2` outputs raw relevance scores that are
often negative for poor matches and positive (0–15+) for good matches. A
threshold of 0.0 allows borderline matches through.

### Fix

This was intentionally left at `0.0` for maximum recall during development and
testing. For a production-quality demo where hallucination prevention matters:

```bash
# In backend/.env
CONFIDENCE_THRESHOLD=0.35
```

With 0.35, queries below this relevance score return "I couldn't find this in
the handbook." instead of calling the LLM.

### How to Avoid

- Review `backend/.env` before demo day and set `CONFIDENCE_THRESHOLD=0.35`
  if you want stricter answer gating.
- Check the `/citations` endpoint before `/query` to see the confidence score.
- Use specific, answerable questions (e.g., "what is the Code of Student
  Conduct") rather than vague ones ("what is the handbook about").

---

## Quick Reference: Files to Check Before Demo Day

| File | What to verify |
|------|---------------|
| `backend/.env` | `OLLAMA_HOST`, `OLLAMA_MODEL`, `CONFIDENCE_THRESHOLD` |
| `.venv/bin/python3` | Exists and can import `faiss`, `sentence_transformers` |
| `data/index/chunks.pkl` | Pre-built index exists (160 chunks for this handbook) |
| `deploy_jetson.sh` | Run from project root, not from `backend/` |
| `/tmp/uvicorn_demo.log` | Check if backend crashed |

## Quick Reference: Commands for Demo Day

```bash
# 1. Health check
curl -s http://localhost:8000/health | python3 -m json.tool

# 2. Ask a question (Ollama 120s timeout)
curl -s --max-time 120 http://localhost:8000/query \
  -X POST -H "Content-Type: application/json" \
  -d '{"question": "what is the Code of Student Conduct"}'

# 3. Check citations
curl -s "http://localhost:8000/citations?question=what+is+the+Code+of+Student+Conduct" \
  | python3 -m json.tool

# 4. View backend logs
tail -50 /tmp/uvicorn_demo.log

# 5. Stop backend
kill $(cat /tmp/backend_pid.txt)
```
