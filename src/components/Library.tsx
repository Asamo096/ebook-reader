import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import {
  ArrowDownUp, ArrowRight, BookOpen, ChevronDown, Lock, Moon, Plus,
  Search, Sparkles, Sun, UploadCloud, X,
} from 'lucide-react'
import type { Book, BookFormat } from '../types'
import { FORMAT_INFO } from '../types'
import { SUPPORTED_EXTENSIONS, formatRelativeTime } from '../lib/utils'
import { BookCard } from './BookCard'
import { BookCover } from './BookCover'
import { useObjectUrl } from '../hooks/useObjectUrl'

interface Props {
  books: Book[]
  uiTheme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpen: (book: Book) => void
  onImport: (files: File[]) => void
  onLoadSample: () => void
  onRequestDelete: (book: Book) => void
  onShowDetails: (book: Book) => void
}

type SortMode = 'recent' | 'added' | 'title'
type FormatFilter = 'ALL' | BookFormat

const FORMAT_FILTERS: Array<{ key: FormatFilter; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'EPUB', label: 'EPUB' },
  { key: 'MOBI', label: 'MOBI' },
  { key: 'AZW3', label: 'AZW3' },
  { key: 'PDF', label: 'PDF' },
  { key: 'TXT', label: 'TXT' },
]

const ACCEPT = SUPPORTED_EXTENSIONS.join(',')

