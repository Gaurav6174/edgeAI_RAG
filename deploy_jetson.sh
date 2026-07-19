#!/bin/bash
# Run from the project root (edgeAI/). Run preflight_check.sh first.
#
# CONFIRMED from a real deployment log on this exact platform (AiProff Edge AI
# Cloud Lab): each booked session spins up a FRESH container (different
# hostname every time — e.g. 988cf0530c3f, 441b38050c99, df89f984559e...).
# Nothing survives between separately-booked sessions except what's in git.
# Budget ~5-10 minutes of every session for zstd + Ollama install + model pull
# — there is no way to skip this by caching across sessions on this platform.
set -e

# PYTHONNOUSERSITE prevents Python from also loading ~/.local/lib/pythonX/site-packages.
# Root cause of the single biggest time-sink in the real deployment log: stray
# `pip install --user` runs (from earlier troubleshooting) left a second,
# conflicting numpy/sentence-transformers/transformers in ~/.local, which
# shadowed the clean venv copies in some execution contexts (uvicorn subprocess)
# but not others (interactive `python3 -c`) — same bug, looked like two bugs.
export PYTHONNOUSERSITE=1

# Cache dirs are only useful for reruns *within* the same session — see the
# ephemeral-container note above. Still worth setting so a retry after a
# crash doesn't re-download inside the same booking.
export HF_HOME="${HF_HOME:-$PWD/.cache/huggingface}"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$PWD/.cache/ollama}"
mkdir -p "$HF_HOME" "$OLLAMA_MODELS"

wait_for() {
    # wait_for <url> <label> <max_seconds>
    local url="$1" label="$2" max="$3" waited=0
    until curl -sf "$url" -o /dev/null 2>/dev/null; do
        waited=$((waited + 2))
        if [ "$waited" -ge "$max" ]; then
            echo "❌ Timed out waiting for $label ($url) after ${max}s"
            return 1
        fi
        sleep 2
    done
    echo "✅ $label is up after ${waited}s"
}

echo "== Step 0: Sanity checks =="
[ -f backend/.env ] || { echo "❌ backend/.env missing — copy it before continuing."; exit 1; }
[ -f data/index/chunks.pkl ] || { echo "❌ data/index/chunks.pkl missing — copy your prebuilt index files (they're gitignored) before continuing."; exit 1; }
PYVER=$(python3 -c 'import sys; print(sys.version_info[:2]>=(3,10))')
[ "$PYVER" = "True" ] || { echo "❌ python3 is older than 3.10 — faiss-cpu==1.14.2 will not install."; exit 1; }

echo "== Step 0.5: Disk hygiene =="
# Real log evidence: this platform's containers ship with ~108-111GB already
# consumed by the base image, leaving only ~3-5GB headroom. "No space left on
# device" killed a whole session in the past. Clean proactively, don't wait
# for the error.
pip cache purge >/dev/null 2>&1 || true
rm -rf "$HOME/.cache/pip" 2>/dev/null || true
sudo apt-get clean >/dev/null 2>&1 || apt-get clean >/dev/null 2>&1 || true
# Confirmed on real hardware: ~/.local accumulates to multiple GB (torch,
# numpy, sentence-transformers, transformers, sklearn from old `pip install
# --user` runs across earlier sessions) and has zero legitimate use in this
# workflow — it's the exact source of the .local-vs-.venv import shadowing
# bug documented in the deployment log. Wholesale removal, not partial.
if [ -d "$HOME/.local" ]; then
    FREED=$(du -sh "$HOME/.local" 2>/dev/null | cut -f1)
    echo "Removing ~/.local ($FREED) — leftover user-site packages from earlier sessions"
    rm -rf "$HOME/.local"
fi
# NOTE: intentionally NOT touching ~/.ollama — pulled models cache there and
# storage has been observed to persist across session bookings, so it may
# already contain llama3.2:1b from a previous session.
AVAIL_KB=$(df --output=avail -k / | tail -1)
echo "Free space on /: $((AVAIL_KB / 1024)) MB"
if [ "$AVAIL_KB" -lt 1500000 ]; then
    echo "⚠️  Less than ~1.5GB free on / — this has caused hard failures before."
    echo "    Consider: sudo apt-get autoremove -y; rm -rf ~/.cache/* (except HF_HOME/OLLAMA_MODELS above)"
fi

echo "== Step 1: Install zstd =="
sudo apt-get update && sudo apt-get install -y zstd

echo "== Step 2: Install Ollama =="
curl -fsSL https://ollama.com/install.sh | sh

echo "== Step 3: Start Ollama =="
ollama serve > /tmp/ollama.log 2>&1 &
wait_for "http://localhost:11434" "Ollama server" 30

echo "== Step 4: Pull model =="
if ollama list 2>/dev/null | grep -q 'llama3.2:1b'; then
    echo "llama3.2:1b already cached — skipping download"
else
    ollama pull llama3.2:1b
fi

echo "== Step 5: Setup Python =="
# --system-site-packages is deliberate and confirmed necessary: JetPack ships
# an NVIDIA-built torch (seen in the real log as torch==2.5.0a0+...nv24.08)
# with CUDA/Tegra support. A plain venv would lose that and fall back to a
# generic CPU-only PyPI wheel.
# Real failure mode hit on this platform: "ensurepip is not available" because
# python3.10-venv isn't installed and the base image is partially read-only.
# Try the normal path first, fall back to a pip-less venv + manual bootstrap
# rather than aborting the whole run.
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

echo "== Step 6: Install packages (single source of truth: requirements.txt) =="
pip install --no-user -r backend/requirements.txt

echo "== Step 6.5: Verify no .local contamination =="
python3 -c "
import sentence_transformers, numpy, transformers
for mod in (sentence_transformers, numpy, transformers):
    path = mod.__file__
    assert '.local' not in path, f'{mod.__name__} is loading from .local: {path}'
    print(mod.__name__, '->', path)
print('clean: all imports resolve inside .venv')
"

echo "== Step 7: Rebuild FAISS index natively (avoids any residual numpy/FAISS ABI mismatch) =="
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

echo "== Step 8: Start backend =="
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/uvicorn.log 2>&1 &
if wait_for "http://localhost:8000/health" "Backend" 90; then
    curl http://localhost:8000/health
else
    echo "---- last 50 lines of uvicorn log ----"
    tail -n 50 /tmp/uvicorn.log
    exit 1
fi
