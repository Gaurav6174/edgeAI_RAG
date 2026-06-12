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
            # f"{chunk['text']}"
        )

    context = "\n\n".join(context_blocks)

    prompt = f"""You are a friendly and knowledgeable campus assistant. \
    Students come to you with questions about campus life, rules, fees, and procedures. \
    You give clear, helpful answers in a warm and approachable tone — like a senior student \
    who knows the handbook inside out.

    Use ONLY the information in the sources below to answer. \
    If the answer isn't there, say so honestly. \
    Always mention which source your answer comes from, naturally worked into your response \
    (e.g. "According to the handbook..." or "As mentioned on page 12...").

    Sources:
    {context}

    Student's question: {question}

    Your answer:"""

    return prompt

async def query_ollama_stream(question: str, chunks: list[dict]):
    """
        Sends the prompt to the Ollama LLM and yields the response as a stream.
    """
    prompt = build_prompt(question, chunks)

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": True,  #enable token streaming
        "options": {
            "num_predict": 512,
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



