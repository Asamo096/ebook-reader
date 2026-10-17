import { useEffect, useRef, useState } from 'react'
import { BookOpen, Info, MoreHorizontal, Trash2 } from 'lucide-react'
import type { Book } from '../types'
import { FORMAT_INFO } from '../types'
import { formatRelativeTime } from '../lib/utils'
import { BookCover } from './BookCover'

interface Props {
  book: Book
  onOpen: (book: Book) => void
  onShowDetails: (book: Book) => void
  onRequestDelete: (book: Book) => void
}

export const BookCard = ({ book, onOpen, onShowDetails, onRequestDelete }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const format = FORMAT_INFO[book.format]
  const percent = Math.round(Math.min(1, Math.max(0, book.progress.fraction)) * 100)
  const started = book.progress.fraction > 0.001

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <article
      ref={cardRef}
      className="book-card"
      onContextMenu={event => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <div
        className="book-card__cover-wrap"
        role="button"
        tabIndex={0}
        aria-label={`打开《${book.title}》`}
        onClick={() => onOpen(book)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(book)
          }
        }}
      >
        <BookCover book={book} />
        <span className="book-card__format" style={{ background: format.color }}>
          {format.label}
        </span>
        {percent >= 99 && <span className="book-card__finished">已读完</span>}
        {started && (
          <div className="book-card__progress" aria-hidden>
            <span style={{ width: `${Math.max(2, percent)}%` }} />
          </div>
        )}
        <div className="book-card__shade" />
        <div className="book-card__hover-action">
          <BookOpen size={16} />
          <span>{started ? '继续阅读' : '开始阅读'}</span>
        </div>
      </div>

      <div className="book-card__meta">
        <button
          type="button"
          className="book-card__title"
          onClick={() => onOpen(book)}
          title={book.title}
        >
          {book.title}
        </button>
        <div className="book-card__sub">
          <span className="book-card__author">{book.author || '佚名'}</span>
          {started && <span className="book-card__percent">{percent}%</span>}
        </div>
        <div className="book-card__hint">
          {started
            ? `上次阅读 · ${book.lastOpenedAt ? formatRelativeTime(book.lastOpenedAt) : '最近'}`
            : `加入于 ${formatRelativeTime(book.addedAt)}`}
        </div>
      </div>

      <button
        type="button"
        className="book-card__menu-button"
        aria-label="更多操作"
        aria-expanded={menuOpen}
        onClick={event => {
          event.stopPropagation()
          setMenuOpen(open => !open)
        }}
      >
        <MoreHorizontal size={18} />
      </button>

      {menuOpen && (
        <div className="book-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpen(book) }}>
            <BookOpen size={15} /> {started ? '继续阅读' : '开始阅读'}
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onShowDetails(book) }}>
            <Info size={15} /> 书籍信息
          </button>
          <button
            type="button"
            role="menuitem"
            className="book-menu__danger"
            onClick={() => { setMenuOpen(false); onRequestDelete(book) }}
          >
            <Trash2 size={15} /> 从书架移除
          </button>
        </div>
      )}
    </article>
  )
}
