#!/bin/bash
# =============================================================================
# demo_day_run.sh - One-command setup + start for Campus Handbook Bot on Jetson
# =============================================================================
# Run this from the project root (/home/codex/edgeAI_RAG) on your booked Jetson
# slot. It handles every step: environment checks, venv activation, backend
# startup, health verification, and a dry-run query.
#
# Usage:
#   chmod +x demo_day_run.sh
#   ./demo_day_run.sh
#
# Prerequisites (already done on this board):
#   - Project cloned from GitHub: https://github.com/Gaurav6174/edgeAI_RAG.git
#   - backend/.env configured with OLLAMA_HOST=http://172.17.0.1:11434
#   - Pre-built index in data/index/ (faiss.index, bm25.pkl, chunks.pkl)
#   - .venv with all Python deps installed
#   - Node.js NOT required (frontend is served by backend/public/dist or API-only)
# =============================================================================
set -euo pipefail

PROJECT_DIR="/home/codex/edgeAI_RAG"
cd "$PROJECT_DIR"

# -----------------------------------------------------------------------------
# Color helpers
# -----------------------------------------------------------------------------
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

# -----------------------------------------------------------------------------
# Step 1: Verify architecture and Python
# -----------------------------------------------------------------------------
echo ""
info "=== Step 1: Environment Check ==="
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ]; then
    ok "Architecture: $ARCH (Jetson confirmed)"
else
    fail "Expected aarch64, got $ARCH"
    exit 1
fi

PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')
PY_OK=$(python3 -c 'import sys; print(sys.version_info >= (3,10))')
if [ "$PY_OK" = "True" ]; then
    ok "Python: $PY_VER (>= 3.10 required)"
else
    fail "Python $PY_VER is too old (need >= 3.10)"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 2: Verify Ollama is running on the board
# -----------------------------------------------------------------------------
info "=== Step 2: Check Ollama Service ==="
OLLAMA_HOST=$(grep '^OLLAMA_HOST=' backend/.env | tail -1 | cut -d= -f2-)
OLLAMA_HOST="${OLLAMA_HOST:-http://172.17.0.1:11434}"
OLLAMA_MODEL=$(grep '^OLLAMA_MODEL=' backend/.env | tail -1 | cut -d= -f2-)
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:1b}"

if curl -sf --max-time 10 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
    ok "Ollama is running at $OLLAMA_HOST"
else
    fail "Ollama is NOT reachable at $OLLAMA_HOST"
    fail "Run jetson_ollama_diagnose.sh for debugging."
    exit 1
fi

# Quick Ollama generate test (model verification)
OLLAMA_TEST=$(curl -s "$OLLAMA_HOST/api/generate" -d "{
    \"model\": \"$OLLAMA_MODEL\",
    \"prompt\": \"Reply with the single word: OK\",
    \"stream\": false,
    \"options\": { \"num_ctx\": 1024, \"num_gpu\": 1, \"use_mmap\": true }
}" 2>/dev/null)

OLLAMA_REPLY=$(echo "$OLLAMA_TEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('response',''))" 2>/dev/null)
if [ -n "$OLLAMA_REPLY" ]; then
    ok "Ollama model '$OLLAMA_MODEL' is responding"
else
    warn "Ollama responded but no reply text — may be cold-starting"
    warn "(First call may fail if GPU context is cold-starting - this is normal)"
fi

# -----------------------------------------------------------------------------
# Step 3: Verify required files exist
# -----------------------------------------------------------------------------
info "=== Step 3: Verify Project Files ==="
for f in backend/.env backend/requirements.txt \
         data/index/faiss.index data/index/bm25.pkl data/index/chunks.pkl; do
    if [ -f "$f" ]; then
        ok "Found: $f"
    else
        fail "Missing: $f"
        exit 1
    fi
done

# Check venv
if [ -f ".venv/bin/python3" ]; then
    ok "Virtual environment exists at .venv/"
else
    fail "Virtual environment not found. Run:"
    fail "  python3 -m venv .venv --system-site-packages"
    fail "  . .venv/bin/activate && pip install -r backend/requirements.txt"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 4: Verify imports resolve inside venv (not from ~/.local)
# -----------------------------------------------------------------------------
info "=== Step 4: Verify venv imports ==="
PYTHONNOUSERSITE=1 .venv/bin/python3 -c "
import sentence_transformers, faiss, sklearn, numpy
for mod in (sentence_transformers, faiss, sklearn, numpy):
    path = mod.__file__
    assert '.local' not in path, f'{mod.__name__} is loading from .local: {path}'
    print(f'  {mod.__name__:25s} -> {path}')
