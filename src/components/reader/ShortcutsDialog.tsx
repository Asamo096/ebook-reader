import { useEffect } from 'react'
import { X } from 'lucide-react'

const SHORTCUTS: Array<[string, string]> = [
  ['→ / 空格 / PageDown', '下一页'],
  ['← / PageUp', '上一页'],
  ['Home / End', '跳到书首 / 书尾'],
  ['T', '打开目录'],
  ['N', '打开笔记'],
  ['S 或 Ctrl/⌘ + F', '搜索全书'],
  ['B', '当前位置添加书签'],
  ['R', '开始或暂停朗读'],
  ['F', '沉浸阅读'],
  ['+ / −', '调整字号（PDF 为缩放）'],
  ['?', '快捷键说明'],
  ['Esc', '关闭面板 / 退出沉浸'],
]

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
  <div className="reader-modal-root" role="presentation">
    <div className="reader-modal-backdrop" onPointerDown={onClose} />
    <div className="reader-modal shortcuts" role="dialog" aria-modal="true" aria-label="快捷键">
      <div className="shortcuts__head">
        <div>
          <span className="note-editor__eyebrow">KEYBOARD</span>
          <h3>快捷键</h3>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={17} />
        </button>
      </div>
      <div className="shortcuts__grid">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="shortcuts__row">
            <kbd>{keys}</kbd>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="shortcuts__foot">阅读时选中文字，即可高亮、写笔记或直接搜索。</p>
    </div>
  </div>
  )
}
