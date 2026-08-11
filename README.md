# Campus Handbook Bot

> On-device RAG system for institutional document Q&A — powered by Llama 3.2 1B, running entirely on NVIDIA Jetson Orin Nano with zero external API calls.

![Architecture](https://img.shields.io/badge/Architecture-RAG-teal) ![Model](https://img.shields.io/badge/Model-Llama%203.2%201B-coral) ![Hardware](https://img.shields.io/badge/Hardware-Jetson%20Orin%20Nano-green) ![API](https://img.shields.io/badge/API%20Calls-Zero-purple)

---

## What it does

Campus Handbook Bot lets students and staff query institutional documents — handbooks, fee structures, exam schedules, hostel rules — using plain English. Upload a PDF, ask a question, get a direct cited answer. Everything runs locally on the Jetson board. No internet. No cloud. No data leaves the device.

---

## Key features

- **Multi-book support** — every uploaded PDF is indexed independently under its own `book_id`; switch, rename, or delete books from the UI and queries are scoped to whichever one is active
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
         → FAISS dense index (all-MiniLM-L6-v2) + BM25 sparse index
         → saved to disk under data/index/<book_id>/

QUERY PHASE
User query + book_id → hybrid retrieval on that book's index (RRF fusion, top-10)
          → cross-encoder rerank (top-3, sigmoid-normalized to 0-1)
          → confidence gate (threshold ≥ CONFIDENCE_THRESHOLD)
          → Llama 3.2 1B via Ollama (streaming)
          → cited answer + confidence score → React frontend
```

The frontend (`frontend/`) is a Vite/React app. In production the backend serves
its **pre-built, committed** `frontend/dist/` directly from `:8000` — no Node.js
needed on the deployment target (that build step is exactly what broke on the
Jetson's Node 18 image; see `study.md`). For active UI development, run Vite's own
dev server instead (`npm run dev`, port 5173) — see "Phase 1" below.

---

## Tech stack

| Layer | Tool | Role |
|-------|------|------|
| LLM | Llama 3.2 1B · Ollama · Q4_K_M | On-device generation, streaming output |
| Dense search | FAISS + all-MiniLM-L6-v2 | Semantic similarity retrieval |
| Sparse search | BM25 (rank-bm25) | Keyword and exact-match retrieval |
| Reranking | cross-encoder/ms-marco-MiniLM-L-6-v2 | Precision rerank of top-10 to top-3 |
| PDF parsing | PyMuPDF | Text extraction from institutional PDFs |
| Backend | FastAPI (async) | Ingest + query REST API, multi-book index management |
| Frontend | React + Vite | Upload UI, book switcher, streaming chat, citation display; served by the backend from a pre-built `frontend/dist/` |
| Deployment | `git pull` + `deploy_jetson.sh` / `demo_day_run.sh` | Board is a browser-only Web Terminal with no SSH/SCP — see [`study.md`](study.md) for why and what actually works |

---

## Project structure

```
campus-handbook-bot/
├── backend/
│   ├── main.py           — FastAPI entry point, CORS, all API routes, serves frontend/dist/ from "/"
│   ├── ingest.py         — PDF parse → chunk → embed → per-book dual index
│   ├── retriever.py      — hybrid FAISS + BM25 search + cross-encoder rerank
│   ├── llm.py            — Ollama streaming integration
│   ├── confidence.py     — similarity threshold gate
│   ├── models.py         — Pydantic request/response schemas (incl. Book, RenameBookRequest)
│   ├── evaluate.py       — RAG evaluation against ground-truth CSV
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── dist/               — PRE-BUILT and committed (not gitignored) — this is what main.py serves.
│   │                          Rebuild with `npm run build` and commit the result after any UI change.
│   ├── public/              — static assets (icons, favicon)
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api.js           — all fetch calls to FastAPI (single source of truth)
│   │   ├── index.css
│   │   └── components/
│   │       ├── Upload.jsx      — PDF drag-and-drop + ingest trigger
│   │       ├── BookList.jsx    — book switcher: select / rename / delete
│   │       ├── Chat.jsx        — streaming chat interface, scoped to the active book
│   │       ├── Citation.jsx    — cited source display
│   │       └── Confidence.jsx  — score badge + "not found" state
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js         — dev proxy forwards /ingest, /query, /citations, /health, /books to :8000
│   └── eslint.config.js
├── data/
│   ├── uploads/           — ingested PDFs
│   ├── index/<book_id>/   — persisted FAISS + BM25 index, one directory per uploaded book
│   └── eval/              — evaluation dataset + eval_report.json
├── deploy_jetson.sh       — full environment provisioning on a fresh Jetson session (see study.md)
├── demo_day_run.sh        — restart + end-to-end smoke test once the environment exists
├── study.md               — the real Jetson deployment war story: what broke, why, what fixed it
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

Start the backend (serves both the API and the pre-built frontend):

```bash
cd backend
uvicorn main:app --port 8000
```

> Use `--reload` only when actively editing backend code. Without it, the in-memory index persists correctly between requests.

Open `http://localhost:8000` in your browser — `frontend/dist/` (already built and
committed) is served directly by FastAPI from `main.py`'s `StaticFiles` mount.

Verify the API at `http://localhost:8000/health`:
```json
{"status": "ok", "index_loaded": false, "chunk_count": 0, "books_loaded": 0}
```

Interactive API docs at `http://localhost:8000/docs`.

### 3. Frontend development (optional)

Only needed if you're changing the UI — `frontend/dist/` already ships built and
committed, so most of the time you can skip straight to step 4. For hot-reload
while iterating:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

> `vite.config.js`'s dev proxy forwards `/ingest`, `/query`, `/citations`, `/health`,
> and `/books` calls to `localhost:8000` automatically — no CORS issues.

When you're done, **rebuild and commit** — `frontend/dist/` is tracked in git
specifically so the deploy target never needs Node.js:

```bash
cd frontend
npm run build
git add dist/
```

The backend serves whatever's in `dist/` directly; no copy step, no separate
`backend/public/` — just restart `uvicorn` to pick up the new build.

### 4. Test the full pipeline

1. Open `http://localhost:8000`
2. Upload a PDF using the upload card (drag and drop supported) — it becomes its own book
3. Wait for the "Indexed N chunks" confirmation, and pick it in the book list if it isn't auto-selected
4. Type a question in the chat
5. Answer streams in token by token with citations and confidence score below

---

## Phase 2 — Jetson Orin Nano deployment

**Read [`study.md`](study.md) first.** It's the full account of why this section
looks the way it does — a booked slot on AiProff's Edge AI Cloud Lab gives you a
browser-only Web Terminal into a fresh, disposable container each session, with
**no SSH and no SCP**, despite what the program's own docs originally implied. Every
step below exists because of a real failure mode documented there; the summary here
is the golden path, not the reasoning.

### What actually works, end to end

1. **`git clone`** the repo into the booked session — this is the *only* way code
   reaches the board. There's no file upload, no reachable IP for `scp`.
2. `cd` into the project directory.
3. **Edit `backend/.env`** and set `OLLAMA_HOST=http://172.17.0.1:11434` (the Docker
   bridge gateway, not `localhost` — the board runs a shared Ollama server outside
   your container, pre-loaded with `llama3.2:1b`). **Do not** `ollama pull`, install,
   or restart Ollama on the board — it's already running and shared across sessions.
4. **`chmod +x deploy_jetson.sh demo_day_run.sh`, then run them in order:**
   ```bash
   ./deploy_jetson.sh     # preflight checks, disk hygiene, hardened venv, rebuilds
                           # the FAISS index natively, starts the backend on :8000
   ./demo_day_run.sh      # clean restart via PID file + fires real test queries
                           # against /query and /citations to prove it actually works
   ```
5. **Expose the board off-board.** `0.0.0.0:8000` is only reachable *inside* the
   container's network — same reason `scp` never worked in step 1. Use a tunnel:
   ```bash
   npm install -g localtunnel
   lt --port 8000
   ```
   This prints a public URL forwarding to the board's `:8000` — that's it. One
   tunnel covers both the API and the UI, since the backend serves the pre-built
   `frontend/dist/` from the same port (§ "Project structure" above) — no second
   tunnel, no Node.js build needed on the board.

### Verify GPU is being used

From the Web Terminal while the backend is running, check the board's own Ollama
logs or:

```bash
nvidia-smi 2>/dev/null || echo "unavailable in this shell (normal inside a container)"
```

GPU introspection tools are sometimes not visible from inside the session's
container even though the underlying hardware is real — `deploy_jetson.sh`'s
Ollama health check already confirms GPU inference indirectly (a fast, non-empty
reply from the model).

---

## API reference

### `POST /ingest`

Upload a PDF and index it as a new, independent book.

**Request:** `multipart/form-data` with `file` field (PDF only)

**Response:**
```json
{
  "message": "Ingestion complete",
  "chunks_indexed": 153,
  "filename": "handbook.pdf",
  "book_id": "handbook"
}
```

The most recently ingested `book_id` becomes the default for `/query` and
`/citations` calls that omit `book_id`.

---

### `GET /books`

List every indexed book.

**Response:**
```json
[
  { "book_id": "handbook", "filename": "handbook.pdf", "chunks_count": 153, "ingested_at": "2026-08-05T12:00:00" }
]
```

---

### `PATCH /books/{book_id}`

Rename a book. **Request:** `{ "filename": "New Name.pdf" }`. **Response:** the updated `Book` object.

### `DELETE /books/{book_id}`

Delete a book and its on-disk index. **Response:** `{ "deleted": "<book_id>" }`.

---

### `POST /query`

Stream an answer for a question, scoped to one book. Returns a plain text stream.

**Request:**
```json
{ "question": "what is the hostel checkout time?", "book_id": "handbook" }
```

`book_id` is optional — omitted, it falls back to the most recently ingested book.
If no book has been ingested and none is specified, this returns a 400.

**Response:** `text/plain` stream — tokens arrive one by one.

---

### `GET /citations?question=...&book_id=...`

Get citations and confidence score for a question against one book (non-streaming).
`book_id` is optional with the same fallback behavior as `/query`.

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

`confidence` is the cross-encoder reranker's top score, sigmoid-normalized to a
0–1 range (see "How the confidence score works" below) — it lines up directly
with `CONFIDENCE_THRESHOLD`.

---

### `GET /health`

Check backend status and index state across all loaded books.

**Response:**
```json
{
  "status": "ok",
  "index_loaded": true,
  "chunk_count": 153,
  "books_loaded": 1
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
| `CONFIDENCE_THRESHOLD` | `0.35` | Minimum reranker score (0-1, sigmoid-normalized) to trigger LLM — below this returns "not found" |

> The Jetson `.env` currently ships with `CONFIDENCE_THRESHOLD=0.0`, left low
> intentionally for maximum recall during testing — it means almost every query
> reaches the LLM regardless of relevance. Raise it to `0.35` before a real demo
> where hallucination-prevention matters more than recall. See `study.md` §9.

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:8000`** — backend isn't running. Start it with `uvicorn main:app --port 8000` in a separate terminal with the venv activated.

**`No such book indexed`** (400 from `/query` or `/citations`) — no book has been uploaded yet, or the `book_id` you passed doesn't exist. Upload a PDF via `/ingest` first, or check `GET /books` for valid IDs.

**`faiss-cpu` install fails** — you're on Python 3.13. Recreate the venv with Python 3.12: `uv venv .venv --python 3.12`.

**Ollama `address already in use`** — Ollama is already running as a system service (expected). Don't run `ollama serve` manually. Just use it.

**Answer appears all at once instead of streaming** — check that `streamQuery` in `api.js` uses a `ReadableStream` reader, not `await response.json()`.

**Low confidence on valid questions** — your chunks may be too large or the document has complex formatting. Try reducing `CHUNK_SIZE` to 150 in `ingest.py`, delete the book's `data/index/<book_id>/` directory, and re-ingest.

**Frontend loads but can't reach the API / CORS errors** — normally the frontend is same-origin with the API (either served by the backend from `frontend/dist/`, or via the Vite dev proxy). This only happens if you're opening `frontend/dist/index.html` directly (e.g. via `file://` or a separate static host) without also running the backend on the expected origin — go through `uvicorn` (production) or `npm run dev` (development) instead.

**Deploying to the actual Jetson board** — this repo's own deploy history hit (and
fixed) a long list of Jetson-specific failures: `.local`-vs-`.venv` package
shadowing, a `pytz`/`tzdata.zi` crash from `--system-site-packages`, Ollama
cold-start timeouts, `ensurepip` failures, disk filling to 100%, and more. Don't
re-debug these from scratch — **[`study.md`](study.md)** documents each one, why it
happened, and the fix that's already baked into `deploy_jetson.sh`.

---

## How the confidence score works

Every query goes through three stages before reaching the LLM:

1. **Hybrid retrieval** — FAISS semantic search + BM25 keyword search, fused via Reciprocal Rank Fusion to get top-10 candidates
2. **Cross-encoder reranking** — a second model scores each (query, chunk) pair together rather than independently, giving a much more accurate relevance score; top-3 kept. The cross-encoder's raw output is an unbounded logit, not a 0-1 score, so `retriever.py` applies a sigmoid before this score is used anywhere
3. **Confidence gate** — if the best (sigmoid-normalized) reranker score is below `CONFIDENCE_THRESHOLD`, the system responds "not found" without calling the LLM

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
