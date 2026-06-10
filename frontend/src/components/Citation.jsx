export default function Citation({ citations }) {
  if (!citations || citations.length === 0) return null

  return (
    <div style={{
      marginTop: '16px',
      paddingTop: '12px',
      borderTop: '1px solid #1c1917',
    }}>
      <p style={{
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#57534e',
        margin: '0 0 8px 0',
      }}>
        Sources
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {citations.map((c, i) => (
          <div key={i} style={{
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #292524',
            backgroundColor: '#0c0a09',
          }}>
            <p style={{
              fontSize: '13px',
              color: '#a8a29e',
              fontStyle: 'italic',
              margin: '0 0 4px 0',
              lineHeight: 1.5,
            }}>
              "{c.text}"
            </p>
            <span style={{
              fontSize: '11px',
              color: '#57534e',
              fontStyle: 'normal',
            }}>
              — {c.source}{c.page ? ` (p. ${c.page})` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}