print('All imports resolve inside .venv (no .local contamination)')
" 2>&1 | grep -v "UserWarning" | grep -v "warnings.warn"

# -----------------------------------------------------------------------------
# Step 5: Stop any existing backend process on port 8000
# -----------------------------------------------------------------------------
info "=== Step 5: Stop existing backend (if any) ==="
# Kill by PID file first, then by process name (portable: no lsof needed)
if [ -f /tmp/backend_pid.txt ]; then
    OLD_PID=$(cat /tmp/backend_pid.txt)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        warn "Killing existing backend (PID: $OLD_PID from PID file)"
        kill "$OLD_PID" 2>/dev/null || true
        sleep 2
    fi
    rm -f /tmp/backend_pid.txt
fi
# Also check if port 8000 responds (health check)
if curl -sf --max-time 2 http://localhost:8000/health >/dev/null 2>&1; then
    warn "Backend still responding on port 8000, killing uvicorn processes..."
    pkill -f "uvicorn main:app" 2>/dev/null || true
    sleep 2
fi
if curl -sf --max-time 2 http://localhost:8000/health >/dev/null 2>&1; then
    fail "Port 8000 is still in use — manual cleanup needed"
    exit 1
else
    ok "Port 8000 is free"
fi

# -----------------------------------------------------------------------------
# Step 6: Start the backend server
# -----------------------------------------------------------------------------
info "=== Step 6: Start Backend ==="
echo "  Starting uvicorn on 0.0.0.0:8000..."

# CRITICAL: Use absolute path to venv python + PYTHONNOUSERSITE=1
# The venv lives at PROJECT_DIR/.venv, NOT in backend/.venv
# uvicorn must run from backend/ so 'main' module is importable
cd backend
PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
    "$PROJECT_DIR/.venv/bin/python3" -m uvicorn main:app \
    --host 0.0.0.0 --port 8000 \
    > /tmp/uvicorn_demo.log 2>&1 &
cd "$PROJECT_DIR"
BACKEND_PID=$!
echo "$BACKEND_PID" > /tmp/backend_pid.txt
echo "  Backend PID: $BACKEND_PID"

# -----------------------------------------------------------------------------
# Step 7: Wait for backend to be healthy
# -----------------------------------------------------------------------------
info "=== Step 7: Wait for Backend Health ==="
echo "  (This may take 30-60s for model loading on first start)"
HEALTHY=0
for i in $(seq 1 60); do
    if curl -sf --max-time 2 http://localhost:8000/health >/dev/null 2>&1; then
        HEALTHY=1
        break
    fi
    sleep 2
done

if [ "$HEALTHY" -eq 1 ]; then
    ok "Backend is healthy!"
    curl -s http://localhost:8000/health | python3 -m json.tool 2>/dev/null
else
    fail "Backend did not become healthy within 120s"
    fail "Check logs: tail -50 /tmp/uvicorn_demo.log"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 8: Dry-run test queries
# -----------------------------------------------------------------------------
info "=== Step 8: Dry-Run Test Queries ==="
QUERY="what is the Code of Student Conduct"
echo "  Query: '$QUERY'"
echo "  Response:"
curl -s --max-time 120 "http://localhost:8000/query" \
    -X POST -H "Content-Type: application/json" \
    -d "{\"question\": \"$QUERY\"}" 2>&1
echo ""
echo ""

# Citations check
echo "  Citations:"
curl -s --max-time 30 "http://localhost:8000/citations?question=what+is+the+Code+of+Student+Conduct" \
    | python3 -m json.tool 2>/dev/null | head -20

# -----------------------------------------------------------------------------
# Step 9: Summary
# -----------------------------------------------------------------------------
echo ""
ok "=== Campus Handbook Bot is RUNNING ==="
echo "  API:       http://localhost:8000"
echo "  Health:    http://localhost:8000/health"
echo "  API docs:  http://localhost:8000/docs"
echo "  Frontend:  http://localhost:8000 (if public/dist/ exists)"
echo "  Backend PID: $BACKEND_PID (logs: /tmp/uvicorn_demo.log)"
echo ""
echo "To stop the backend: kill $BACKEND_PID"
echo "To test more: curl http://localhost:8000/citations?question='...'"
