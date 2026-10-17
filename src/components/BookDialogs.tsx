import { ArrowRight, BookOpen, CalendarDays, Clock3, FileText, Trash2 } from 'lucide-react'
import type { Book } from '../types'
import { FORMAT_INFO } from '../types'
import { formatBytes, formatDate, formatRelativeTime } from '../lib/utils'
import { useObjectUrl } from '../hooks/useObjectUrl'
import { Modal } from './Modal'
import { BookCover } from './BookCover'

interface Props {
  deleteTarget: Book | null
  detailsTarget: Book | null
  onCloseDelete: () => void
  onCloseDetails: () => void
  onConfirmDelete: (book: Book) => void
  onOpen: (book: Book) => void
  onRequestDelete: (book: Book) => void
}

export const BookDialogs = ({
  deleteTarget, detailsTarget, onCloseDelete, onCloseDetails,
  onConfirmDelete, onOpen, onRequestDelete,
}: Props) => (
  <>
    <Modal
      open={!!deleteTarget}
      onClose={onCloseDelete}
      className="dialog dialog--confirm"
      label="确认移除书籍"
    >
      {deleteTarget && (
        <ConfirmDelete book={deleteTarget} onCancel={onCloseDelete} onConfirm={onConfirmDelete} />
      )}
    </Modal>
    <Modal
      open={!!detailsTarget}
      onClose={onCloseDetails}
      className="dialog dialog--details"
      label="书籍信息"
    >
      {detailsTarget && (
        <BookDetails
          book={detailsTarget}
          onOpen={() => onOpen(detailsTarget)}
          onRequestDelete={() => {
            onCloseDetails()
            onRequestDelete(detailsTarget)
          }}
        />
      )}
    </Modal>
  </>
)

const ConfirmDelete = ({ book, onCancel, onConfirm }: {
  book: Book
  onCancel: () => void
  onConfirm: (book: Book) => void
}) => (
  <div className="confirm">
    <div className="confirm__icon"><Trash2 size={22} /></div>
    <h3>移出《{book.title}》？</h3>
    <p>书籍文件以及这本书的高亮、笔记和书签都会从本地删除，且无法恢复。</p>
    <div className="confirm__actions">
      <button type="button" className="btn btn--ghost" onClick={onCancel}>取消</button>
      <button type="button" className="btn btn--danger" onClick={() => onConfirm(book)}>确认移除</button>
    </div>
  </div>
)

const BookDetails = ({ book, onOpen, onRequestDelete }: {
  book: Book
  onOpen: () => void
  onRequestDelete: () => void
}) => {
  const coverUrl = useObjectUrl(book.cover)
  const percent = Math.round(book.progress.fraction * 100)
  const format = FORMAT_INFO[book.format]

  return (
    <div className="details">
      <div
        className="details__backdrop"
        style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
      />
      <div className="details__headed">
        <BookCover book={book} className="details__cover" />
        <div className="details__intro">
          <span className="details__format" style={{ color: format.color }}>
            {format.label} · {formatBytes(book.fileSize)}
          </span>
          <h2>{book.title}</h2>
          <p className="details__author">{book.author || '佚名'}</p>
          <p className="details__file" title={book.fileName}>{book.fileName}</p>
        </div>
      </div>

      {book.description && (
        <p className="details__description">{book.description}</p>
      )}

      <div className="details__stats">
        <div>
          <FileText size={16} />
          <span>阅读进度</span>
          <strong>{percent}%</strong>
        </div>
        <div>
          <Clock3 size={16} />
          <span>上次阅读</span>
          <strong>{book.lastOpenedAt ? formatRelativeTime(book.lastOpenedAt) : '尚未开始'}</strong>
        </div>
        <div>
          <CalendarDays size={16} />
          <span>加入书架</span>
          <strong>{formatDate(book.addedAt)}</strong>
        </div>
      </div>

      <div className="details__progress" aria-hidden>
        <span style={{ width: `${Math.max(1.5, percent)}%` }} />
      </div>
      {book.progress.label && (
        <p className="details__location">上次停在这里：{book.progress.label}</p>
      )}

      <div className="details__actions">
        <button type="button" className="btn btn--primary" onClick={onOpen}>
          <BookOpen size={16} />
          {percent > 0 ? '继续阅读' : '开始阅读'}
          <ArrowRight size={15} />
        </button>
        <button type="button" className="btn btn--ghost btn--danger-text" onClick={onRequestDelete}>
          <Trash2 size={15} />
          移出书架
        </button>
      </div>
    </div>
  )
}
