import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'

export type ToastKind = 'info' | 'success' | 'error' | 'loading'
export interface ToastItem {
  id: string
  message: string
  kind: ToastKind
  duration: number
}

export type Notify = (
  message: string,
  kind?: ToastKind,
  options?: { duration?: number; id?: string },
) => string

export const useToasts = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }, [])

  const notify: Notify = useCallback((message, kind = 'info', options = {}) => {
    const id = options.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const duration = options.duration ?? (kind === 'error' ? 5200 : 2800)
    setToasts(prev => {
      const exists = prev.some(toast => toast.id === id)
      const item: ToastItem = { id, message, kind, duration }
      return exists ? prev.map(toast => (toast.id === id ? item : toast)) : [...prev, item]
    })
    return id
  }, [])

  return { toasts, notify, dismiss }
}

export const ToastViewport = ({ toasts, dismiss }: {
  toasts: ToastItem[]
  dismiss: (id: string) => void
}) => (
  <div className="toast-viewport" role="status" aria-live="polite">
    {toasts.map(toast => (
      <Toast key={toast.id} toast={toast} dismiss={dismiss} />
    ))}
  </div>
)

const Toast = ({ toast, dismiss }: { toast: ToastItem; dismiss: (id: string) => void }) => {
  useEffect(() => {
    if (!toast.duration) return
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast, dismiss])

  const Icon = toast.kind === 'success' ? CheckCircle2
    : toast.kind === 'error' ? AlertCircle
      : toast.kind === 'loading' ? Loader2 : Info

  return (
    <div className={`toast toast--${toast.kind}`}>
      <Icon size={17} className={toast.kind === 'loading' ? 'spin' : ''} />
      <span>{toast.message}</span>
      <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  )
}
