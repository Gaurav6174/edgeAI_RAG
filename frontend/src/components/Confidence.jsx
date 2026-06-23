export default function Confidence({ confidence, found }) {
  if (!found) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '10px',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid #1a1a1a',
        backgroundColor: '#111111',
      }}>
        <span style={{
          width: '8px', height: '8px',
          borderRadius: '50%',
          backgroundColor: '#ffffff',
          flexShrink: 0,
        }} />
        <p style={{ fontSize: '13px', color: '#ffffff', margin: 0 }}>
          Not found in the handbook
        </p>
      </div>
    )
  }

  const color = confidence >= 0.7 ? '#ffffff'
    : confidence >= 0.4 ? '#999999'
    : '#666666'

  const label = confidence >= 0.7 ? 'High'
    : confidence >= 0.4 ? 'Medium'
    : 'Low'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
    }}>
      <span style={{
        width: '8px', height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }} />
      <p style={{ fontSize: '12px', color: '#ffffff', margin: 0 }}>
        Confidence:{' '}
        <span style={{ fontWeight: 500, color: '#ffffff' }}>
          {label} ({(confidence * 100).toFixed(0)}%)
        </span>
      </p>
    </div>
  )
}