import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

def build_prompt(question: str, chunks: list[dict]) -> str:
    context_blocks = []
    for i, chunk in enumerate(chunks):
        context_blocks.append(
            f"[Source {i+1} — {chunk['source']}, page {chunk.get('page', '?')}]\n"
            
        )

    context = "\n\n".join(context_blocks)

    prompt = f"""You are a precise campus handbook assistant.
    Answer the question in 1-3 sentences using ONLY the context below.
    Start your answer directly — no greetings, no preamble.
    Mention the source naturally at the end (e.g. "— Source 1, page 4").
    If the answer is not in the context, say only: "Not found in the handbook."

    Sources:
    {context}

    Student's question: {question}

    Your answer:"""

    return prompt

async def query_ollama_stream(question: str, chunks: list[dict]):
    prompt = build_prompt(question, chunks)

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": True,  #enable token streaming
        "options": {
            "num_predict": 200,
            "temperature": 0.4,
            "top_p": 0.9,
            "top_k": 40,
            "repeat_penalty": 1.1
        }
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_HOST}/api/generate",
            json=payload
        ) as response:
            async for line in response.aiter_lines():
                if line.strip():
                    try:
                        data = json.loads(line)
                        token = data.get("response", "")
                        if token:
                            yield token
                        if data.get("done"):     # Ollama signals end of stream
                            break
                    except json.JSONDecodeError:
                        continue

async def query_ollama(question: str, chunks: list[dict]) -> str:
    """
        Sends the prompt to the Ollama LLM 
    """
    full_response = ""
    async for token in query_ollama_stream(question, chunks):
        full_response += token
    return full_response.strip()



