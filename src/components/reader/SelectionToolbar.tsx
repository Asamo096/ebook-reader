import { Copy, MessageSquare, Search } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { HighlightColor, ScreenRect, SelectionInfo } from '../../types'
import { HIGHLIGHT_COLORS } from '../../types'

interface Props {
  selection: SelectionInfo
  onHighlight: (color: HighlightColor) => void
  onNote: () => void
  onCopy: () => void
  onSearch: () => void
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const SelectionToolbar = ({ selection, onHighlight, onNote, onCopy, onSearch }: Props) => {
  const rect = selection.rect
  if (!rect) return null
  const width = 262
  const height = 46
  const viewportWidth = window.innerWidth
  const left = clamp(rect.left + rect.width / 2 - width / 2, 12, viewportWidth - width - 12)
  const showBelow = rect.top < height + 84
  const top = showBelow ? rect.bottom + 12 : rect.top - height - 14

  return (
    <div
      className={`selection-toolbar ${showBelow ? 'selection-toolbar--below' : ''}`}
      style={{ left, top, width }}
      onPointerDown={event => event.stopPropagation()}
      role="toolbar"
      aria-label="选中文字操作"
    >
      <div className="selection-toolbar__colors">
        {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(key => (
          <button
            key={key}
            type="button"
            className="color-dot color-dot--small"
            style={{ '--dot-color': HIGHLIGHT_COLORS[key].value } as CSSProperties}
            onClick={() => onHighlight(key)}
            title={`${HIGHLIGHT_COLORS[key].label}高亮`}
            aria-label={`${HIGHLIGHT_COLORS[key].label}高亮`}
          />
        ))}
      </div>
      <span className="selection-toolbar__divider" />
      <button type="button" className="selection-toolbar__action" onClick={onNote} title="添加笔记">
        <MessageSquare size={16} />
      </button>
      <button type="button" className="selection-toolbar__action" onClick={onCopy} title="复制">
        <Copy size={16} />
      </button>
      <button type="button" className="selection-toolbar__action" onClick={onSearch} title="在书中搜索">
        <Search size={16} />
      </button>
    </div>
  )
}

export const AnnotationPopover = ({ quote, note, color, createdAt, rect, onEdit, onCopy, onDelete }: {
  quote: string
  note?: string
  color: HighlightColor
  createdAt: number
  rect: ScreenRect | null
  onEdit: () => void
  onCopy: () => void
  onDelete: () => void
}) => {
  const width = 310
  const viewportWidth = window.innerWidth
  const left = clamp((rect?.left ?? viewportWidth / 2) + (rect?.width ?? 0) / 2 - width / 2, 12, viewportWidth - width - 12)
  const estimatedHeight = note ? 230 : 180
  const showBelow = (rect?.top ?? 100) < estimatedHeight + 80
  const top = rect
    ? (showBelow ? rect.bottom + 12 : rect.top - estimatedHeight - 12)
    : 100

  return (
    <div
      className={`annotation-popover ${showBelow ? 'annotation-popover--below' : ''}`}
      style={{ left, top, width }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="annotation-popover__head">
        <span className="annotation-popover__dot" style={{ background: HIGHLIGHT_COLORS[color].value }} />
        <span>我的批注</span>
        <time>{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(createdAt)}</time>
      </div>
      <blockquote>{quote}</blockquote>
      {note && <p className="annotation-popover__note">{note}</p>}
      <div className="annotation-popover__actions">
        <button type="button" onClick={onEdit}>编辑</button>
        <button type="button" onClick={onCopy}>复制</button>
        <button type="button" className="is-danger" onClick={onDelete}>删除</button>
      </div>
    </div>
  )
}
