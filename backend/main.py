import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv

from models import QueryRequest, QueryResponse, IngestResponse, Citation
from ingest import ingest_pdf, load_index
from retriever import retrieve
from confidence import score_confidence, is_confident
from llm import query_ollama_stream

load_dotenv()

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "../data/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title = "Campus Handbook Bot")

app.add_middleware(
    CORSMiddleware,
    allow_origins = ["http://localhost:5173", "http://localhost:3000"],
    allow_methods = ["*"],
    allow_headers = ["*"],
)

# Load index into memory at startup (if it exists)
faiss_index, bm25_index, chunks = load_index()

## API ENDPOINTS

@app.post("/ingest", response_model=IngestResponse)
async def ingest(file: UploadFile = File(...)):
    global faiss_index, bm25_index, chunks

    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    
    #save the uploaded file to disk
    save_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Run ingestion pipeline
    num_chunks = ingest_pdf(save_path, file.filename)

    # Reload updated index into memory
    faiss_index, bm25_index, chunks = load_index()

    return IngestResponse(
        message="Ingestion complete",
        chunks_indexed=num_chunks,
        filename=file.filename
    )

@app.post("/query")
async def query(request: QueryRequest):
    """
    Accepts a question, retrieves relevant chunks,
    checks confidence, then streams the LLM answer.
    """

    if faiss_index is None:
        raise HTTPException(400, "No documents indexed yet. Please upload a PDF first.")

    #retrieve + rerank
    top_chunks, confidence = retrieve(
        request.question, faiss_index, bm25_index, chunks
    )

    # Confidence gate: if retrieval is weak, don't call the LLM
    if not is_confident(confidence):
        async def not_found_stream():
            yield "I couldn't find this in the handbook."
        return StreamingResponse(not_found_stream(), media_type="text/plain")

    # Stream LLM response token by token
    return StreamingResponse(
        query_ollama_stream(request.question, top_chunks),
        media_type="text/plain"
    )

@app.get("/citations")
async def get_citations(question: str):
    """
    Separate endpoint to get citations for a question.
    Frontend calls this alongside /query to display sources.
    """

    if faiss_index is None:
        return {"citations": [], "confidence": 0.0, "found": False}

    top_chunks, confidence = retrieve(
        question, faiss_index, bm25_index, chunks
    )

    found = is_confident(confidence)
    citations = [
        Citation(
            text = c["text"][:300] + "..." if len(c["text"]) > 300 else c["text"],
            source = c["source"],
            page = c.get("page")
        )   
        for c in top_chunks
    ]   if found else []

    return {
        "citations": [c.dict() for c in citations],
        "confidence": round(confidence, 3),
        "found": found
    }

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "index_loaded": faiss_index is not None,
        "chunk_count": len(chunks) if chunks else 0
    }