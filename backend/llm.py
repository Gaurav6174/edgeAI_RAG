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
            f"{chunk['text']}"
        )
    context = "\n\n".join(context_blocks)

    prompt = f"""You are a precise document assistant. Answer questions using ONLY the context below.

Rules:
- Answer in one sentence or less — match the brevity of the question
- If the answer is a number, date, name, or short phrase, give ONLY that value
- If listing multiple items, separate them with commas or "and" — never use bullet points or newlines
- No greetings, no preamble, no "According to...", no "Based on..."
- Do not repeat the question
- If the answer is not in the context, respond with exactly: Not found.

Context:
{context}

Question: {question}
Answer:"""

    return prompt

async def query_ollama_stream(question: str, chunks: list[dict]):
    prompt = build_prompt(question, chunks)

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": True,  #enable token streaming
        "options": {
            "temperature": 0.1,      # back to low — factual short answers need determinism
            "top_p": 0.9,
            "top_k": 40,
            "repeat_penalty": 1.1,
            "num_predict": 100,      # most answers are under 30 tokens, 100 is safe ceiling
            "stop": ["\n\n", "Question:", "Context:"]  # stop generating at double newline or if it starts looping
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



