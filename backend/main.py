import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from models import QueryRequest, IngestResponse, Citation, Book, RenameBookRequest
from ingest import ingest_pdf, load_index, list_books, delete_book, rename_book
from retriever import retrieve
from confidence import is_confident
from llm import query_ollama_stream

load_dotenv()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "../data/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Campus Handbook Bot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache of every book's index: book_id -> (faiss_index, bm25_index, chunks)
BOOKS: dict[str, tuple] = {}
LAST_INGESTED_BOOK_ID: str | None = None


def _load_all_books():
    for meta in list_books():
        book_id = meta["book_id"]
        faiss_index, bm25_index, chunks = load_index(book_id)
        if faiss_index is not None:
            BOOKS[book_id] = (faiss_index, bm25_index, chunks)


_load_all_books()
if BOOKS:
    LAST_INGESTED_BOOK_ID = next(reversed(BOOKS))

## API ENDPOINTS

@app.get("/books", response_model=list[Book])
async def get_books():
    return [Book(**meta) for meta in list_books()]


@app.post("/ingest", response_model=IngestResponse)
async def ingest(file: UploadFile = File(...)):
    global LAST_INGESTED_BOOK_ID

    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    save_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    num_chunks, book_id = ingest_pdf(save_path, file.filename)

    faiss_index, bm25_index, chunks = load_index(book_id)
    BOOKS[book_id] = (faiss_index, bm25_index, chunks)
    LAST_INGESTED_BOOK_ID = book_id

    return IngestResponse(
        message="Ingestion complete",
        chunks_indexed=num_chunks,
        filename=file.filename,
        book_id=book_id,
    )


@app.delete("/books/{book_id}")
async def remove_book(book_id: str):
    global LAST_INGESTED_BOOK_ID
    if not delete_book(book_id):
        raise HTTPException(404, "Book not found")
    BOOKS.pop(book_id, None)
    if LAST_INGESTED_BOOK_ID == book_id:
        LAST_INGESTED_BOOK_ID = next(reversed(BOOKS), None)
    return {"deleted": book_id}


@app.patch("/books/{book_id}", response_model=Book)
async def update_book(book_id: str, request: RenameBookRequest):
    meta = rename_book(book_id, request.filename)
    if meta is None:
        raise HTTPException(404, "Book not found")
    return Book(**meta)


def _resolve_book(book_id: str | None) -> tuple:
    book_id = book_id or LAST_INGESTED_BOOK_ID
    if not book_id or book_id not in BOOKS:
        raise HTTPException(400, "No such book indexed. Please upload a PDF first or pick a valid book_id.")
    return BOOKS[book_id]


@app.post("/query")
async def query(request: QueryRequest):
    """
    Accepts a question + book_id, retrieves relevant chunks from that book,
    checks confidence, then streams the LLM answer.
    """
    faiss_index, bm25_index, chunks = _resolve_book(request.book_id)

    top_chunks, confidence = retrieve(request.question, faiss_index, bm25_index, chunks)

    # Confidence gate: if retrieval is weak, don't call the LLM
    if not is_confident(confidence):
        async def not_found_stream():
            yield "I couldn't find this in the handbook."
        return StreamingResponse(not_found_stream(), media_type="text/plain")

    return StreamingResponse(
        query_ollama_stream(request.question, top_chunks),
        media_type="text/plain"
    )


@app.get("/citations")
async def get_citations(question: str, book_id: str | None = None):
    """
    Separate endpoint to get citations for a question.
    Frontend calls this alongside /query to display sources.
    """
    try:
        faiss_index, bm25_index, chunks = _resolve_book(book_id)
    except HTTPException:
        return {"citations": [], "confidence": 0.0, "found": False}

    top_chunks, confidence = retrieve(question, faiss_index, bm25_index, chunks)

    found = is_confident(confidence)
    citations = [
        Citation(
            text=c["text"][:300] + "..." if len(c["text"]) > 300 else c["text"],
            source=c["source"],
            page=c.get("page")
        )
        for c in top_chunks
    ] if found else []

    return {
        "citations": [c.dict() for c in citations],
        "confidence": round(confidence, 3),
        "found": found
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "index_loaded": len(BOOKS) > 0,
        "chunk_count": sum(len(chunks) for _, _, chunks in BOOKS.values()),
        "books_loaded": len(BOOKS),
    }


# Serve the pre-built React frontend from frontend/dist/, committed to git so the
# board never needs Node.js (see study.md errors.md #3 - Node 18 on the Jetson image
# can't build Vite 8). Registered last so it never shadows the API routes above.
FRONTEND_DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="static")
