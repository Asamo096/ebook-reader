import { useObjectUrl } from '../hooks/useObjectUrl'
import type { Book } from '../types'

export const BookCover = ({ book, className = '' }: { book: Book; className?: string }) => {
  const url = useObjectUrl(book.cover)
  return (
    <div className={`book-cover ${className}`}>
      {url ? (
        <img src={url} alt={`《${book.title}》封面`} loading="lazy" draggable={false} />
      ) : (
        <div className="book-cover__fallback">
          <span>{book.title.slice(0, 14)}</span>
          <small>MOYUE</small>
        </div>
      )}
    </div>
  )
}
