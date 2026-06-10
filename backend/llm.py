import os
import httpx
import json
from dotenv import load_dotenv

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

def build_prompt(question: str, chunks: list[dict]) -> str:
    """
        Constructs a prompt for the LLM by combining the question
        with the retrieved chunks of information.
    """
    context_block = []
    for i, chunk in enumerate(chunks):
        context_block.append(
        f"Source: {chunk['source']} (Page {chunk['page']})\n{chunk['text']}\n"
        f"{chunk['text']}"
        )

    context = "\n\n".join(context_block)

    prompt = f"""You are a helpful campus handbook assistant.
                Answer the question using ONLY the context provided below.
                If the answer is not in the context, say "I couldn't find this in the handbook."
                Always mention which Source number your answer comes from.

                CONTEXT:
                {context}

                QUESTION: {question}

                ANSWER:"""

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
            "temperature": 0.1,
            "top_p": 0.9,
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
        Sends the prompt to the Ollama LLM and returns the full response.
        Non-streaming version — collects all tokens and returns
        the full answer as a string.
        Used internally for testing.
    """
    full_response = ""
    async for token in query_ollama_stream(question, chunks):
        full_response += token
    return full_response.strip()



