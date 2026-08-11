import { renameBook, deleteBook } from '../api'

export default function BookList({ books, activeBookId, onSelect, onChanged }) {
  const handleRename = async (e, book) => {
    e.stopPropagation()
    const newName = prompt('Rename book', book.filename)
    if (!newName || newName === book.filename) return
    await renameBook(book.book_id, newName)
    onChanged()
  }

  const handleDelete = async (e, book) => {
    e.stopPropagation()
    if (!confirm(`Delete "${book.filename}"? This removes its index permanently.`)) return
    await deleteBook(book.book_id)
    onChanged()
  }

  return (
    <div style={{
      backgroundColor: '#ffffff',
      border: '1px solid #e0e0e0',
      borderRadius: '12px',
      padding: '24px',
    }}>
      <h3 style={{
        fontSize: '18px',
        fontWeight: 500,
        color: '#000000',
        margin: '0 0 6px 0',
      }}>
        Books
      </h3>
      <p style={{
        fontSize: '14px',
        color: '#666666',
        margin: '0 0 16px 0',
      }}>
        Pick which indexed book to ask questions against.
      </p>

      {books.length === 0 ? (
        <p style={{ fontSize: '13px', color: '#999999', margin: 0 }}>
          No books yet — upload a PDF to get started.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {books.map((book) => {
            const selected = book.book_id === activeBookId
            return (
              <li
                key={book.book_id}
                onClick={() => onSelect(book.book_id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${selected ? '#000000' : '#e0e0e0'}`,
                  backgroundColor: selected ? '#f5f5f5' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  flex: 1,
                  fontSize: '14px',
                  color: '#000000',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }} title={book.filename}>
                  {book.filename}
                </span>
                <span style={{
                  fontSize: '11px',
                  color: '#999999',
                  flexShrink: 0,
                }}>
                  {book.chunks_count}
                </span>
                <button
                  onClick={(e) => handleRename(e, book)}
                  title="Rename"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#666666',
                    cursor: 'pointer',
                    fontSize: '13px',
                    padding: '2px 4px',
                  }}
                >
                  ✎
                </button>
                <button
                  onClick={(e) => handleDelete(e, book)}
                  title="Delete"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: '#666666',
                    cursor: 'pointer',
                    fontSize: '13px',
                    padding: '2px 4px',
                  }}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
