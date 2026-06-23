import asyncio
import csv
import json
import os

import httpx
from sentence_transformers import SentenceTransformer, util

BASE_URL = "http://localhost:8000"
CSV_PATH = "../data/eval/questions.csv"
REPORT_PATH = "../data/eval/eval_report.json"
SIMILARITY_THRESHOLD = 0.6


embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def semantic_similarity(text1: str, text2: str) -> float:
    if not text1 or not text2:
        return 0.0
    emb1 = embedder.encode(text1, convert_to_tensor=True)
    emb2 = embedder.encode(text2, convert_to_tensor=True)
    return float(util.cos_sim(emb1, emb2))


async def ask(question: str, client: httpx.AsyncClient) -> dict:
    # get citations + confidence (non-streaming)
    cit_res = await client.get(f"{BASE_URL}/citations", params={"question": question})
    cit_data = cit_res.json()

    # get full answer by taking the stream
    answer = ""
    async with client.stream(
        "POST", f"{BASE_URL}/query", json={"question": question}
    ) as res:
        async for chunk in res.aiter_text():
            answer += chunk

    return {
        "answer": answer.strip(),
        "confidence": cit_data["confidence"],
        "found": cit_data["found"],
        "citations": cit_data.get("citations", []),
    }


async def evaluate(csv_path: str):
    # load dataset
    with open(csv_path, encoding="utf-8") as f:
        dataset = list(csv.DictReader(f))

    print(f"Loaded {len(dataset)} questions from {csv_path}\n")

    results = []
    total = len(dataset)

    async with httpx.AsyncClient(timeout=120.0) as client:
        for idx, row in enumerate(dataset):
            question = row["question"]
            expected = row["answer"]

            # CSV stores booleans as strings — normalise here
            answerable = row["answerable"].strip().lower() in ("true", "1", "yes")

            print(f"[{idx + 1}/{total}] {question[:65]}...")

            try:
                result = await ask(question, client)
            except Exception as e:
                print(f"   Request failed: {e}")
                results.append(
                    {
                        "question": question,
                        "expected": expected,
                        "got": "",
                        "answerable": answerable,
                        "system_found": False,
                        "confidence": 0.0,
                        "similarity": 0.0,
                        "correct": False,
                        "outcome": "ERROR",
                    }
                )
                continue

            system_answered = result["found"]

            # semantic similarity only makes sense when both sides have text
            similarity = (
                semantic_similarity(expected, result["answer"])
                if answerable and system_answered and expected
                else 0.0
            )
            correct_answer = similarity >= SIMILARITY_THRESHOLD

            # classify outcome
            if answerable and system_answered and correct_answer:
                outcome = "TP"  # correctly answered
            elif answerable and system_answered and not correct_answer:
                outcome = "FP_wrong"  # answered but wrong
            elif answerable and not system_answered:
                outcome = "FN"  # missed an answerable question
            elif not answerable and system_answered:
                outcome = "FP_hallucination"  # answered when it shouldn't have
            else:
                outcome = "TN"  # correctly said "not found"

            print(
                f"  → outcome: {outcome} | confidence: {result['confidence']:.2f} | similarity: {similarity:.2f}"
            )

            results.append(
                {
                    "question": question,
                    "expected": expected,
                    "got": result["answer"][:300],
                    "answerable": answerable,
                    "system_found": system_answered,
                    "confidence": round(result["confidence"], 3),
                    "similarity": round(similarity, 3),
                    "correct": correct_answer,
                    "outcome": outcome,
                }
            )

    # compute metrics
    TP = sum(1 for r in results if r["outcome"] == "TP")
    FP = sum(1 for r in results if "FP" in r["outcome"])
    FN = sum(1 for r in results if r["outcome"] == "FN")
    TN = sum(1 for r in results if r["outcome"] == "TN")

    precision = TP / (TP + FP) if (TP + FP) > 0 else 0
    recall = TP / (TP + FN) if (TP + FN) > 0 else 0
    f1 = (
        2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    )
    accuracy = (TP + TN) / len(results) if results else 0

    # build report
    report = {
        "total_questions": len(results),
        "metrics": {
            "accuracy": round(accuracy, 3),
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1_score": round(f1, 3),
        },
        "breakdown": {
            "true_positives": TP,
            "true_negatives": TN,
            "false_positives": FP,
            "false_negatives": FN,
        },
        "per_question": results,
    }

    # save
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)


if __name__ == "__main__":
    asyncio.run(evaluate(CSV_PATH))
