import { useState, useEffect } from 'react'
import Upload from './components/Upload'
import Chat from './components/Chat'
import { getHealth } from './api'

export default function App() {
  const [lastUploaded, setLastUploaded] = useState(null)
  const [indexLoaded, setIndexLoaded]   = useState(false)

  // Check on load if an index already exists from a previous session
  useEffect(() => {
    getHealth()
      .then(data => setIndexLoaded(data.index_loaded))
      .catch(() => {})
  }, [])

  const handleUploadComplete = (filename) => {
    setLastUploaded(filename)
    setIndexLoaded(true)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#000000' }}>

      {/* Navbar */}
      <nav style={{
        height: '60px',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px',
        backgroundColor: '#000000',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <span style={{
          fontFamily: 'Georgia, serif',
          fontSize: '20px',
          fontWeight: 400,
          color: '#ffffff',
        }}>
          Campus Handbook Bot
        </span>

        {/* Live index status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            width: '8px', height: '8px',
            borderRadius: '50%',
            backgroundColor: indexLoaded ? '#ffffff' : '#333333',
          }} />
          <span style={{ fontSize: '13px', color: '#ffffff' }}>
            {indexLoaded ? 'Index loaded' : 'No index'}
          </span>
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        textAlign: 'center',
        padding: '80px 24px 60px',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <h1 style={{
          fontFamily: 'Georgia, serif',
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 300,
          color: '#ffffff',
          lineHeight: 1.1,
          letterSpacing: '-1px',
          margin: '0 0 16px 0',
        }}>
          Your Campus<br />Intelligence Agent.
        </h1>
        <p style={{
          fontSize: '16px',
            color: '#ffffff',
          maxWidth: '480px',
          margin: '0 auto',
          lineHeight: 1.6,
        }}>
          Upload your campus handbook and get instant answers
          powered by on-device edge AI. Zero cloud. Zero latency.
        </p>
      </section>

      {/* Main content */}
      <section style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '60px 24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '32px',
        alignItems: 'start',
      }}>

        {/* Left — upload + status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Upload onUploadComplete={handleUploadComplete} />

          {lastUploaded && (
            <div style={{
              padding: '14px 16px',
              borderRadius: '10px',
              border: '1px solid #ffffff',
              backgroundColor: '#111111',
              fontSize: '14px',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                backgroundColor: '#1a1a1a',
                color: '#ffffff',
                padding: '3px 10px',
                borderRadius: '999px',
              }}>
                Indexed
              </span>
              {lastUploaded}
            </div>
          )}
        </div>

        {/* Right — chat */}
        <Chat />
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid #1a1a1a',
        padding: '24px 40px',
        textAlign: 'center',
      }}>
        <p style={{ fontSize: '13px', color: '#ffffff', margin: 0 }}>
          Campus Handbook Bot · On-Device RAG · NVIDIA Jetson Orin Nano
        </p>
      </footer>

    </div>
  )
}