import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark, ChevronRight, Highlighter, ListTree, Pencil, Search, Trash2, X,
} from 'lucide-react'
import type { Annotation, ReaderLocation, SearchHit, SearchState, TocItem } from '../../types'
import { HIGHLIGHT_COLORS } from '../../types'
import { formatRelativeTime } from '../../lib/utils'

export type SideTab = 'toc' | 'notes' | 'bookmarks'

interface SidePanelProps {
  open: boolean
  tab: SideTab
  onTab: (tab: SideTab) => void
  onClose: () => void
  toc: TocItem[]
  isPdf: boolean
  totalPages: number
  location: ReaderLocation | null
  annotations: Annotation[]
  onSelectToc: (item: TocItem) => void
  onJumpPage: (page: number) => void
  onSelectAnnotation: (annotation: Annotation) => void
  onEditAnnotation: (annotation: Annotation) => void
  onDeleteAnnotation: (annotation: Annotation) => void
}

interface FlatToc extends TocItem { depth: number }

const flatten = (items: TocItem[], depth = 0): FlatToc[] =>
  items.flatMap(item => [
    { ...item, depth },
    ...(item.subitems ? flatten(item.subitems, depth + 1) : []),
  ])

export const SidePanel = ({
  open, tab, onTab, onClose, toc, isPdf, totalPages, location,
  annotations, onSelectToc, onJumpPage, onSelectAnnotation,
  onEditAnnotation, onDeleteAnnotation,
}: SidePanelProps) => {
  const [pageInput, setPageInput] = useState('')
  const flatToc = useMemo(() => flatten(toc), [toc])
  const notes = useMemo(
    () => annotations.filter(item => item.kind === 'highlight').sort((a, b) => b.updatedAt - a.updatedAt),
    [annotations],
  )
  const bookmarks = useMemo(
    () => annotations.filter(item => item.kind === 'bookmark').sort((a, b) => b.createdAt - a.createdAt),
    [annotations],
  )

  if (!open) return null

  return (
    <aside className="reader-drawer reader-drawer--left" aria-label="阅读导航">
      <div className="drawer-head">
        <div className="drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'toc'}
            className={tab === 'toc' ? 'is-active' : ''}
            onClick={() => onTab('toc')}
          >
            <ListTree size={15} /> 目录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'notes'}
            className={tab === 'notes' ? 'is-active' : ''}
            onClick={() => onTab('notes')}
          >
            <Highlighter size={15} /> 笔记
            {notes.length > 0 && <span className="tab-count">{notes.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bookmarks'}
            className={tab === 'bookmarks' ? 'is-active' : ''}
            onClick={() => onTab('bookmarks')}
          >
            <Bookmark size={15} /> 书签
            {bookmarks.length > 0 && <span className="tab-count">{bookmarks.length}</span>}
          </button>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭侧栏">
          <X size={17} />
        </button>
      </div>

      <div className="drawer-body">
        {tab === 'toc' && (
          <div className="toc-panel">
            {isPdf && (
              <form
                className="page-jump"
                onSubmit={event => {
                  event.preventDefault()
                  const page = Number(pageInput)
                  if (page >= 1 && page <= totalPages) {
                    onJumpPage(page)
                    setPageInput('')
                  }
                }}
              >
                <label htmlFor="page-jump-input">跳到页码</label>
                <div>
                  <input
                    id="page-jump-input"
                    type="number"
                    min={1}
                    max={totalPages}
                    value={pageInput}
                    onChange={event => setPageInput(event.target.value)}
                    placeholder={`1 – ${totalPages}`}
                  />
                  <button type="submit" className="btn btn--ghost btn--sm">跳转</button>
                </div>
              </form>
            )}
            {flatToc.length ? (
              <nav className="toc-list" aria-label="目录">
                {flatToc.map((item, index) => {
                  const active = isPdf
                    ? item.page != null && item.page === location?.page
                    : !!item.href && item.href === location?.tocHref
                  return (
                    <button
                      key={`${item.href ?? item.label}-${index}`}
                      type="button"
                      className={`toc-item ${active ? 'is-active' : ''}`}
                      style={{ paddingLeft: 14 + Math.min(item.depth, 4) * 15 }}
                      onClick={() => onSelectToc(item)}
                      title={item.label}
                    >
                      <span className="toc-item__label">{item.label}</span>
                      {isPdf && item.page != null && <span className="toc-item__page">{item.page}</span>}
                    </button>
                  )
                })}
              </nav>
            ) : (
              <div className="drawer-empty drawer-empty--toc">
                <ListTree size={28} />
                <h3>这本书没有目录</h3>
                <p>{isPdf ? '可以拖动底部进度条，或在上方输入页码跳转。' : '不过你仍然可以正常阅读、搜索与做笔记。'}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'notes' && (
          <div className="notes-panel">
            {notes.length ? (
              notes.map(annotation => (
                <article
                  key={annotation.id}
                  className="note-card"
                  onClick={() => onSelectAnnotation(annotation)}
                >
                  <span
                    className="note-card__stripe"
                    style={{ background: HIGHLIGHT_COLORS[annotation.color ?? 'amber'].value }}
                  />
                  <div className="note-card__content">
                    <blockquote>{annotation.quote}</blockquote>
                    {annotation.note && <p>{annotation.note}</p>}
                    <div className="note-card__meta">
                      <span>{annotation.chapter || (annotation.page ? `第 ${annotation.page} 页` : '书中位置')}</span>
                      <time>{formatRelativeTime(annotation.updatedAt)}</time>
                    </div>
                  </div>
                  <div className="note-card__actions">
                    <button
                      type="button"
                      aria-label="编辑笔记"
                      onClick={event => { event.stopPropagation(); onEditAnnotation(annotation) }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="删除笔记"
                      onClick={event => { event.stopPropagation(); onDeleteAnnotation(annotation) }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="drawer-empty">
                <Highlighter size={28} />
                <h3>还没有笔记</h3>
                <p>阅读时选中一段文字，就可以用四种颜色高亮，并写下你的想法。</p>
              </div>
            )}
          </div>
        )}

        {tab === 'bookmarks' && (
          <div className="bookmarks-panel">
            {bookmarks.length ? (
              bookmarks.map(annotation => (
                <article
                  key={annotation.id}
                  className="bookmark-card"
                  onClick={() => onSelectAnnotation(annotation)}
                >
                  <Bookmark size={16} fill="currentColor" />
                  <div>
                    <strong>{annotation.quote || '书签'}</strong>
                    <span>
                      {annotation.chapter || (annotation.page ? `第 ${annotation.page} 页` : '')}
                      {' · '}
                      {formatRelativeTime(annotation.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="删除书签"
                    onClick={event => { event.stopPropagation(); onDeleteAnnotation(annotation) }}
                  >
                    <Trash2 size={14} />
                  </button>
                </article>
              ))
            ) : (
              <div className="drawer-empty">
                <Bookmark size={28} />
                <h3>还没有书签</h3>
                <p>按 B 或点击顶部书签图标，把此刻停下的位置记下来。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

interface SearchPanelProps {
  open: boolean
  state: SearchState
  query: string
  isPdf: boolean
  onQueryChange: (query: string) => void
  onClose: () => void
  onSelectHit: (hit: SearchHit) => void
}

export const SearchPanel = ({
  open, state, query, isPdf, onQueryChange, onClose, onSelectHit,
}: SearchPanelProps) => {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <aside className="reader-drawer reader-drawer--right search-panel" aria-label="全书搜索">
      <div className="drawer-head drawer-head--simple">
        <div>
          <span className="drawer-eyebrow">SEARCH IN BOOK</span>
          <h2>搜索全书</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭搜索">
          <X size={17} />
        </button>
      </div>
      <div className="search-input-row">
        <Search size={16} />
        <input
          ref={inputRef}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="输入关键词，回车无需确认"
          aria-label="搜索关键词"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange('')} aria-label="清空搜索">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="search-status">
        {state.running ? (
          <>
            <span>正在查找… {Math.round(state.progress * 100)}%</span>
            <div className="search-progress"><span style={{ width: `${Math.max(3, state.progress * 100)}%` }} /></div>
          </>
        ) : state.query ? (
          <span>{state.total > 0 ? `找到 ${state.total} 处结果` : '没有找到结果'}</span>
        ) : (
          <span>{isPdf ? '搜索基于 PDF 文字层，扫描版可能无法搜索' : '在整本书中寻找一句话'}</span>
        )}
      </div>

      <div className="search-results">
        {state.error && <p className="search-error">{state.error}</p>}
        {!state.query || state.total === 0 ? (
          <div className="drawer-empty drawer-empty--search">
            <Search size={26} />
            <h3>{state.query && !state.running ? '没有找到相符的文字' : '从一个词开始'}</h3>
            <p>
              {state.query && !state.running
                ? '试试更短的关键词，或检查是否为扫描版 PDF。'
                : '可以搜索人物名、地点，或记得的只言片语。'}
            </p>
          </div>
        ) : state.groups.map(group => (
          <section key={group.label} className="search-group">
            <h3>{group.label}<span>{group.hits.length}</span></h3>
            {group.hits.map(hit => (
              <button
                type="button"
                key={hit.id}
                className="search-hit"
                onClick={() => onSelectHit(hit)}
              >
                <span>
                  {hit.pre}
                  <mark>{hit.match}</mark>
                  {hit.post}
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}
