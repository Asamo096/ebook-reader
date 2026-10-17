import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Trash2, X } from 'lucide-react'
import type { Annotation, HighlightColor, SelectionInfo } from '../../types'
import { HIGHLIGHT_COLORS } from '../../types'

export interface NoteEditorState {
  mode: 'create' | 'edit'
  quote: string
  note: string
  color: HighlightColor
  annotation?: Annotation
  selection?: SelectionInfo
}

interface Props {
  state: NoteEditorState
  onClose: () => void
  onSave: (color: HighlightColor, note: string) => void
  onDelete?: () => void
}

export const NoteDialog = ({ state, onClose, onSave, onDelete }: Props) => {
  const [note, setNote] = useState(state.note)
  const [color, setColor] = useState<HighlightColor>(state.color)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        onSave(color, note)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [color, note, onClose, onSave])

  return (
    <div className="reader-modal-root" role="presentation">
      <div className="reader-modal-backdrop" onPointerDown={onClose} />
      <div className="reader-modal note-editor" role="dialog" aria-modal="true" aria-label="添加笔记">
        <div className="note-editor__head">
          <span className="note-editor__eyebrow">HIGHLIGHT & NOTE</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        <blockquote className="note-editor__quote">{state.quote}</blockquote>
        <div className="note-editor__colors" role="group" aria-label="高亮颜色">
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map(key => (
            <button
              key={key}
              type="button"
              className={`color-dot ${key === color ? 'is-active' : ''}`}
              style={{ '--dot-color': HIGHLIGHT_COLORS[key].value } as CSSProperties}
              onClick={() => setColor(key)}
              aria-label={HIGHLIGHT_COLORS[key].label}
              title={HIGHLIGHT_COLORS[key].label}
            />
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="note-editor__input"
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder="写下此刻的想法…（可留空，只保存高亮）"
          rows={5}
        />
        <div className="note-editor__foot">
          {state.mode === 'edit' && onDelete ? (
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={onDelete}>
              <Trash2 size={15} /> 删除
            </button>
          ) : <span />}
          <div className="note-editor__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
            <button type="button" className="btn btn--primary" onClick={() => onSave(color, note)}>
              {state.mode === 'edit' ? '保存修改' : (note.trim() ? '保存笔记' : '保存高亮')}
            </button>
          </div>
        </div>
        <p className="note-editor__hint">⌘ / Ctrl + Enter 保存</p>
      </div>
    </div>
  )
}
