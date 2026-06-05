# Intelligent Exam Copy Evaluator
On-Device RAG System for Automated Answer Sheet Assessment

**Team:** Titans — Gaurav Chaurasia, Bittu Prajapati

## Overview
An on-device RAG (Retrieval-Augmented Generation) system that automates evaluation of student answer copies. Teachers upload an answer key PDF which is indexed into a local vector store. Scanned student answer sheets are processed with OCR, retrieved against the index, and evaluated by a local LLM to produce cited, question-wise scores and mistake summaries — all without cloud dependency.

## Use Cases
- Schools and coaching institutes evaluating large volumes of descriptive answer copies
- Air-gapped or offline environments where cloud tools are not permitted
- Privacy-sensitive institutions (hospitals, defence, legal) where documents cannot leave premises
- Standardised theory exams in subjects with a predefined answer key

## Key Features
- Cited evaluation: scores are grounded in specific answer-key chunks to avoid hallucinations
- Question-wise scoring: segments student answers and evaluates each question independently
- Mistake identification: pinpoints missing concepts with references to the correct answer
- Aggregate report: per-student summary with total score, weak topics, and feedback
- Pluggable answer keys: drop a new answer-key PDF to re-index instantly

## Scope
Supports printed and semi-handwritten scanned PDFs in English for single-subject, theory-style exams. Diagram-heavy or equation-only answers are out of scope for v1.

## System Architecture
The pipeline has two phases:

- **Phase 1 — Indexing (Answer Key)**
  - Answer key PDF → PDF parser (PyMuPDF)
  - Text chunking → embedding model (nomic-embed-text)
  - Persist embeddings in a vector store (ChromaDB or FAISS)

- **Phase 2 — Evaluation (Student Copy)**n+  - Scanned student PDF → OCR (PaddleOCR or TrOCR)
  - Segment answers by question number
  - Query vector store for top-k relevant answer-key chunks
  - Local LLM (e.g., Mistral 7B or Phi-3 Mini via Ollama) evaluates answers using retrieved context
  - Output: per-question score, missed points, and citations

## Tech Stack
- OCR: PaddleOCR or TrOCR
- PDF parsing: PyMuPDF
- Embeddings: nomic-embed-text
- Vector store: ChromaDB or FAISS (on-disk persistence)
- LLM: Mistral 7B Q4 / Phi-3 Mini via Ollama (local)
- RAG orchestration: LlamaIndex
- Backend: FastAPI (REST interface for evaluation requests)

## Quickstart (high level)
1. Install dependencies listed by the project (Python 3.10+ recommended).
2. Index an answer-key PDF:
   - Parse PDF with PyMuPDF, chunk the text, compute embeddings, and store them in the chosen vector DB.
3. Evaluate a scanned student copy:
   - Run OCR on the scanned PDF, segment by question, retrieve top-k chunks from the vector store, and call the local LLM with the retrieved context to produce a structured evaluation.

## How It Works (concise)
The system uses a local vector index of an instructor-provided answer key to ground evaluations. For each student answer, it retrieves the most relevant answer-key passages and provides the LLM with only those passages as context. The LLM returns structured, cited feedback and scores to ensure evaluations are explainable and reproducible.

## Contributing
Contributions, issues, and feature requests are welcome. Please open issues or pull requests describing proposed changes.

## Authors
- Gaurav Chaurasia
- Bittu Prajapati

## License
Specify a license for the project (e.g., MIT) in a `LICENSE` file.
