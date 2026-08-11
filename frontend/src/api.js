const BASE = ''  // empty because Vite proxy handles it

// Upload a PDF and trigger ingestion
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

  return res.json()  // { message, chunks_indexed, filename }
}

// Get citations + confidence for a question (non-streaming)
export async function getCitations(question) {
  const res = await fetch(`${BASE}/citations?question=${encodeURIComponent(question)}`)
  if (!res.ok) throw new Error('Citations fetch failed')
  return res.json()  // { citations, confidence, found }
}

// Stream an answer for a question
// onToken is a callback called with each text token as it arrives
export async function streamQuery(question, onToken) {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
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

// Health check — tells us if index is loaded
export async function getHealth() {
  const res = await fetch(`${BASE}/health`)
  if (!res.ok) throw new Error('Health check failed')
  return res.json()  // { status, index_loaded, chunks_count }
}