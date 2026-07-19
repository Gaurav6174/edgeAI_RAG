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
# Observed pattern on this platform: the container hostname resets every
# booked session, but the underlying storage (home dir, ~/.ollama, caches)
# appears to persist across bookings. A fresh-looking session that's already
# low on disk usually means leftover cruft from earlier attempts, not a new
# problem. Printing full diagnostics here instead of a bare pass/fail so it's
# immediately actionable.
df -h / 2>/dev/null | tail -1 | awk '{print "Root (/): " $4 " free of " $2 " (" $5 " used)"}'
AVAIL_KB=$(df --output=avail -k / | tail -1)
if [ "$AVAIL_KB" -gt 1500000 ]; then
    echo "At least 1.5GB free on /                              OK"
else
    echo "At least 1.5GB free on /                              FAIL"
    FAIL=1
    echo "    Biggest items in \$HOME:"
    du -h --max-depth=1 "$HOME" 2>/dev/null | sort -rh | head -8 | sed 's/^/      /'
    [ -d "$HOME/.ollama" ] && echo "    ~/.ollama: $(du -sh "$HOME/.ollama" 2>/dev/null | cut -f1)"
    [ -d "$HOME/.cache" ] && echo "    ~/.cache: $(du -sh "$HOME/.cache" 2>/dev/null | cut -f1)"
    echo "    Try: pip cache purge; rm -rf ~/.cache/pip; sudo apt-get clean; ollama list (remove unused models)"
fi

echo
echo "== Reminder =="
echo "This platform gives a FRESH container every booked session (hostname"
echo "changes each time), but storage may persist across bookings. Budget"
echo "5-10 min every session for zstd + Ollama install + model pull unless"
echo "you confirm a model is already cached in ~/.ollama."

echo
if [ "$FAIL" -eq 1 ]; then
    echo "❌ Preflight FAILED — fix the items above before running deploy_jetson.sh"
    echo "   (This took seconds instead of burning your test window.)"
    exit 1
else
    echo "✅ Preflight passed — safe to run deploy_jetson.sh"
fi
