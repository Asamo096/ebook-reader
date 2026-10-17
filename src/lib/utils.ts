import type { BookFormat } from '../types'

export const SUPPORTED_EXTENSIONS = ['.epub', '.mobi', '.azw3', '.pdf', '.txt'] as const

export const detectFormat = (fileName: string): BookFormat | null => {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.epub': return 'EPUB'
    case '.mobi': return 'MOBI'
    case '.azw3': return 'AZW3'
    case '.pdf': return 'PDF'
    case '.txt': return 'TXT'
    default: return null
  }
}

export const isSupportedFile = (file: File) => !!detectFormat(file.name)

export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export const formatRelativeTime = (timestamp: number) => {
  const diff = (timestamp - Date.now()) / 1000
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  for (const [unit, seconds] of ranges) {
    if (Math.abs(diff) >= seconds) return rtf.format(Math.round(diff / seconds), unit)
  }
  return '刚刚'
}

export const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(timestamp)

export const escapeHtml = (text: string) => text
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export const stripHtml = (text?: string) => text
  ?.replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(' / ')
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['zh', 'zh-CN', 'en', 'name', 'value']) {
      if (key in record) {
        const result = textValue(record[key])
        if (result) return result
      }
    }
    const first = Object.values(record)[0]
    return textValue(first)
  }
  return ''
}

export const cleanTitle = (fileName: string): { title: string; author: string } => {
  const base = fileName.replace(/\.[^.]+$/, '')
  const withoutBrackets = base
    .replace(/【[^】]{0,20}(精校|完结|全本|校对|修订)[^】]*】/g, '')
    .replace(/\[[^\]]{0,20}(精校|完结|全本|校对|修订)[^\]]*\]/g, '')
    .trim()

  const bookQuote = /《([^》]+)》/.exec(withoutBrackets)
  let title = bookQuote?.[1]?.trim() ?? ''
  let author = ''
  const authorPatterns = [
    /作者\s*[:：]\s*([^\s()（）\-—_]+)/,
    /by\s+([^\s()（）\-—_]+)/i,
  ]
  for (const pattern of authorPatterns) {
    const match = pattern.exec(withoutBrackets)
    if (match?.[1]) {
      author = match[1].trim()
      break
    }
  }
  if (!title) {
    const parts = withoutBrackets.split(/\s*[-–—_]\s*/)
    if (parts.length >= 2 && parts[1].length <= 24) {
      title = parts[0].trim()
      author ||= parts.slice(1).join(' - ').trim()
    } else {
      title = withoutBrackets.trim()
    }
  }
  title = title.replace(/^\[[^\]]+\]\s*/, '').replace(/\([^)]*\)\s*$/, '').trim()
  return { title: title || fileName.replace(/\.[^.]+$/, ''), author: author.trim() }
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const hashString = (text: string): number => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const debounce = <T extends (...args: never[]) => void>(fn: T, wait: number) => {
  let timer: number | undefined
  const wrapped = (...args: Parameters<T>) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => window.clearTimeout(timer)
  return wrapped as T & { cancel: () => void }
}

export const toReadableError = (error: unknown, format?: BookFormat): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (/drm|encrypt|encrypted|crypto/i.test(message)) {
    return '这本书似乎受 DRM 保护，暂时无法打开。'
  }
  if (/unsupported|not supported|could not parse|invalid/i.test(message)) {
    return format === 'AZW3' || format === 'MOBI'
      ? '无法解析这本书，文件可能已损坏或使用了不支持的 MOBI 变体。'
      : '无法解析这本书，文件可能已损坏。'
  }
  return message || '发生未知错误'
}
