#!/usr/bin/env bash
# Diagnose why POST /api/generate to the board's Ollama server
# returned: {"error":"llama runner process has terminated: %!w(<nil>)"} HTTP 500

echo "=== 1. What models does the server actually see? ==="
curl -s http://172.17.0.1:11434/api/tags | python3 -m json.tool 2>/dev/null \
  || curl -s http://172.17.0.1:11434/api/tags

echo
echo "=== 2. Is the server process itself alive? ==="
curl -s -o /dev/null -w "HTTP status for GET /: %{http_code}\n" http://172.17.0.1:11434/

echo
echo "=== 3. Memory snapshot right now ==="
free -h

echo
echo "=== 4. GPU status (tegrastats, 1 sample) ==="
if command -v tegrastats >/dev/null 2>&1; then
    timeout 3 tegrastats --interval 1000 | head -n 3
else
    echo "tegrastats not available in this shell (normal inside a container)."
fi
if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi
fi

echo
echo "=== 5. Retry the generate call up to 3 times ==="
for i in 1 2 3; do
    echo "--- attempt $i ---"
    curl -s -w '\nHTTP_STATUS:%{http_code}\n' http://172.17.0.1:11434/api/generate \
      -d '{"model":"llama3.2:1b","prompt":"Reply with the single word OK","stream":false}'
    echo
    sleep 2
done

echo
echo "=== 6. Try the exact same call with num_ctx/num_gpu/use_mmap options set ==="
curl -s -w '\nHTTP_STATUS:%{http_code}\n' http://172.17.0.1:11434/api/generate -d '{
  "model": "llama3.2:1b",
  "prompt": "Reply with the single word OK",
  "stream": false,
  "options": {
    "num_ctx": 1024,
    "num_gpu": 1,
    "use_mmap": true
  }
}'
