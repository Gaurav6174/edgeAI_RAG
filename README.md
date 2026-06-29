# Campus Handbook Bot

> On-device RAG system for institutional document Q&A — powered by Llama 3.2 1B, running entirely on NVIDIA Jetson Orin Nano with zero external API calls.

![Architecture](https://img.shields.io/badge/Architecture-RAG-teal) ![Model](https://img.shields.io/badge/Model-Llama%203.2%201B-coral) ![Hardware](https://img.shields.io/badge/Hardware-Jetson%20Orin%20Nano-green) ![API](https://img.shields.io/badge/API%20Calls-Zero-purple)

---

## What it does

Campus Handbook Bot lets students and staff query institutional documents — handbooks, fee structures, exam schedules, hostel rules — using plain English. Upload a PDF, ask a question, get a direct cited answer. Everything runs locally on the Jetson board. No internet. No cloud. No data leaves the device.

---

## Key features

- **Hybrid search** — combines FAISS semantic search with BM25 keyword search via Reciprocal Rank Fusion. Handles both conceptual queries ("what are the hostel rules") and exact lookups ("what is rule 4.2.1") that pure vector search fails on
- **Cross-encoder reranking** — retrieves top-10 candidates then reranks to top-3 using a cross-encoder before passing context to the LLM, keeping the 1B model's context tight and accurate
- **Confidence gating** — scores retrieval similarity before invoking the LLM. Queries below the threshold return "not found in handbook" instead of hallucinating an answer
- **Streaming responses** — answer appears token by token via Ollama's streaming API, masking generation latency on edge hardware
- **Persistent index** — FAISS + BM25 index saved to disk, survives reboots without re-ingestion
- **Cited answers** — every response references the exact source chunk, document name, and page number

---

## Architecture

```
INGESTION PHASE
PDF upload → PyMuPDF extraction → sentence chunking (300 words, 20 overlap)
         → FAISS dense index (all-MiniLM-L6-v2) + BM25 sparse index → saved to disk

QUERY PHASE
User query → hybrid retrieval (RRF fusion, top-10)
          → cross-encoder rerank (top-3)
          → confidence gate (threshold ≥ 0.35)
          → Llama 3.2 1B via Ollama (streaming)
          → cited answer + confidence score → React frontend
```

---

## Tech stack

| Layer | Tool | Role |
|-------|------|------|
| LLM | Llama 3.2 1B · Ollama · Q4_K_M | On-device generation, streaming output |
| Dense search | FAISS + all-MiniLM-L6-v2 | Semantic similarity retrieval |
| Sparse search | BM25 (rank-bm25) | Keyword and exact-match retrieval |
| Reranking | cross-encoder/ms-marco-MiniLM-L-6-v2 | Precision rerank of top-10 to top-3 |
| PDF parsing | PyMuPDF | Text extraction from institutional PDFs |
| Backend | FastAPI (async) | Ingest + query REST API |
| Frontend | React + Vite | Upload UI, streaming chat, citation display |
| Deployment | SSH + scp | Two-phase: local dev → Jetson deployment |

---

## Project structure

```
campus-handbook-bot/
├── backend/
│   ├── main.py           — FastAPI entry point, CORS, all API routes
│   ├── ingest.py         — PDF parse → chunk → embed → dual index
│   ├── retriever.py      — hybrid FAISS + BM25 search + cross-encoder rerank
│   ├── llm.py            — Ollama streaming integration
│   ├── confidence.py     — similarity threshold gate
│   ├── models.py         — Pydantic request/response schemas
│   ├── evaluate.py       — RAG evaluation against ground-truth CSV
│   ├── public/dist/      — built frontend (served by FastAPI)
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── public/           — static assets (icons, favicon)
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api.js        — all fetch calls to FastAPI (single source of truth)
│   │   ├── index.css
│   │   └── components/
│   │       ├── Upload.jsx      — PDF drag-and-drop + ingest trigger
│   │       ├── Chat.jsx        — streaming chat interface
│   │       ├── Citation.jsx    — cited source display
│   │       └── Confidence.jsx  — score badge + "not found" state
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── eslint.config.js
├── data/
│   ├── uploads/          — ingested PDFs
│   ├── index/            — persisted FAISS + BM25 index (copy to Jetson)
│   └── eval/             — evaluation dataset + eval_report.json
└── README.md
```

---

## Phase 1 — local development

### Prerequisites

- Python 3.12
- Node.js 18+
- [Ollama](https://ollama.com) installed on your system
- `uv` package manager (`pip install uv`)

### 1. Pull the model

```bash
ollama pull llama3.2:1b
```

Verify it's available:

```bash
ollama list
# should show llama3.2:1b
```

Ollama runs as a background service automatically after install. Verify:

```bash
curl http://localhost:11434
# → Ollama is running
```

### 2. Backend setup

```bash
# from project root
uv venv .venv --python 3.12
source .venv/bin/activate

uv pip install -r backend/requirements.txt
```

Create `backend/.env`:

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2:1b
EMBED_MODEL=sentence-transformers/all-MiniLM-L6-v2
INDEX_DIR=../data/index
UPLOAD_DIR=../data/uploads
TOP_K=10
RERANK_TOP_N=3
CONFIDENCE_THRESHOLD=0.35
```

Start the backend (serves both the API and the frontend):

```bash
cd backend
uvicorn main:app --port 8000
```

> Use `--reload` only when actively editing backend code. Without it, the in-memory index persists correctly between requests.

Open `http://localhost:8000` in your browser — the built frontend is served directly by FastAPI.

Verify the API at `http://localhost:8000/health`:
```json
{"status": "ok", "index_loaded": false, "chunks_count": 0}
```

Interactive API docs at `http://localhost:8000/docs`.

### 3. Frontend development (optional)

If you're iterating on the UI, run the Vite dev server for hot-reload:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

> The Vite proxy forwards all `/ingest`, `/query`, `/citations`, and `/health` calls to `localhost:8000` automatically — no CORS issues.

When you're done, build and commit the changes:

```bash
cd frontend
npm run build
# output goes to dist/ — do NOT move it manually
```

> The built frontend is served from `backend/public/dist/`. The build output is already copied there (symlinked or pre-deployed), so simply run `npm run build` from the frontend directory, then restart the backend.

### 4. Test the full pipeline

1. Open `http://localhost:8000`
2. Upload a PDF using the upload card (drag and drop supported)
3. Wait for the "Indexed N chunks" confirmation
4. Type a question in the chat
5. Answer streams in token by token with citations and confidence score below

---

## Phase 2 — Jetson Orin Nano deployment

### Before switching to the Jetson

Build and verify the full pipeline locally first. Then prepare the index for transfer:

```bash
# confirm index files exist
ls data/index/
# should show: faiss.index  bm25.pkl  chunks.pkl  embeddings.npy
```

These files are the pre-built index — transferring them means no re-ingestion or re-embedding on the board.

### Transfer files to Jetson

```bash
# copy the pre-built index (no re-ingestion needed on Jetson)
scp -r data/index/ username@<jetson-ip>:/home/username/campus-handbook-bot/data/

# copy the backend
scp -r backend/ username@<jetson-ip>:/home/username/campus-handbook-bot/

# build and copy the frontend (backend serves it from public/dist/)
cd frontend && npm run build && cp -r dist/ ../backend/public/

# copy any PDF you want available on the board
scp data/uploads/handbook.pdf username@<jetson-ip>:/home/username/campus-handbook-bot/data/uploads/
```

### On the Jetson board

```bash
# SSH into the board
ssh username@<jetson-ip>

# pull the model (Ollama is pre-installed on the board)
ollama pull llama3.2:1b

# set up Python environment
cd campus-handbook-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# start the backend — identical command to local
cd backend
uvicorn main:app --port 8000
```

The `.env` file is identical — `OLLAMA_HOST=http://localhost:11434` works on Jetson too because Ollama runs locally there as well.

### Verify GPU is being used

In a separate SSH session while the backend is running:

```bash
tegrastats
```

Look for GPU utilization going up when a query is processed. If it stays at 0%, Ollama isn't using the GPU — check JetPack version (`jetpack --version`) and ensure CUDA libraries are linked correctly.

### Access the frontend

The backend serves the built frontend from `public/dist/`, so the UI is available at the same address as the API:

Access the UI from any browser on the same network at `http://<jetson-ip>:8000`.

---

## API reference

### `POST /ingest`

Upload a PDF and build the hybrid index.

**Request:** `multipart/form-data` with `file` field (PDF only)

**Response:**
```json
{
  "message": "Ingestion complete",
  "chunks_indexed": 153,
  "filename": "handbook.pdf"
}
```

---

### `POST /query`

Stream an answer for a question. Returns a plain text stream.

**Request:**
```json
{ "question": "what is the hostel checkout time?" }
```

**Response:** `text/plain` stream — tokens arrive one by one.

---

### `GET /citations?question=...`

Get citations and confidence score for a question (non-streaming).

**Response:**
```json
{
  "citations": [
    {
      "text": "Students must vacate hostel rooms by 10:00 AM on the day of checkout...",
      "source": "handbook.pdf",
      "page": 42
    }
  ],
  "confidence": 0.812,
  "found": true
}
```

---

### `GET /health`

Check backend status and index state.

**Response:**
```json
{
  "status": "ok",
  "index_loaded": true,
  "chunks_count": 153
}
```

---

## Configuration

All tunable parameters live in `backend/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.2:1b` | Model name as listed in `ollama list` |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | HuggingFace embedding model |
| `INDEX_DIR` | `../data/index` | Where to persist the FAISS + BM25 index |
| `UPLOAD_DIR` | `../data/uploads` | Where uploaded PDFs are saved |
| `TOP_K` | `10` | Number of candidates retrieved before reranking |
| `RERANK_TOP_N` | `3` | Number of chunks passed to the LLM after reranking |
| `CONFIDENCE_THRESHOLD` | `0.35` | Minimum reranker score to trigger LLM — below this returns "not found" |

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:8000`** — backend isn't running. Start it with `uvicorn main:app --port 8000` in a separate terminal with the venv activated.

**`No documents indexed yet`** — upload a PDF first via the UI, then query. If you already uploaded and restarted uvicorn, the in-memory index was wiped — re-upload.

**`faiss-cpu` install fails** — you're on Python 3.13. Recreate the venv with Python 3.12: `uv venv .venv --python 3.12`.

**Ollama `address already in use`** — Ollama is already running as a system service (expected). Don't run `ollama serve` manually. Just use it.

**Answer appears all at once instead of streaming** — check that `streamQuery` in `api.js` uses a `ReadableStream` reader, not `await response.json()`.

**Low confidence on valid questions** — your chunks may be too large or the document has complex formatting. Try reducing `CHUNK_SIZE` to 150 in `ingest.py`, delete `data/index/`, and re-ingest.

**GPU not used on Jetson** — verify with `tegrastats`. Ensure JetPack 6 is installed and Ollama was installed after JetPack (so it links against the correct CUDA libraries).

---

## How the confidence score works

Every query goes through three stages before reaching the LLM:

1. **Hybrid retrieval** — FAISS semantic search + BM25 keyword search, fused via Reciprocal Rank Fusion to get top-10 candidates
2. **Cross-encoder reranking** — a second model scores each (query, chunk) pair together rather than independently, giving a much more accurate relevance score; top-3 kept
3. **Confidence gate** — if the best reranker score is below `CONFIDENCE_THRESHOLD` (0.35), the system responds "not found" without calling the LLM

This prevents the 1B model from hallucinating answers to questions the document doesn't cover — one of the most common failure modes in small model RAG systems.

---

## Evaluating response accuracy

The repo includes an evaluation script (`backend/evaluate.py`) that scores your RAG system against a ground-truth dataset using semantic similarity. Use it to measure precision, recall, F1, and accuracy.

### Step-by-step

**1. Generate a Q&A dataset**

Upload your PDF to an advanced LLM (ChatGPT, Claude, etc.) with this prompt:

```
You are creating an evaluation dataset for a RAG system. From this handbook PDF
generate 50 factual question-answer pairs.

Rules:

  - Questions must be clearly answerable from the document
  - Answers must be concise and directly from the text
  - Include the page number where the answer is found
  - Return ONLY a CSV with these exact columns:
    question,answer,answerable,source_page
  - Set answerable to True for all generated pairs
  - No explanations, no markdown, just the CSV rows

Generate the questions now.
```

**2. Place the CSV**

Copy the generated CSV into the project:

```bash
mkdir -p data/eval
# copy your file as questions.csv
cp /path/to/your/questions.csv data/eval/questions.csv
```

**3. Run the backend**

```bash
cd backend
uvicorn main:app --port 8000
```

**4. Run the evaluation**

In another terminal:

```bash
cd backend
python evaluate.py
```

This produces `data/eval/eval_report.json` with per-question results and aggregate metrics (accuracy, precision, recall, F1).

### Tuning

Adjust the system prompt in `backend/llm.py` and LLM hyperparameters (temperature, top_p, etc.) in the Ollama call to improve scores, then re-run the evaluation.

---

## Team

Built as part of the AiProff Edge AI Internship Program.

- RAG pipeline, backend, deployment — Gaurav Chaurasia
- React frontend — Bittu Prajapati

---

## License

MIT
