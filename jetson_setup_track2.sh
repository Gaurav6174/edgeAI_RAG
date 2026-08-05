#!/usr/bin/env bash
# EdgeMinds 2026 - Jetson Orin board setup for Track 2 (Campus Handbook Chatbot)
# Source: "Deploy to NVIDIA Jetson Orin" section of edgeminds-starter-guide (4).html
#
# Run this INSIDE the browser-based Web Terminal on your booked Jetson slot
# (edgeai.aiproff.ai -> your dashboard -> Open Terminal), from inside your
# already-cloned project folder:
#
#   chmod +x jetson_setup_track2.sh
#   ./jetson_setup_track2.sh

set -e

echo "=== Step 2: Verify board + resources ==="
ARCH=$(uname -m)
echo "Architecture: $ARCH"
if [ "$ARCH" != "aarch64" ]; then
    echo "WARNING: expected 'aarch64' for Jetson, got '$ARCH'."
fi

free -h
if command -v jtop >/dev/null 2>&1; then
    echo "(Run 'jtop' manually for the live GPU/RAM monitor - interactive, skipping in this script.)"
else
    echo "jtop not found - skipping (it should be preinstalled on the board image)."
fi

echo
echo "=== Step 3: Sync project from GitHub ==="
if [ -d .git ]; then
    git pull origin main
else
    echo "WARNING: not inside a git repo. cd into your cloned project folder and re-run,"
    echo "or clone it first with: git clone https://github.com/your-username/your-project.git"
fi

echo
echo "=== Step 5: Install ONLY the Python deps this project uses ==="
echo "Do NOT run 'ollama pull' or restart the Ollama service - it's already running"
echo "on the board with all approved models pre-loaded."
# Track 2 packages
pip install sentence-transformers faiss-cpu numpy
# pymupdf isn't in the deployment step-5 list but handbook_bot.py needs it to read handbook.pdf
pip install pymupdf
# requests is needed to call the Ollama REST API directly (Step 6)
pip install requests

echo
echo "=== Step 6: Sanity-check the Ollama REST API on the board ==="
echo "Note: the first generate call after the board sits idle can fail once with"
echo "'llama runner process has terminated' while the GPU context cold-starts -"
echo "this is normal here, so we retry a few times before giving up."
API_OK=0
for i in 1 2 3 4 5; do
    RESP=$(curl -s http://172.17.0.1:11434/api/generate -d '{
      "model": "llama3.2:1b",
      "prompt": "Reply with the single word: OK",
      "stream": false,
      "options": {
        "num_ctx": 1024,
        "num_gpu": 1,
        "use_mmap": true
      }
    }')
    MODEL_REPLY=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('response',''))" 2>/dev/null)
    if [ -n "$MODEL_REPLY" ]; then
        echo "API responded on attempt $i: $MODEL_REPLY"
        API_OK=1
        break
    fi
    echo "attempt $i failed (runner cold-start), retrying..."
    sleep 2
done
if [ "$API_OK" -ne 1 ]; then
    echo "API still not responding after 5 attempts - check the board with jetson_ollama_diagnose.sh"
fi

echo
echo "=== Setup complete ==="
echo "Reminders:"
echo "  - Jetson is fixed to model 'llama3.2:1b' ONLY. No exceptions, do not pull other models."
echo "  - API endpoint: http://172.17.0.1:11434/api/generate"
echo "  - Always: num_ctx=1024, num_gpu=1, use_mmap=True in the request payload."
echo "  - Place handbook.pdf next to handbook_bot.py, then: python handbook_bot.py"
echo "  - Sync workflow: edit on laptop -> git push -> git pull on this board (never manual file copy)."
echo "  - Do >=3 full dry runs before your demo slot; save one run's output to a text file as backup."
