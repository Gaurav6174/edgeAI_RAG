#!/bin/bash
# Runs the evaluation suite (backend/evaluate.py) against data/eval/questions.csv
# for whatever PDF is currently ingested, and prints the 5 metrics needed for
# the project analysis:
#   - Inference Latency (ms)
#   - Accuracy / Quality (%)
#   - Memory Usage (MB)
#   - Offline Performance (if applicable)
#   - Test Cases Passed
#
# Usage (from project root, backend already running on :8000 with a PDF ingested):
#   chmod +x run_analysis.sh
#   ./run_analysis.sh
set -e

cd "$(dirname "$0")"

CSV_PATH="data/eval/questions.csv"
REPORT_PATH="data/eval/eval_report.json"

echo "== Pre-flight =="
[ -f "$CSV_PATH" ] || { echo "FAILED: $CSV_PATH not found"; exit 1; }
curl -sf http://localhost:8000/health >/dev/null 2>&1 || {
    echo "FAILED: backend is not responding on http://localhost:8000/health"
    echo "Start it first (deploy_jetson.sh or demo_day_run.sh), then re-run this script."
    exit 1
}
HEALTH=$(curl -s http://localhost:8000/health)
echo "Backend health: $HEALTH"
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('index_loaded') else 1)" \
    || { echo "FAILED: no document is currently indexed - ingest a PDF first"; exit 1; }
echo "OK: backend healthy and a document is indexed"

echo
echo "== Memory sampling (background, every 1s while eval runs) =="
MEM_SAMPLES="/tmp/mem_samples_$$.txt"
: > "$MEM_SAMPLES"
sample_memory() {
    while true; do
        PIDS=$(pgrep -f "uvicorn main:app" || true)
        if [ -n "$PIDS" ]; then
            TOTAL_KB=0
            for PID in $PIDS; do
                RSS_KB=$(awk '/VmRSS/ {print $2}' "/proc/$PID/status" 2>/dev/null || echo 0)
                TOTAL_KB=$((TOTAL_KB + RSS_KB))
            done
            echo "$TOTAL_KB" >> "$MEM_SAMPLES"
        fi
        sleep 1
    done
}
sample_memory &
SAMPLER_PID=$!
trap 'kill "$SAMPLER_PID" 2>/dev/null || true' EXIT

echo
echo "== Running evaluation against $CSV_PATH =="
cd backend
python3 evaluate.py
cd ..

kill "$SAMPLER_PID" 2>/dev/null || true
trap - EXIT

echo
echo "== Offline capability check =="
OLLAMA_HOST_VAL=$(grep -E '^OLLAMA_HOST=' backend/.env | tail -1 | cut -d= -f2-)
OLLAMA_HOST_VAL="${OLLAMA_HOST_VAL:-http://172.17.0.1:11434}"
OFFLINE_OK=1
case "$OLLAMA_HOST_VAL" in
    *127.0.0.1*|*localhost*|*172.1[6-9].*|*172.2[0-9].*|*172.3[0-1].*|*192.168.*|*10.*) ;;
    *) OFFLINE_OK=0 ;;
esac
HF_CACHE="${HF_HOME:-$HOME/.cache/huggingface}"
if [ -d "$HF_CACHE" ] && [ -n "$(find "$HF_CACHE" -maxdepth 3 -iname '*MiniLM*' 2>/dev/null)" ]; then
    MODELS_CACHED=1
else
    MODELS_CACHED=0
fi
if [ "$OFFLINE_OK" -eq 1 ] && [ "$MODELS_CACHED" -eq 1 ]; then
    OFFLINE_STATUS="OK - LLM ($OLLAMA_HOST_VAL) is on the local/private network and embedding models are cached locally. No internet needed at inference time."
elif [ "$OFFLINE_OK" -eq 1 ]; then
    OFFLINE_STATUS="PARTIAL - LLM is local ($OLLAMA_HOST_VAL) but embedding/reranker model cache not found at $HF_CACHE (first run may need internet to download them)."
else
    OFFLINE_STATUS="NOT OFFLINE - OLLAMA_HOST ($OLLAMA_HOST_VAL) is not a local/private address."
fi
echo "$OFFLINE_STATUS"

echo
echo "== Results =="
python3 - "$REPORT_PATH" "$MEM_SAMPLES" <<'PYEOF'
import json
import sys

report_path, mem_path = sys.argv[1], sys.argv[2]

with open(report_path) as f:
    report = json.load(f)

m = report["metrics"]
b = report["breakdown"]
total = report["total_questions"]
passed = b["true_positives"] + b["true_negatives"]

print(f"Test Cases Passed:     {passed}/{total} ({passed/total*100:.1f}%)" if total else "Test Cases Passed:     n/a")
print(f"Accuracy / Quality:    {m['accuracy']*100:.1f}%  (precision {m['precision']*100:.1f}%, recall {m['recall']*100:.1f}%, F1 {m['f1_score']*100:.1f}%)")

lat = m.get("latency_ms") or {}
if lat.get("avg_ms") is not None:
    print(f"Inference Latency:     avg {lat['avg_ms']} ms | median {lat['median_ms']} ms | p95 {lat['p95_ms']} ms | min {lat['min_ms']} ms | max {lat['max_ms']} ms")
else:
    print("Inference Latency:     n/a (no successful queries)")

try:
    with open(mem_path) as f:
        samples = [int(line.strip()) for line in f if line.strip()]
    if samples:
        avg_mb = sum(samples) / len(samples) / 1024
        peak_mb = max(samples) / 1024
        print(f"Memory Usage:          avg {avg_mb:.1f} MB | peak {peak_mb:.1f} MB (backend process RSS)")
    else:
        print("Memory Usage:          n/a (no samples captured)")
except FileNotFoundError:
    print("Memory Usage:          n/a (no samples captured)")

print(f"\nFull per-question report: {report_path}")
PYEOF

rm -f "$MEM_SAMPLES"
