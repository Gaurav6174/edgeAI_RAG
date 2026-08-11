const BASE = ''  // empty because Vite proxy handles it

// List all indexed books
export async function getBooks() {
  const res = await fetch(`${BASE}/books`)
  if (!res.ok) throw new Error('Failed to load books')
  return res.json()  // [{ book_id, filename, chunks_count, ingested_at }]
}

// Upload a PDF and trigger ingestion — indexes it as its own book
export async function ingestPDF(file) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${BASE}/ingest`, {
    method: 'POST',
    body: formData,
    // do NOT set Content-Type — browser sets multipart boundary automatically
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || 'Upload failed')
  }

  return res.json()  // { message, chunks_indexed, filename, book_id }
}

// Rename a book
export async function renameBook(bookId, filename) {
  const res = await fetch(`${BASE}/books/${encodeURIComponent(bookId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  if (!res.ok) throw new Error('Rename failed')
  return res.json()  // { book_id, filename, chunks_count, ingested_at }
}

// Delete a book and its index
export async function deleteBook(bookId) {
  const res = await fetch(`${BASE}/books/${encodeURIComponent(bookId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Delete failed')
  return res.json()  // { deleted: book_id }
}

// Get citations + confidence for a question against a specific book (non-streaming)
export async function getCitations(question, bookId) {
  const params = new URLSearchParams({ question })
  if (bookId) params.set('book_id', bookId)
  const res = await fetch(`${BASE}/citations?${params.toString()}`)
  if (!res.ok) throw new Error('Citations fetch failed')
  return res.json()  // { citations, confidence, found }
}

// Stream an answer for a question against a specific book
// onToken is a callback called with each text token as it arrives
export async function streamQuery(question, bookId, onToken) {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, book_id: bookId }),
  })

  if (!res.ok) throw new Error('Query failed')
  if (!res.body) throw new Error('No stream body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const token = decoder.decode(value, { stream: true })
    onToken(token)  // caller decides what to do with each token
  }
}

// Health check — tells us how many books/chunks are loaded
export async function getHealth() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error('Health check failed')
  return res.json()  // { status, index_loaded, chunk_count, books_loaded }
}
