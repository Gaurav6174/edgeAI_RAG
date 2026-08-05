#!/usr/bin/env bash
# EdgeMinds 2026 - Jetson setup for Track 2 (Campus Handbook Chatbot)
# Source: edgeminds-starter-guide (4).html
#
# Run on the Jetson's terminal from inside your already-cloned project folder:
#   chmod +x jetson_setup_track2.sh
#   ./jetson_setup_track2.sh

set -e

echo "=== 1. Verify board architecture ==="
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"
if [ "$ARCH" != "aarch64" ]; then
    echo "WARNING: expected 'aarch64' for Jetson, got '$ARCH'. Continuing anyway."
fi

echo
echo "=== 2. System resource check ==="
free -h
if command -v jtop >/dev/null 2>&1; then
    echo "(Run 'jtop' manually for the live resource monitor - it's interactive and can't run unattended in this script.)"
else
    echo "jtop not installed, skipping (install with: sudo pip3 install jetson-stats)"
fi

echo
echo "=== 3. Install Ollama (Linux) ==="
if command -v ollama >/dev/null 2>&1; then
    echo "Ollama already installed: $(ollama --version)"
else
    curl -fsSL https://ollama.com/install.sh | sh
    ollama --version
fi

echo
echo "=== 4. Pull required models ==="
# Recommended starting model (all tracks)
ollama pull llama3.2:1b
# Track 2 model
ollama pull qwen2.5:1.5b

echo
echo "=== 5. Quick terminal model test ==="
ollama run qwen2.5:1.5b "What causes rust disease in wheat crops?"

echo
echo "=== 6. Sync project from GitHub (git pull) ==="
if [ -d .git ]; then
    git pull origin main
else
    echo "WARNING: current directory is not a git repo. cd into your project folder first, then re-run, or run 'git pull origin main' manually."
fi

echo
echo "=== 7. Python dependencies for Track 2 ==="
pip install ollama pymupdf sentence-transformers faiss-cpu numpy

echo
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Place handbook.pdf in this same folder as handbook_bot.py"
echo "  2. Run: python test_ollama.py         (sanity check)"
echo "  3. Run: python handbook_bot.py        (builds handbook.index on first run)"
echo
echo "Reminders from the guide (Track 2 constraints):"
echo "  - Approved models only: llama3.2:1b, qwen2.5:1.5b, deepseek-r1:1.5b, mistral:1b (max 1.5B params)"
echo "  - Text chunk size: 300 words maximum"
echo "  - Jetson REST API endpoint (if needed): http://172.17.0.1:11434/api/generate"
