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
        border: '1px solid #e0e0e0',
        backgroundColor: '#f5f5f5',
      }}>
        <span style={{
          width: '8px', height: '8px',
          borderRadius: '50%',
          backgroundColor: '#666666',
          flexShrink: 0,
        }} />
        {/* <p style={{ fontSize: '13px', color: '#ffffff', margin: 0 }}>
          Not found in the handbook
        </p>*/}
      </div>
    )
  }

  const color = confidence >= 0.7 ? '#000000'
    : confidence >= 0.4 ? '#666666'
    : '#999999'

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
      <p style={{ fontSize: '12px', color: '#000000', margin: 0 }}>
        Confidence:{' '}
        <span style={{ fontWeight: 500, color: '#000000' }}>
          {label} ({(confidence * 100).toFixed(0)}%)
        </span>
      </p>
    </div>
  )
}