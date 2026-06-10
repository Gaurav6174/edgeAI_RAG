import { useState } from 'react'
import { ingestPDF } from '../api'

export default function Upload({ onUploadComplete }) {
  const [file, setFile]               = useState(null)
  const [uploading, setUploading]     = useState(false)
  const [error, setError]             = useState(null)
  const [chunksIndexed, setChunksIndexed] = useState(null)
  const [dragging, setDragging]       = useState(false)

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0])
      setError(null)
      setChunksIndexed(null)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped?.type === 'application/pdf') {
      setFile(dropped)
      setError(null)
      setChunksIndexed(null)
    } else {
      setError('Only PDF files are accepted')
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const data = await ingestPDF(file)
      setChunksIndexed(data.chunks_indexed)
      onUploadComplete(data.filename)
      setFile(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      backgroundColor: '#1c1917',
      border: '1px solid #292524',
      borderRadius: '12px',
      padding: '24px',
    }}>
      <h3 style={{
        fontSize: '18px',
        fontWeight: 500,
        color: '#ffffff',
        margin: '0 0 6px 0',
      }}>
        Upload Handbook
      </h3>
      <p style={{
        fontSize: '14px',
        color: '#57534e',
        margin: '0 0 20px 0',
      }}>
        Select a PDF to index for retrieval.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          position: 'relative',
          border: `1px dashed ${dragging ? '#ffffff' : '#44403c'}`,
          borderRadius: '8px',
          padding: '32px 16px',
          textAlign: 'center',
          transition: 'border-color 0.15s',
          cursor: 'pointer',
          backgroundColor: dragging ? '#292524' : 'transparent',
        }}
      >
        <input
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          style={{
            position: 'absolute', inset: 0,
            opacity: 0, cursor: 'pointer', width: '100%', height: '100%',
          }}
        />
        <p style={{
          fontSize: '14px',
          color: file ? '#ffffff' : '#57534e',
          margin: 0,
          pointerEvents: 'none',
        }}>
          {file ? `📄 ${file.name}` : 'Click or drag a PDF here'}
        </p>
      </div>

      {/* Chunk count */}
      {chunksIndexed !== null && (
        <p style={{
          fontSize: '13px',
          color: '#22c55e',
          margin: '10px 0 0 0',
        }}>
          ✓ Indexed {chunksIndexed} chunks
        </p>
      )}

      {/* Error */}
      {error && (
        <p style={{
          fontSize: '13px',
          color: '#ef4444',
          margin: '10px 0 0 0',
        }}>
          {error}
        </p>
      )}

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        style={{
          marginTop: '16px',
          width: '100%',
          height: '40px',
          borderRadius: '999px',
          border: 'none',
          backgroundColor: !file || uploading ? '#292524' : '#ffffff',
          color: !file || uploading ? '#57534e' : '#0c0a09',
          fontSize: '14px',
          fontWeight: 500,
          cursor: !file || uploading ? 'not-allowed' : 'pointer',
          transition: 'background-color 0.15s',
        }}
      >
        {uploading ? 'Ingesting...' : 'Upload & Index'}
      </button>
    </div>
  )
}