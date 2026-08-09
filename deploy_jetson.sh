#!/bin/bash
# Single-shot Jetson Orin board deployment for Campus Handbook Bot.
# Run from the project root, inside the board's Web Terminal (edgeai.aiproff.ai
# dashboard -> Open Terminal), after `git pull`:
#
#   chmod +x deploy_jetson.sh
#   ./deploy_jetson.sh
#
# CONFIRMED from real sessions on this platform (AiProff Edge AI Cloud Lab):
# each booked session spins up a FRESH container (hostname changes every
# time). Nothing survives between separately-booked sessions except git and,
# usually, ~/.ollama. Budget a few minutes per session for pip installs.
#
# CONFIRMED: the board's Ollama server is already running externally (see
# OLLAMA_HOST in backend/.env — it's the docker bridge gateway IP, not
# localhost) with all approved models pre-loaded. Do NOT install, serve, or
# `ollama pull` on the board — the official platform doc says so explicitly,
# and this project's own .env already points at the existing service.
set -e

cd "$(dirname "$0")"

wait_for() {
    # wait_for <url> <label> <max_seconds>
    local url="$1" label="$2" max="$3" waited=0
    until curl -sf "$url" -o /dev/null 2>/dev/null; do
        waited=$((waited + 2))
        if [ "$waited" -ge "$max" ]; then
            echo "FAILED: timed out waiting for $label ($url) after ${max}s"
            return 1
        fi
        sleep 2
    done
    echo "OK: $label is up after ${waited}s"
}

# always exits 0 - prints the 'response' field or '' on any failure, so it's
# safe to use in a `set -e` script without extra guarding
extract_response() {
    python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('response', ''))
except Exception:
    print('')
"
}

echo "== Step 0: Preflight checks =="
FAIL=0
[ "$(uname -m)" = "aarch64" ] || { echo "FAILED: architecture is not aarch64"; FAIL=1; }
python3 -c 'import sys; assert sys.version_info >= (3,10)' 2>/dev/null || { echo "FAILED: python3 < 3.10 (faiss-cpu needs it)"; FAIL=1; }
[ -f backend/.env ] || { echo "FAILED: backend/.env missing"; FAIL=1; }
[ -f backend/requirements.txt ] || { echo "FAILED: backend/requirements.txt missing"; FAIL=1; }
for f in chunks.pkl bm25.pkl faiss.index; do
    [ -f "data/index/$f" ] || { echo "FAILED: data/index/$f missing"; FAIL=1; }
done
if [ "$FAIL" -eq 1 ]; then
    echo "Preflight failed - fix the items above before continuing."
    exit 1
fi
echo "OK: preflight passed"

echo
echo "== Step 0.5: Disk hygiene =="
# Real evidence from this platform: containers ship with most of the disk
# already consumed, and ~/.local accumulates multi-GB cruft across sessions
# from stray `pip install --user` runs, which shadows the clean venv copies
# in some execution contexts (uvicorn subprocess) but not others. Wholesale
# removal, not partial. Intentionally NOT touching ~/.ollama - the board's
# model cache lives elsewhere (external service), so nothing here is ours.
pip cache purge >/dev/null 2>&1 || true
rm -rf "$HOME/.cache/pip" 2>/dev/null || true
sudo apt-get clean >/dev/null 2>&1 || apt-get clean >/dev/null 2>&1 || true
if [ -d "$HOME/.local" ]; then
    FREED=$(du -sh "$HOME/.local" 2>/dev/null | cut -f1)
    echo "Removing ~/.local ($FREED) - leftover user-site packages from earlier sessions"
    rm -rf "$HOME/.local"
fi
AVAIL_KB=$(df --output=avail -k / | tail -1)
echo "Free space on /: $((AVAIL_KB / 1024)) MB"
[ "$AVAIL_KB" -lt 1500000 ] && echo "WARNING: less than ~1.5GB free on / - this has caused hard failures before."

echo
echo "== Step 1: Verify the board's existing Ollama (no install/serve/pull) =="
OLLAMA_HOST_VAL=$(grep -E '^OLLAMA_HOST=' backend/.env | tail -1 | cut -d= -f2-)
OLLAMA_HOST_VAL="${OLLAMA_HOST_VAL:-http://172.17.0.1:11434}"
OLLAMA_MODEL_VAL=$(grep -E '^OLLAMA_MODEL=' backend/.env | tail -1 | cut -d= -f2-)
OLLAMA_MODEL_VAL="${OLLAMA_MODEL_VAL:-llama3.2:1b}"
echo "Checking $OLLAMA_HOST_VAL for model $OLLAMA_MODEL_VAL ..."

