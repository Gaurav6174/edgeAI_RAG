import os
from dotenv import load_dotenv

load_dotenv()

THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", 0.35))

def score_confidence(similarity_score: list[float]) -> float:
    if not similarity_score:
        return 0.0
    return float(max(similarity_score))

def is_confident(confidence: float) -> bool:
    return confidence >= THRESHOLD