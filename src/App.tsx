import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Book, ReadingProgress, ReaderSettings } from './types'
import { getAllBooks, saveBook, saveProgress, removeBook, findBookByFingerprint } from './lib/db'
import { createBookFromFile } from './lib/importer'
import { detectFormat, formatBytes, isSupportedFile, toReadableError } from './lib/utils'
import { loadSettings, saveSettings } from './lib/themes'
import { Library } from './components/Library'
import { BookDialogs } from './components/BookDialogs'
import { Reader } from './components/reader/Reader'
import { ToastViewport, useToasts } from './components/Toast'

type Route = { name: 'library' } | { name: 'reader'; bookId: string }

const parseRoute = (): Route => {
  const match = /^#\/read\/([^/]+)/.exec(window.location.hash)
  return match ? { name: 'reader', bookId: decodeURIComponent(match[1]) } : { name: 'library' }
}

const readUiTheme = (): 'light' | 'dark' => {
  const saved = localStorage.getItem('moyue.uiTheme')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const App = () => {
  const [books, setBooks] = useState<Book[]>([])
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>(parseRoute)
  const [uiTheme, setUiTheme] = useState<'light' | 'dark'>(readUiTheme)
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings)
  const [importStatus, setImportStatus] = useState<{
    name: string
    index: number
    total: number
    size: number
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<Book | null>(null)
  const { toasts, notify, dismiss } = useToasts()

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('BOOT_TIMEOUT')), 15_000)
    })
    Promise.race([getAllBooks(), timeout])
      .then(list => {
        if (cancelled) return
        setBooks(list)
        setReady(true)
      })
      .catch(error => {
        if (cancelled) return
        console.error(error)
        const message = error instanceof Error ? error.message : String(error)
        setBootError(
          /DB_BLOCKED|BOOT_TIMEOUT/.test(message)
            ? '书架数据正在被其他页面占用，或读取超时。如果你同时打开了多个墨阅页面，请先全部关闭，再重新加载。'
            : `无法读取本地书架：${message || '未知错误'}`,
        )
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    localStorage.setItem('moyue.uiTheme', uiTheme)
    document.documentElement.dataset.uiTheme = uiTheme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', uiTheme === 'dark' ? '#171a18' : '#f3efe7')
  }, [uiTheme])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    const active = route.name === 'reader' ? books.find(book => book.id === route.bookId) : null
    if (active) document.title = `${active.title} · 墨阅`
    else document.title = '墨阅 · 本地电子书阅读器'
  }, [route, books])

  const navigate = useCallback((hash: string) => {
    if (window.location.hash === hash) setRoute(parseRoute())
    else window.location.hash = hash
  }, [])

  useEffect(() => {
    if (!ready || route.name !== 'reader') return
    if (!books.some(book => book.id === route.bookId)) {
      navigate('#/')
    }
  }, [ready, route, books, navigate])

  const updateBook = useCallback((book: Book) => {
    setBooks(prev => {
      const exists = prev.some(item => item.id === book.id)
      const next = exists ? prev.map(item => (item.id === book.id ? book : item)) : [book, ...prev]
      return next.sort((a, b) =>
        (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt))
    })
  }, [])

  const openBook = useCallback((book: Book) => {
    const now = Date.now()
    const opened = { ...book, lastOpenedAt: now }
    updateBook(opened)
    void saveProgress(book.id, book.progress, now)
    setDetailsTarget(null)
    navigate(`#/read/${encodeURIComponent(book.id)}`)
  }, [navigate, updateBook])

  const handleProgress = useCallback((bookId: string, progress: ReadingProgress) => {
    const now = Date.now()
    setBooks(prev => prev.map(book =>
      book.id === bookId ? { ...book, progress, lastOpenedAt: now } : book))
    void saveProgress(bookId, progress, now)
  }, [])

  const handleDelete = useCallback(async (book: Book) => {
    try {
      await removeBook(book.id)
      setBooks(prev => prev.filter(item => item.id !== book.id))
      if (route.name === 'reader' && route.bookId === book.id) navigate('#/')
      notify(`《${book.title}》已从书架移除`, 'success')
    } catch (error) {
      console.error(error)
      notify('删除失败，请稍后再试', 'error')
    } finally {
      setDeleteTarget(null)
      setDetailsTarget(null)
    }
  }, [notify, navigate, route])

  const importQueueRef = useRef<File[]>([])
  const importTotalRef = useRef(0)
  const importingRef = useRef(false)

  const processQueue = useCallback(async () => {
    if (importingRef.current) return
    importingRef.current = true
    try {
      while (importQueueRef.current.length) {
        const file = importQueueRef.current.shift()!
        const index = importTotalRef.current - importQueueRef.current.length
        setImportStatus({ name: file.name, index, total: importTotalRef.current, size: file.size })
        try {
          const existing = await findBookByFingerprint(file.name, file.size)
          if (existing) {
            notify(`《${existing.title}》已经在书架上了`, 'info')
            continue
          }
          const book = await createBookFromFile(file)
          await saveBook(book)
          setBooks(prev => [book, ...prev])
          notify(`《${book.title}》已加入书架`, 'success')
        } catch (error) {
          console.error(error)
          const format = detectFormat(file.name) ?? undefined
          notify(`${file.name}：${toReadableError(error, format)}`, 'error', { duration: 6500 })
        }
      }
    } finally {
      importingRef.current = false
      setImportStatus(null)
      importTotalRef.current = 0
    }
  }, [notify])

  const handleImport = useCallback((files: File[]) => {
    if (!files.length) return
    const supported = files.filter(isSupportedFile)
    if (supported.length < files.length) {
      notify('已跳过不支持的文件；目前支持 EPUB、MOBI、AZW3、PDF、TXT', 'info', { duration: 5000 })
    }
    if (!supported.length) return
    importQueueRef.current.push(...supported)
    importTotalRef.current += supported.length
    void processQueue()
  }, [notify, processQueue])

  const loadSample = useCallback(async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}samples/taohuayuan.txt`)
      if (!response.ok) throw new Error('示例文件不可用')
      const text = await response.text()
      const file = new File([text], '桃花源记 - 陶渊明.txt', { type: 'text/plain' })
      handleImport([file])
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载示例失败', 'error')
    }
  }, [handleImport, notify])

  const activeBook = route.name === 'reader'
    ? books.find(book => book.id === route.bookId)
    : undefined

  if (!ready) {
    if (bootError) {
      return (
        <div className="boot-screen boot-screen--error">
          <div className="brand-seal brand-seal--large">墨</div>
          <div className="boot-screen__title">书架暂时打不开</div>
          <p className="boot-screen__error">{bootError}</p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      )
    }
    return (
      <div className="boot-screen">
        <div className="brand-seal brand-seal--large">墨</div>
        <div className="boot-screen__title">墨阅</div>
        <Loader2 className="spin" size={18} />
        <p>正在打开你的书房…</p>
      </div>
    )
  }

  return (
    <div className="app" data-theme={uiTheme}>
      {route.name === 'library' || !activeBook ? (
        <Library
          books={books}
          uiTheme={uiTheme}
          onToggleTheme={() => setUiTheme(theme => (theme === 'dark' ? 'light' : 'dark'))}
          onOpen={openBook}
          onImport={handleImport}
          onLoadSample={loadSample}
          onRequestDelete={setDeleteTarget}
          onShowDetails={setDetailsTarget}
        />
      ) : (
        <Reader
          book={activeBook}
          settings={settings}
          onSettingsChange={setSettings}
          onProgress={handleProgress}
          onBack={() => navigate('#/')}
          notify={notify}
        />
      )}

      <ToastViewport toasts={toasts} dismiss={dismiss} />

      {importStatus && (
        <ImportIndicator key={`${importStatus.name}-${importStatus.index}`} status={importStatus} />
      )}

      <BookDialogs
        deleteTarget={deleteTarget}
        detailsTarget={detailsTarget}
        onCloseDelete={() => setDeleteTarget(null)}
        onCloseDetails={() => setDetailsTarget(null)}
        onConfirmDelete={handleDelete}
        onOpen={openBook}
        onRequestDelete={setDeleteTarget}
      />
    </div>
  )
}

const ImportIndicator = ({ status }: {
  status: { name: string; index: number; total: number; size: number }
}) => {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="import-indicator">
      <Loader2 className="spin" size={18} />
      <div>
        <strong>正在整理书本…</strong>
        <span>{status.name}</span>
        <small>
          {formatBytes(status.size)}
          {' · '}已等待 {seconds} 秒
          {status.total > 1 ? ` · ${status.index} / ${status.total}` : ''}
        </small>
        {seconds >= 8 && (
          <em>文件较大时解析会久一些，请保持页面在前台。</em>
        )}
      </div>
    </div>
  )
}

export default App
