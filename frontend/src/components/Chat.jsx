import { useState, useRef, useEffect } from 'react'
import { getCitations, streamQuery } from '../api'
import Citation from './Citation'
import Confidence from './Confidence'

export default function Chat() {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef                 = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e) => {
  e.preventDefault()
  if (!input.trim() || isLoading) return

  const question = input
  setMessages(prev => [...prev, { role: 'user', content: question }])
  setInput('')
  setIsLoading(true)

  // Add empty assistant message immediately
  setMessages(prev => [...prev, {
    role: 'assistant',
    content: '',
    citations: [],
    confidence: 0,
    found: false,
  }])

  try {
    // Run citations fetch and stream START in parallel
    const [citationData] = await Promise.all([
      getCitations(question),
      // stream starts immediately, doesn't wait for citations
      streamQuery(question, (token) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          updated[updated.length - 1] = { ...last, content: last.content + token }
          return updated
        })
      })
    ])

    // Update citations after both complete
    setMessages(prev => {
      const updated = [...prev]
      const last = updated[updated.length - 1]
      updated[updated.length - 1] = {
        ...last,
        citations: citationData.found ? citationData.citations : [],
        confidence: citationData.confidence,
        found: citationData.found,
      }
      return updated
    })

  } catch (err) {
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Error: ${err.message}`,
      found: false,
      confidence: 0,
    }])
  } finally {
    setIsLoading(false)
  }
}

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '600px',
      width: '100%',
      backgroundColor: '#111111',
      border: '1px solid #1a1a1a',
      borderRadius: '12px',
      overflow: 'hidden',
    }}>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}>
        {messages.length === 0 && (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <p style={{
              fontFamily: 'Georgia, serif',
              fontSize: '22px',
              fontWeight: 300,
              color: '#ffffff',
              textAlign: 'center',
            }}>
              Ask anything about the handbook.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '80%',
              padding: '14px 16px',
              borderRadius: m.role === 'user'
                ? '12px 12px 2px 12px'
                : '12px 12px 12px 2px',
              backgroundColor: m.role === 'user' ? '#1a1a1a' : '#000000',
              border: m.role === 'assistant' ? '1px solid #1a1a1a' : 'none',
            }}>
              {/* Message text */}
              <p style={{
                fontSize: '18px',
                lineHeight: 1.6,
                  color: m.role === 'user' ? '#ffffff' : '#ffffff',
                margin: 0,
              }}>
                {m.content}
                {/* Blinking cursor while streaming */}
                {isLoading && i === messages.length - 1
                  && m.role === 'assistant' && (
                  <span style={{
                    display: 'inline-block',
                    width: '2px',
                    height: '14px',
                    backgroundColor: '#666666',
                    marginLeft: '2px',
                    verticalAlign: 'middle',
                    animation: 'blink 1s step-end infinite',
                  }} />
                )}
              </p>

              {/* Confidence badge */}
              {m.role === 'assistant' && m.confidence !== undefined && (
                <Confidence confidence={m.confidence} found={m.found ?? false} />
              )}

              {/* Citations */}
              {m.role === 'assistant' && (
                <Citation citations={m.citations} />
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '12px',
          padding: '16px 24px',
          borderTop: '1px solid #1a1a1a',
          backgroundColor: '#111111',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          disabled={isLoading}
          style={{
            flex: 1,
            height: '44px',
            padding: '0 16px',
            borderRadius: '8px',
            border: '1px solid #333333',
            backgroundColor: '#000000',
            color: '#ffffff',
            fontSize: '15px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            height: '44px',
            padding: '0 20px',
            borderRadius: '999px',
            border: 'none',
            backgroundColor: isLoading || !input.trim() ? '#1a1a1a' : '#ffffff',
            color: isLoading || !input.trim() ? '#ffffff' : '#000000',
            fontSize: '14px',
            fontWeight: 500,
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {isLoading ? 'Thinking...' : 'Send'}
        </button>
      </form>

      {/* Cursor blink keyframe */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}