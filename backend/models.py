from pydantic import BaseModel
from typing import Optional

## request

class QueryRequest(BaseModel):
    question: str
    book_id: Optional[str] = None

##response
class Citation(BaseModel):
    text: str
    source: str
    page: Optional[int] = None

class QueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    confidence: float
    found: bool

class IngestResponse(BaseModel):
    message: str
    chunks_indexed: int
    filename: str
    book_id: str

class Book(BaseModel):
    book_id: str
    filename: str
    chunks_count: int