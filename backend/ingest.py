import os
import pickle
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

def save_index(faiss_index, bm25_index, chunks: list[dict], filename: str):
    """ Save the FAISS index, BM25 index, and chunk metadata to disk(jetson) """
    os.makedirs(INDEX_DIR, exist_ok=True)
    
    # Save FAISS index
    # faiss.write_index(faiss_index, os.path.join(INDEX_DIR, f"{filename}_faiss.index"))
    faiss.write_index(faiss_index, os.path.join(INDEX_DIR, "faiss.index"))

    # Save BM25 index and chunk metadata using pickle
    with open(os.path.join(INDEX_DIR, "bm25.pkl"), "wb") as f:
        pickle.dump(bm25_index, f)

    with open(os.path.join(INDEX_DIR, "chunks.pkl"), "wb") as f:
        pickle.dump(chunks, f)

    ## save embeddings for potential reranking use
    np.save(os.path.join(INDEX_DIR, "embeddings.npy"), 
            embed_model.encode([c["text"] for c in chunks],
                                convert_to_numpy=True,
                                normalize_embeddings=True))
    
    print(f"Index saved for {filename} with {len(chunks)} chunks.")

def load_index():
    """load the persistent indexes and metadata from disk"""
    faiss_path = os.path.join(INDEX_DIR, "faiss.index")
    bm25_path = os.path.join(INDEX_DIR, "bm25.pkl")
    chunks_path = os.path.join(INDEX_DIR, "chunks.pkl")

    if not all(os.path.exists(p) for p in [faiss_path, bm25_path, chunks_path]):
        return None, None, None
    
    faiss_index = faiss.read_index(faiss_path)

    with open(bm25_path, "rb") as f:
        bm25_index = pickle.load(f)

    with open(chunks_path, "rb") as f:
        chunks = pickle.load(f)

    print(f"Loaded index with {len(chunks)} chunks.")
    return faiss_index, bm25_index, chunks

def ingest_pdf(pdf_path: str, filename: str) -> int:
    """ Main function to ingest a PDF and build indexes """

    pages = extract_text_from_pdf(pdf_path)
    chunks = chunk_text(pages, source=filename)
    faiss_index, bm25_index, embeddings = build_index(chunks)
    save_index(faiss_index, bm25_index, chunks, filename)
    return len(chunks)

