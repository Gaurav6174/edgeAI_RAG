import json
import os
import pickle
import re
import shutil
from datetime import datetime, timezone
import fitz
import faiss
import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv


load_dotenv()

EMBED_MODEL = os.getenv("EMBED_MODEL")
INDEX_DIR   = os.getenv("INDEX_DIR")
CHUNK_SIZE   = 150      #300
CHUNK_OVERLAP = 20

embed_model = SentenceTransformer(EMBED_MODEL)

def slugify(filename: str) -> str:
    """Turn a filename into a filesystem-safe, stable book id."""
    base = os.path.splitext(filename)[0].lower()
    slug = re.sub(r'[^a-z0-9]+', '-', base).strip('-')
    return slug or "book"

def _meta_path(book_id: str) -> str:
    return os.path.join(INDEX_DIR, book_id, "meta.json")

def list_books() -> list[dict]:
    """Scan INDEX_DIR for per-book subfolders and return their metadata."""
    if not os.path.isdir(INDEX_DIR):
        return []
    books = []
    for entry in sorted(os.listdir(INDEX_DIR)):
        meta_path = _meta_path(entry)
        if os.path.isfile(meta_path):
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            meta.setdefault("ingested_at", None)
            books.append(meta)
    return books

def delete_book(book_id: str) -> bool:
    book_dir = os.path.join(INDEX_DIR, book_id)
    if not os.path.isdir(book_dir):
        return False
    shutil.rmtree(book_dir)
    return True

def rename_book(book_id: str, new_filename: str) -> dict | None:
    meta_path = _meta_path(book_id)
    if not os.path.isfile(meta_path):
        return None
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    meta["filename"] = new_filename
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f)
    return meta

def extract_text_from_pdf(pdf_path: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        if text:
            pages.append({"text": text, "page": i + 1})
    doc.close()
    return pages

def chunk_text(pages: list[dict], source: str) -> list[dict]:
    chunks = []
    for page_data in pages:
        words = page_data["text"].split()
        start = 0
        while start < len(words):
            end = start + CHUNK_SIZE
            chunk_words = words[start:end]
            chunk_text = " ".join(chunk_words)

            chunks.append({
                "text": chunk_text,
                "source": source,
                "page": page_data["page"]
            })

            start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks

def build_index(chunks: list[dict]) -> tuple:
    """
        Takes chunks, embeds them, and builds two indexes:
        1. FAISS index  — for dense semantic search
        2. BM25 index   — for sparse keyword search
    """
    texts = [c["text"] for c in chunks]

    ## Dense Index (FAISS)

    print(f"Embedding {len(chunks)} chunks...")
    embeddings = embed_model.encode(
        texts,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True    # normalise for cosine similarity
    )

    dim = embeddings.shape[1]        # all-MiniLM gives 384-dim vectors
    faiss_index = faiss.IndexFlatIP(dim)  # inner product for cosine similarity
    faiss_index.add(embeddings)

    ## Sparse Index (BM25)
    tokenized = [text.lower().split() for text in texts]
    bm25_index = BM25Okapi(tokenized)

    return faiss_index, bm25_index, embeddings

def save_index(faiss_index, bm25_index, chunks: list[dict], filename: str, embeddings: np.ndarray, book_id: str):
    """ Save the FAISS index, BM25 index, and chunk metadata for one book """
    book_dir = os.path.join(INDEX_DIR, book_id)
    os.makedirs(book_dir, exist_ok=True)

    faiss.write_index(faiss_index, os.path.join(book_dir, "faiss.index"))

    with open(os.path.join(book_dir, "bm25.pkl"), "wb") as f:
        pickle.dump(bm25_index, f)

    with open(os.path.join(book_dir, "chunks.pkl"), "wb") as f:
        pickle.dump(chunks, f)

    ## save embeddings for potential reranking use (reuses the ones already
    ## computed in build_index instead of re-encoding every chunk a second time)
    np.save(os.path.join(book_dir, "embeddings.npy"), embeddings)

    with open(os.path.join(book_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "book_id": book_id,
            "filename": filename,
            "chunks_count": len(chunks),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }, f)

    print(f"Index saved for {filename} (book_id={book_id}) with {len(chunks)} chunks.")

def load_index(book_id: str):
    """load one book's persistent index and metadata from disk"""
    book_dir = os.path.join(INDEX_DIR, book_id)
    faiss_path = os.path.join(book_dir, "faiss.index")
    bm25_path = os.path.join(book_dir, "bm25.pkl")
    chunks_path = os.path.join(book_dir, "chunks.pkl")

    if not all(os.path.exists(p) for p in [faiss_path, bm25_path, chunks_path]):
        return None, None, None

    faiss_index = faiss.read_index(faiss_path)

    with open(bm25_path, "rb") as f:
        bm25_index = pickle.load(f)

    with open(chunks_path, "rb") as f:
        chunks = pickle.load(f)

    print(f"Loaded book '{book_id}' with {len(chunks)} chunks.")
    return faiss_index, bm25_index, chunks

def ingest_pdf(pdf_path: str, filename: str) -> tuple[int, str]:
    """ Main function to ingest a PDF and build indexes for it as its own book """

    book_id = slugify(filename)
    pages = extract_text_from_pdf(pdf_path)
    chunks = chunk_text(pages, source=filename)
    faiss_index, bm25_index, embeddings = build_index(chunks)
    save_index(faiss_index, bm25_index, chunks, filename, embeddings, book_id)
    return len(chunks), book_id

