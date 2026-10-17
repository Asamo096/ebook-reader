import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export const Modal = ({ open, onClose, children, className = '', label }: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  label?: string
}) => {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-root" role="presentation">
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