export const Library = ({
  books, uiTheme, onToggleTheme, onOpen, onImport, onLoadSample,
  onRequestDelete, onShowDetails,
}: Props) => {
  const [query, setQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL')
  const [sortBy, setSortBy] = useState<SortMode>('recent')
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = books.filter(book => {
      if (formatFilter !== 'ALL' && book.format !== formatFilter) return false
      if (!needle) return true
      return book.title.toLowerCase().includes(needle)
        || book.author.toLowerCase().includes(needle)
        || book.fileName.toLowerCase().includes(needle)
    })
    return list.sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sortBy === 'added') return b.addedAt - a.addedAt
      return (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt)
    })
  }, [books, query, formatFilter, sortBy])

  const continueBook = useMemo(() => {
    const started = books
      .filter(book => book.progress.fraction > 0.001)
      .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))
    return started[0] ?? [...books].sort((a, b) => b.addedAt - a.addedAt)[0]
  }, [books])

  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date())

  const openPicker = () => fileInputRef.current?.click()

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    onImport(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const dragHandlers = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      dragDepth.current++
      setDragging(true)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      handleFiles(event.dataTransfer.files)
    },
  }

  return (
    <div className="library" {...dragHandlers}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={event => handleFiles(event.target.files)}
      />

      <header className="library-topbar">
        <a className="brand" href="#/" aria-label="墨阅首页">
          <span className="brand-seal">墨</span>
          <span className="brand-text">
            <strong>墨阅</strong>
            <small>MOYUE READER</small>
          </span>
        </a>

        <div className="library-topbar__tools">
          <label className="search-field">
            <Search size={16} />
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索书名或作者"
              aria-label="搜索书架"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                <X size={14} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="icon-button"
            onClick={onToggleTheme}
            aria-label={uiTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            title={uiTheme === 'dark' ? '浅色模式' : '深色模式'}
          >
            {uiTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" className="btn btn--primary library-import" onClick={openPicker}>
            <Plus size={17} />
            <span>导入书籍</span>
          </button>
        </div>
      </header>

      <main className="library-main">
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">YOUR PRIVATE LIBRARY · {today}</p>
            <h1>
              把喜欢的故事，
              <br />
              <em>留在手边。</em>
            </h1>
            <p className="hero__lead">
              一个安静、干净的本地阅读空间。支持 EPUB、MOBI、AZW3、PDF 与 TXT，
              进度、笔记和批注都只保存在这台设备上。
            </p>
            <div className="hero__formats">
              {(Object.keys(FORMAT_INFO) as BookFormat[]).map(format => (
                <span key={format} className="format-chip">
                  <i style={{ background: FORMAT_INFO[format].color }} />
                  {format}
                </span>
              ))}
            </div>
          </div>

          <div className="hero__aside">
            {continueBook ? (
              <ContinueCard book={continueBook} onOpen={onOpen} />
            ) : (
              <StarterCard onImport={openPicker} onSample={onLoadSample} />
            )}
          </div>
        </section>

        {books.length > 0 ? (
          <section className="shelf">
            <div className="shelf__head">
              <div className="shelf__title">
                <h2>我的书架</h2>
                <span>{books.length} 本藏书</span>
              </div>
              <div className="shelf__tools">
                <div className="filter-scroll" role="group" aria-label="按格式筛选">
                  {FORMAT_FILTERS.map(filter => (
                    <button
                      key={filter.key}
                      type="button"
                      className={`filter-pill ${formatFilter === filter.key ? 'is-active' : ''}`}
                      onClick={() => setFormatFilter(filter.key)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <label className="sort-select">
                  <ArrowDownUp size={14} />
                  <select
                    value={sortBy}
                    onChange={event => setSortBy(event.target.value as SortMode)}
                    aria-label="排序方式"
                  >
                    <option value="recent">最近阅读</option>
                    <option value="added">最近添加</option>
                    <option value="title">按书名</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
              </div>
            </div>

            {filtered.length > 0 ? (
              <div className="book-grid">
                {filtered.map(book => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onOpen={onOpen}
                    onShowDetails={onShowDetails}
                    onRequestDelete={onRequestDelete}
                  />
                ))}
                {!query && formatFilter === 'ALL' && (
                  <button type="button" className="add-book-tile" onClick={openPicker}>
                    <span><Plus size={22} /></span>
                    <strong>导入新书</strong>
                    <small>EPUB · MOBI · AZW3 · PDF · TXT</small>
                  </button>
                )}
              </div>
            ) : (
              <div className="shelf-empty">
                <Search size={26} />
                <h3>没有找到相符的书</h3>
                <p>换一个关键词，或把格式筛选切回「全部」。</p>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => { setQuery(''); setFormatFilter('ALL') }}
                >
                  清除筛选
                </button>
              </div>
            )}
          </section>
        ) : (
          <section className="library-blank">
            <div className="library-blank__line" />
            <p>
              书架还空着。把电子书拖到页面任意位置，或者
              <button type="button" className="text-link" onClick={openPicker}>选择本地文件</button>
              ，就可以开始了。
            </p>
          </section>
        )}
      </main>

      <footer className="library-footer">
        <span><Lock size={13} /> 所有书籍、进度与笔记仅保存在此浏览器</span>
        <span>墨阅 · 为安静阅读而作</span>
      </footer>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay__inner">
            <div className="drop-overlay__icon">
              <UploadCloud size={34} />
            </div>
            <h2>松手，把它放进书房</h2>
            <p>支持 EPUB、MOBI、AZW3、PDF、TXT，可一次拖入多本</p>
          </div>
        </div>
      )}
    </div>
  )
}

const ContinueCard = ({ book, onOpen }: { book: Book; onOpen: (book: Book) => void }) => {
  const coverUrl = useObjectUrl(book.cover)
  const percent = Math.round(book.progress.fraction * 100)
  const started = book.progress.fraction > 0.001

  return (
    <div className="continue-wrap">
      <div
        className="continue-card"
        style={coverUrl ? { '--cover-bg': `url(${coverUrl})` } as CSSProperties : undefined}
      >
        <div className="continue-card__wash" />
        <div className="continue-card__content">
          <p className="continue-card__eyebrow">
            <BookOpen size={14} />
            {started ? '继续上次的阅读' : '从这本书开始'}
          </p>
          <div className="continue-card__body">
            <button type="button" className="continue-card__cover" onClick={() => onOpen(book)} aria-label={`打开《${book.title}》`}>
              <BookCover book={book} />
            </button>
            <div className="continue-card__info">
              <h3 title={book.title}>{book.title}</h3>
              <p className="continue-card__author">{book.author || '佚名'}</p>
              <p className="continue-card__chapter">
                {book.progress.label
                  ? <>停于 · {book.progress.label}</>
                  : started ? '继续未完的篇章' : '刚刚加入书房'}
              </p>
              {started && (
                <div className="continue-card__progress">
                  <div className="progress-track">
                    <span style={{ width: `${Math.max(2, percent)}%` }} />
                  </div>
                  <span>{percent}%</span>
                </div>
              )}
            </div>
          </div>
          <button type="button" className="continue-card__button" onClick={() => onOpen(book)}>
            {started ? '继续阅读' : '开始阅读'}
            <ArrowRight size={16} />
          </button>
          <p className="continue-card__time">
            {book.lastOpenedAt ? `上次打开于 ${formatRelativeTime(book.lastOpenedAt)}` : `加入于 ${formatRelativeTime(book.addedAt)}`}
          </p>
        </div>
      </div>
    </div>
  )
}

const StarterCard = ({ onImport, onSample }: { onImport: () => void; onSample: () => void }) => (
  <div className="starter-card">
    <ShelfIllustration />
    <div className="starter-card__content">
      <p className="eyebrow">START HERE</p>
      <h2>从一本书开始</h2>
      <p>拖入你的电子书，或从本地选择文件。整座书房都留在你的浏览器里。</p>
      <div className="starter-card__actions">
        <button type="button" className="btn btn--primary" onClick={onImport}>
          <UploadCloud size={16} /> 选择电子书
        </button>
        <button type="button" className="btn btn--ghost starter-sample" onClick={onSample}>
          <Sparkles size={15} /> 读一段示例
        </button>
      </div>
    </div>
  </div>
)

const ShelfIllustration = () => (
  <div className="shelf-illustration" aria-hidden>
    <svg viewBox="0 0 420 280" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="210" cy="132" r="102" fill="var(--accent-wash)" />
      <circle cx="330" cy="58" r="5" fill="var(--accent)" opacity=".4" />
      <circle cx="83" cy="194" r="3.5" fill="var(--accent)" opacity=".32" />
      <path d="M168 52c8-10 21-12 28-6M262 66c9-6 20-3 25 5" stroke="var(--ink-faint)" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M128 219c-6-3-10-9-10-16" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <path d="M292 219c6-3 10-9 10-16" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />

      {/* open book shadow */}
      <ellipse cx="210" cy="230" rx="122" ry="12" fill="rgba(45, 60, 50, 0.12)" />

      {/* book cover */}
      <path d="M94 145c36-8 80-2 116 18 36-20 80-26 116-18v82c-36-8-80-2-116 18-36-20-80-26-116-18v-82Z" fill="#3d5045" />
      <path d="M94 145c36-8 80-2 116 18 36-20 80-26 116-18" stroke="#2c3a31" strokeWidth="1.2" strokeLinejoin="round" />

      {/* pages */}
      <path d="M104 138c34-7 74-1 106 19v79c-32-20-72-26-106-19v-79Z" fill="#fbf5e8" stroke="rgba(61, 80, 69, 0.18)" strokeWidth="1" />
      <path d="M316 138c-34-7-74-1-106 19v79c32-20 72-26 106-19v-79Z" fill="#f6efdf" stroke="rgba(61, 80, 69, 0.18)" strokeWidth="1" />
      <path d="M210 157v79" stroke="rgba(61, 80, 69, 0.28)" strokeWidth="1.2" strokeLinecap="round" />

      {/* text lines */}
      <g stroke="rgba(61, 80, 69, 0.24)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M124 164c22-3 46 1 66 9" />
        <path d="M124 178c22-3 46 1 66 9" />
        <path d="M124 192c16-2 34 0 50 5" opacity=".7" />
      </g>
      <g stroke="rgba(61, 80, 69, 0.24)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M296 164c-22-3-46 1-66 9" />
        <path d="M296 178c-22-3-46 1-66 9" />
        <path d="M296 192c-16-2-34 0-50 5" opacity=".7" />
      </g>

      {/* bookmark ribbon */}
      <path d="M252 96v62l-11-8-11 8V96h22Z" fill="var(--accent)" opacity=".85" />
      <path d="M252 96h-22" stroke="var(--accent-deep)" strokeWidth="1" opacity=".35" />

      {/* little bookmark tab on top */}
      <path d="M196 71h24v14l-12-6-12 6V71Z" fill="var(--accent)" opacity=".28" />

      {/* accent page corner */}
      <path d="M306 218c-12-5-24-9-36-11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity=".5" />

      {/* sparkles */}
      <path d="M342 128h1M352 138h1M332 140h1" stroke="var(--accent)" strokeLinecap="round" strokeWidth="2" opacity=".45" />
    </svg>
  </div>
)
