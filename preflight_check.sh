#!/bin/bash
# Run this FIRST, before deploy_jetson.sh, to fail fast (seconds, not hours)
# if something fundamental is wrong. Run from the project root (edgeAI/).
set -u
FAIL=0

check() {
    local desc="$1"; local cmd="$2"
    printf "%-55s" "$desc"
    if eval "$cmd" >/tmp/preflight_out 2>&1; then
        echo "OK"
    else
        echo "FAIL"
        sed 's/^/    /' /tmp/preflight_out
        FAIL=1
    fi
}

echo "== Architecture / Python =="
check "Architecture is aarch64"          "[ \"\$(uname -m)\" = aarch64 ]"
check "python3 is >= 3.10 (faiss-cpu needs it)" \
    "python3 -c 'import sys; assert sys.version_info >= (3,10), sys.version'"

echo
echo "== Network reachability =="
check "Can reach ollama.com"             "curl -fsS -m 8 -o /dev/null https://ollama.com"
check "Can reach huggingface.co"         "curl -fsS -m 8 -o /dev/null https://huggingface.co"
check "Can reach pypi.org"               "curl -fsS -m 8 -o /dev/null https://pypi.org"

echo
echo "== Required project files present =="
check "backend/.env exists"              "[ -f backend/.env ]"
check "backend/requirements.txt exists"  "[ -f backend/requirements.txt ]"
check "data/index/chunks.pkl exists"     "[ -f data/index/chunks.pkl ]"
check "data/index/bm25.pkl exists"       "[ -f data/index/bm25.pkl ]"
check "data/index/faiss.index exists"    "[ -f data/index/faiss.index ]"

echo
echo "== Disk / memory headroom =="
# Real observed baseline on this platform: base container image alone can
# consume ~108-111GB of a 116GB disk, leaving only ~3-5GB headroom. Checking
# '/' (not '.') because home-dir mounts have shown misleading 0-avail readings
# while '/' still had room.
check "At least 1.5GB free on /"          "[ \$(df --output=avail -k / | tail -1) -gt 1500000 ]"

echo
echo "== Reminder =="
echo "This platform gives a FRESH container every booked session (hostname"
echo "changes each time). Nothing persists across sessions except git. Budget"
echo "5-10 min every session for zstd + Ollama install + model pull."

echo
if [ "$FAIL" -eq 1 ]; then
    echo "❌ Preflight FAILED — fix the items above before running deploy_jetson.sh"
    echo "   (This took seconds instead of burning your test window.)"
    exit 1
else
    echo "✅ Preflight passed — safe to run deploy_jetson.sh"
fi
