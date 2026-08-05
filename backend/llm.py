import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://172.17.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
API_URL      = f"{OLLAMA_HOST}/api/generate"


def build_prompt(question: str, chunks: list[dict]) -> str:
    context_blocks = []
    for i, chunk in enumerate(chunks):
        context_blocks.append(
            f"[Source {i+1} — {chunk['source']}, page {chunk.get('page', '?')}]\n"
            f"{chunk['text']}"
        )
    context = "\n\n".join(context_blocks)
    return f"""You are a precise document assistant. Answer questions using ONLY the context below.

Rules:
- Answer in one sentence or less — match the brevity of the question
- If the answer is a number, date, name, or short phrase, give ONLY that value
- If listing multiple items, separate them with commas or "and" — never bullet points or newlines
- No greetings, no preamble, no "According to...", no "Based on..."
- Do not repeat the question
- If the answer is not in the context, respond with exactly: Not found.

Context:
{context}

Question: {question}
Answer:"""


async def query_ollama_stream(question: str, chunks: list[dict]):
    """
    Uses requests (sync) wrapped to yield tokens.
    Their API works without streaming — we get full response and yield it once.
    """
    prompt  = build_prompt(question, chunks)
    payload = {
        "model":  OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_ctx":  1024,
            "num_gpu":  1,
            "use_mmap": True,
            "temperature":    0.1,
            "top_k":          40,
            "repeat_penalty": 1.1,
            "num_predict":    200,
        }
    }
    try:
        response = requests.post(API_URL, json=payload, timeout=120)
        if response.status_code == 200:
            answer = response.json().get("response", "").strip()
            yield answer
        else:
            yield f"Error {response.status_code}: {response.text}"
    except requests.exceptions.RequestException as e:
        yield f"Connection Error: {e}"


async def query_ollama(question: str, chunks: list[dict]) -> str:
    full = ""
    async for token in query_ollama_stream(question, chunks):
        full += token
    return full.strip()
