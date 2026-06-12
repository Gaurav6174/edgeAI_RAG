import os
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer, CrossEncoder
from dotenv import load_dotenv

load_dotenv()

EMBED_MODEL =       os.getenv("EMBED_MODEL")
TOP_K =             int(os.getenv("TOP_K", 10))
RERANK_TOP_N =      int(os.getenv("RERANK_TOP_N", 3))

# Load models at module level to avoid reloading on every call
embed_model = SentenceTransformer(EMBED_MODEL)

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def dense_search(query: str, faiss_index, chunks: list[dict], top_k: int) -> list[tuple]:
    """
        Embeds the query and finds the most similar chunks
        using FAISS (semantic/dense search).
        Returns list of (chunk, score) tuples.
    """


    query_vec = embed_model.encode(
        [query],
        normalize_embeddings = True,
        convert_to_numpy = True
    )

    # FAISS returns distances and indices of top_k nearest neighbours
    scores, indices = faiss_index.search(query_vec, top_k)

    results = []
    for idx, score in zip(indices[0], scores[0]):
        if idx == -1:
            continue  # no more results
        results.append((chunks[idx], float(score)))

    return results

def sparse_search(query: str, bm25_index, chunks: list[dict], top_k: int) -> list[tuple]:
    """
        Uses BM25 to find relevant chunks based on keyword matching.
        Returns list of (chunk, score) tuples.
    """
    tokenized_query = query.lower().split()
    scores = bm25_index.get_scores(tokenized_query)

    #indices of top_k highest scores
    top_indices = np.argsort(scores)[::-1][:top_k]

    results = []
    for idx in top_indices:
        if scores[idx] > 0:
            results.append((chunks[idx], float(scores[idx])))

    return results

def hybrid_search(query: str, faiss_index, bm25_index, chunks: list[dict]) -> list[tuple]:
    """
        Combines dense and sparse results using Reciprocal Rank Fusion (RRF)

    """
    dense_results = dense_search(query, faiss_index, chunks, TOP_K)
    sparse_results = sparse_search(query, bm25_index, chunks, TOP_K)

    # Build a map from chunk text → RRF score
    rrf_scores = {}
    chunk_map = {}    #text → chunk dict (to retrieve later)

    #for dense
    for rank, (chunk, score) in enumerate(dense_results):
        key = chunk["text"]
        rrf_scores[key] = rrf_scores.get(key, 0) + 1 / (rank + 60)
        chunk_map[key] = chunk
    
    #for sparse
    for rank, (chunk, score) in enumerate(sparse_results):
        key = chunk["text"]
        rrf_scores[key] = rrf_scores.get(key, 0) + 1 / (rank + 60)
        chunk_map[key] = chunk

    # Sort by combined RRF score descending
    sorted_keys = sorted(rrf_scores.keys(), key=lambda k: rrf_scores[k], reverse=True)
    return [(chunk_map[k], rrf_scores[k]) for k in sorted_keys[:TOP_K]]

def rerank(query: str, candidates: list[tuple]) -> list[tuple]:
    """
        Reranks the top candidates using a Cross-Encoder for better relevance.
        Returns list of (chunk, score) tuples sorted by relevance.
    """
    if not candidates:
        return []

    # Cross-encoder needs (query, text) pairs
    pairs = [(query, chunk["text"]) for chunk, _ in candidates]
    scores = reranker.predict(pairs)

    # Attach new scores and sort
    reranked = sorted(
        zip([c for c, _ in candidates], scores),
        key=lambda x: x[1],
        reverse=True
    )
    return reranked[:RERANK_TOP_N]

def retrieve(query: str, faiss_index, bm25_index, chunks: list[dict]) -> list[dict]:
    """
        Main retrieval function that performs hybrid search and reranking.
        Returns list of top relevant chunks with their metadata.
    """

    hyrid_results = hybrid_search(query, faiss_index, bm25_index, chunks)
    reranked = rerank(query, hyrid_results)

    if not reranked:
        return [], 0.0
    
    top_chunks = [chunk for chunk, _ in reranked]
    confidence_score = float(reranked[0][1]) # highest relevance score from reranker

    return top_chunks, confidence_score