OLLAMA_OK=0
for i in 1 2 3 4 5; do
    # `|| true` matters here: under `set -e` a bare VAR=$(cmd) assignment
    # aborts the whole script the instant curl fails at the connection level
    # (refused/timeout) - silently, before this loop gets to print anything.
    RESP=$(curl -s "$OLLAMA_HOST_VAL/api/generate" -d "{
      \"model\": \"$OLLAMA_MODEL_VAL\",
      \"prompt\": \"Reply with the single word: OK\",
      \"stream\": false,
      \"options\": { \"num_ctx\": 1024, \"num_gpu\": 1, \"use_mmap\": true }
    }" 2>/dev/null) || RESP=""
    MODEL_REPLY=$(echo "$RESP" | extract_response)
    if [ -n "$MODEL_REPLY" ]; then
        echo "OK: board Ollama responded on attempt $i: $MODEL_REPLY"
        OLLAMA_OK=1
        break
    fi
    echo "attempt $i: no response yet (runner cold-start is normal here), retrying..."
    sleep 2
done

if [ "$OLLAMA_OK" -ne 1 ]; then
    echo
    echo "FAILED: $OLLAMA_HOST_VAL never responded after 5 attempts. Diagnostics:"
    echo "--- registered models ---"
    curl -s "$OLLAMA_HOST_VAL/api/tags" || echo "(unreachable)"
    echo "--- memory ---"
    free -h
    echo "--- gpu ---"
    nvidia-smi 2>/dev/null || echo "(nvidia-smi unavailable in this shell)"
    echo
    echo "This means the board's shared Ollama service itself is down - that's a"
    echo "platform issue, not something to fix by installing a local Ollama."
    echo "Contact your campus ambassador (Mehak Ansari / Madhav Singh / Rohit Ojha)."
    exit 1
fi

echo
echo "== Step 2: Python environment =="
# PYTHONNOUSERSITE prevents Python from also loading ~/.local/lib/pythonX/site-packages,
# which is exactly what caused the .local-vs-.venv import shadowing bug seen on this
# platform (uvicorn subprocess picks up a stale ~/.local copy while `python3 -c` doesn't).
export PYTHONNOUSERSITE=1
export HF_HOME="${HF_HOME:-$PWD/.cache/huggingface}"
mkdir -p "$HF_HOME"

# --system-site-packages is deliberate: JetPack ships an NVIDIA-built torch with
# CUDA/Tegra support baked in. A plain venv would lose that and fall back to a
# generic CPU-only PyPI wheel.
rm -rf .venv
if ! python3 -m venv .venv --system-site-packages 2>/tmp/venv_err; then
    echo "Normal venv creation failed:"; cat /tmp/venv_err
    echo "Trying: apt install python3.10-venv ..."
    (sudo apt-get install -y python3.10-venv || apt-get install -y python3.10-venv) 2>/dev/null || true
    rm -rf .venv
    if ! python3 -m venv .venv --system-site-packages 2>/tmp/venv_err2; then
        echo "Still failing, falling back to --without-pip + get-pip.py bootstrap"
        cat /tmp/venv_err2
        rm -rf .venv
        python3 -m venv .venv --system-site-packages --without-pip
        source .venv/bin/activate
        curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
        python3 /tmp/get-pip.py --no-warn-script-location
    else
        source .venv/bin/activate
    fi
else
    source .venv/bin/activate
fi

echo
echo "== Step 3: Install packages (single source of truth: requirements.txt) =="
pip install --no-user -r backend/requirements.txt

# --system-site-packages exposes Ubuntu's system pytz, which on this Jetson
# image unconditionally reads /usr/share/zoneinfo/tzdata.zi (missing/corrupt
# here) and crashes at import time - pulled in transitively via
# sentence-transformers -> sklearn -> pandas -> pytz. A venv-local pytz
# shadows the broken system one without touching system state.
pip install --no-user -U pytz

echo
echo "== Step 4: Verify no .local contamination =="
python3 -c "
import sentence_transformers, numpy, transformers
for mod in (sentence_transformers, numpy, transformers):
    path = mod.__file__
    assert '.local' not in path, f'{mod.__name__} is loading from .local: {path}'
    print(mod.__name__, '->', path)
print('clean: all imports resolve inside .venv')
"

echo
echo "== Step 5: Rebuild FAISS index natively (avoids any residual numpy/FAISS ABI mismatch) =="
cd backend
python3 - <<'PYEOF'
import pickle
import faiss
import numpy as np
from ingest import embed_model

INDEX_DIR = "../data/index"

with open(f"{INDEX_DIR}/chunks.pkl", "rb") as f:
    chunks = pickle.load(f)

texts = [c["text"] for c in chunks]
embeddings = embed_model.encode(
    texts, convert_to_numpy=True, normalize_embeddings=True
)
embeddings = np.ascontiguousarray(embeddings, dtype=np.float32)

index = faiss.IndexFlatIP(embeddings.shape[1])
index.add(embeddings)
faiss.write_index(index, f"{INDEX_DIR}/faiss.index")
print(f"Done: {index.ntotal} vectors")
PYEOF

echo
echo "== Step 6: Start backend =="
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/uvicorn.log 2>&1 &
if wait_for "http://localhost:8000/health" "Backend" 90; then
    curl http://localhost:8000/health
    echo
    echo "Backend is up. Open http://<jetson-board-ip>:8000 in a browser."
else
    echo "---- last 50 lines of uvicorn log ----"
    tail -n 50 /tmp/uvicorn.log
    exit 1
fi
