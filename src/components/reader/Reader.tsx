import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from 'react'
import {
  AlertTriangle, ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Highlighter,
  Keyboard, ListTree, Loader2, Maximize2, Minimize2, MoreHorizontal, Search,
  Settings2, Volume2,
} from 'lucide-react'
import type {
  Annotation, Book, HighlightColor, ReadingProgress, ReaderLocation, ReaderSettings,
  ScreenRect, SearchHit, SearchState, SelectionInfo, TTSState, TocItem,
} from '../../types'
import type { Notify } from '../Toast'
import { getAnnotations, putAnnotation, removeAnnotation } from '../../lib/db'
import { ReflowableEngine } from '../../lib/foliateEngine'
import { PdfEngine } from '../../lib/pdfEngine'
import { READER_THEMES, getThemeVars } from '../../lib/themes'
import { clamp, toReadableError, uid } from '../../lib/utils'
import { SidePanel, SearchPanel, type SideTab } from './Panels'
import { SettingsPanel, resetReaderSettings } from './SettingsPanel'
import { NoteDialog, type NoteEditorState } from './NoteDialog'
import { SelectionToolbar, AnnotationPopover } from './SelectionToolbar'
import { TTSBar } from './TTSBar'
import { ShortcutsDialog } from './ShortcutsDialog'

type Panel = SideTab | 'search' | 'settings' | null

interface ReaderProps {
  book: Book
  settings: ReaderSettings
  onSettingsChange: (settings: ReaderSettings) => void
  onProgress: (bookId: string, progress: ReadingProgress) => void
  onBack: () => void
  notify: Notify
}

const emptySearchState = (query = ''): SearchState => ({
  query, running: false, progress: 0, groups: [], total: 0,
})

const isSmallScreen = () => window.matchMedia('(max-width: 860px)').matches

export const Reader = ({
  book, settings, onSettingsChange, onProgress, onBack, notify,
}: ReaderProps) => {
  const isPdf = book.format === 'PDF'
  const theme = READER_THEMES[settings.theme]

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [toc, setToc] = useState<TocItem[]>([])
  const [isFixedLayout, setIsFixedLayout] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [panel, setPanel] = useState<Panel>(null)
  const [sideTab, setSideTab] = useState<SideTab>('toc')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState())
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null)
  const [annotationRect, setAnnotationRect] = useState<ScreenRect | null>(null)
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null)
  const [ttsState, setTtsState] = useState<TTSState>({ active: false, paused: false, text: '' })
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [immersive, setImmersive] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const [pdfZoom, setPdfZoom] = useState(1)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [moreOpen, setMoreOpen] = useState(false)

  const engineRef = useRef<ReflowableEngine | PdfEngine | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const settingsRef = useRef(settings)
  const notifyRef = useRef(notify)
  const onProgressRef = useRef(onProgress)
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const flushProgressRef = useRef<() => void>(() => {})
  const bookIdRef = useRef(book.id)
  const ttsActiveRef = useRef(false)

  settingsRef.current = settings
  notifyRef.current = notify
  onProgressRef.current = onProgress
  bookIdRef.current = book.id
  ttsActiveRef.current = ttsState.active

  const activeAnnotation = useMemo(
    () => annotations.find(item => item.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId],
  )
  const noteCount = useMemo(
    () => annotations.filter(item => item.kind === 'highlight').length,
    [annotations],
  )
  const currentBookmark = useMemo(() => annotations.find(annotation => {
    if (annotation.kind !== 'bookmark') return false
    if (isPdf) return annotation.page === location?.page
    return !!annotation.cfi && annotation.cfi === location?.cfi
  }), [annotations, isPdf, location])

  const commitAnnotations = useCallback((next: Annotation[]) => {
    annotationsRef.current = next
    setAnnotations(next)
    engineRef.current?.setAnnotations(next)
  }, [])

  const addAnnotation = useCallback((annotation: Annotation) => {
    commitAnnotations([...annotationsRef.current, annotation])
    void putAnnotation(annotation)
  }, [commitAnnotations])

  const updateAnnotation = useCallback((annotation: Annotation) => {
    commitAnnotations(annotationsRef.current.map(item =>
      item.id === annotation.id ? annotation : item))
    void putAnnotation(annotation)
  }, [commitAnnotations])

  const deleteAnnotation = useCallback((id: string) => {
    commitAnnotations(annotationsRef.current.filter(item => item.id !== id))
    void removeAnnotation(id)
    setActiveAnnotationId(current => (current === id ? null : current))
    setNoteEditor(current => (current?.annotation?.id === id ? null : current))
  }, [commitAnnotations])

  const buildAnnotation = useCallback((
    sel: SelectionInfo, color: HighlightColor, note?: string,
  ): Annotation | null => {
    if (!isPdf && !sel.cfi) return null
    if (isPdf && (!sel.page || !sel.rects?.length)) return null
    const now = Date.now()
    return {
      id: uid(),
      bookId: bookIdRef.current,
      kind: 'highlight',
      engine: isPdf ? 'pdf' : 'reflowable',
      cfi: sel.cfi,
      page: sel.page,
      rects: sel.rects,
      quote: sel.text,
      note: note?.trim() || undefined,
      color,
      chapter: sel.chapter,
      createdAt: now,
      updatedAt: now,
    }
  }, [isPdf])

  const createFromSelection = useCallback((
    sel: SelectionInfo, color: HighlightColor, note?: string,
  ) => {
    const annotation = buildAnnotation(sel, color, note)
    if (!annotation) {
      notify('这个位置暂时无法定位，换个方式再试试', 'error')
      return
    }
    addAnnotation(annotation)
    setSelection(null)
    setNoteEditor(null)
    notify(note?.trim() ? '笔记已保存' : '已添加高亮', 'success')
  }, [addAnnotation, buildAnnotation, notify])

  const saveNote = useCallback((color: HighlightColor, note: string) => {
    if (!noteEditor) return
    if (noteEditor.mode === 'edit' && noteEditor.annotation) {
      updateAnnotation({
        ...noteEditor.annotation,
        color,
        note: note.trim() || undefined,
        updatedAt: Date.now(),
      })
      setNoteEditor(null)
      notify('笔记已更新', 'success')
    } else if (noteEditor.selection) {
      createFromSelection(noteEditor.selection, color, note)
    }
  }, [createFromSelection, noteEditor, notify, updateAnnotation])

  const toggleBookmark = useCallback(() => {
    if (currentBookmark) {
      deleteAnnotation(currentBookmark.id)
      notify('已移除书签', 'info')
      return
    }
    if (!location) return
    const now = Date.now()
    const label = location.chapter || location.label || '书签'
    if (isPdf) {
      if (!location.page) return
      addAnnotation({
        id: uid(), bookId: bookIdRef.current, kind: 'bookmark', engine: 'pdf',
        page: location.page, quote: label, chapter: label,
        createdAt: now, updatedAt: now,
      })
    } else {
      if (!location.cfi) return
      addAnnotation({
        id: uid(), bookId: bookIdRef.current, kind: 'bookmark', engine: 'reflowable',
        cfi: location.cfi, quote: location.label || label, chapter: label,
        createdAt: now, updatedAt: now,
      })
    }
    notify('已添加书签', 'success')
  }, [addAnnotation, currentBookmark, deleteAnnotation, isPdf, location, notify])

  const navigateToAnnotation = useCallback((annotation: Annotation) => {
    if (annotation.engine === 'pdf') {
      if (annotation.page) void engineRef.current?.goTo({ page: annotation.page })
    } else if (annotation.cfi) {
      void engineRef.current?.goTo({ cfi: annotation.cfi })
    }
  }, [])

  const navigateToToc = useCallback((item: TocItem) => {
    if (isPdf) {
      if (item.page) void engineRef.current?.goTo({ page: item.page })
    } else if (item.href) {
      void engineRef.current?.goTo({ href: item.href })
    }
    closePanel()
  }, [isPdf, panel]) // eslint-disable-line react-hooks/exhaustive-deps

  const openSide = useCallback((tab: SideTab) => {
    setMoreOpen(false)
    setSelection(null)
    setActiveAnnotationId(null)
    setSideTab(tab)
    if (panel === 'search') {
      engineRef.current?.clearSearch()
      setSearchQuery('')
      setSearchState(emptySearchState())
    }
    setPanel(tab)
  }, [panel])

  const openSearch = useCallback((initial?: string) => {
    setMoreOpen(false)
    setSelection(null)
    setActiveAnnotationId(null)
    if (initial != null) setSearchQuery(initial)
    setPanel('search')
  }, [])

  const openSettings = useCallback(() => {
    setMoreOpen(false)
    setSelection(null)
    setActiveAnnotationId(null)
    if (panel === 'search') {
      engineRef.current?.clearSearch()
      setSearchQuery('')
      setSearchState(emptySearchState())
    }
    setPanel('settings')
  }, [panel])

  function closePanel() {
    if (panel === 'search') {
      engineRef.current?.clearSearch()
      setSearchQuery('')
      setSearchState(emptySearchState())
    }
    setPanel(null)
  }

  const handleSideTab = useCallback((tab: SideTab) => {
    setSideTab(tab)
    setPanel(tab)
  }, [])

  const handleSelectHit = useCallback((hit: SearchHit) => {
    void engineRef.current?.revealSearchHit(hit)
    if (isSmallScreen()) {
      engineRef.current?.clearSearch()
      setSearchQuery('')
      setSearchState(emptySearchState())
      setPanel(null)
    }
  }, [])

  const applyPdfZoom = useCallback((zoom: number) => {
    const next = clamp(Math.round(zoom * 10) / 10, 0.6, 2.5)
    setPdfZoom(next)
    if (engineRef.current instanceof PdfEngine) engineRef.current.setZoom(next)
  }, [])

  const toggleTTS = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (ttsActiveRef.current) engine.toggleTTS()
    else engine.startTTS()
  }, [])

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notify('已复制到剪贴板', 'success')
    } catch {
      notify('复制失败，请检查浏览器权限', 'error')
    }
  }, [notify])

  const handleSearchFromSelection = useCallback(() => {
    if (!selection) return
    const text = selection.text.replace(/\s+/g, ' ').trim().slice(0, 48)
    setSelection(null)
    openSearch(text)
  }, [openSearch, selection])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    const typing = !!target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
      || target.tagName === 'SELECT' || target.isContentEditable
    )

    if (event.key === 'Escape') {
      if (noteEditor) return
      if (shortcutsOpen) { setShortcutsOpen(false); return }
      if (moreOpen) { setMoreOpen(false); return }
      if (panel) { closePanel(); return }
      if (selection) { setSelection(null); return }
      if (activeAnnotationId) { setActiveAnnotationId(null); return }
      if (immersive) { setImmersive(false); return }
      return
    }
    if (typing) return
    if (event.key === ' ' && target?.closest('button, a[href], [role="button"]')) return

    const meta = event.ctrlKey || event.metaKey
    if (meta && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openSearch()
      return
    }
    if (meta || event.altKey) return

    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        event.preventDefault()
        if (event.key === ' ' && noteEditor) return
        void engineRef.current?.next()
        break
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault()
        void engineRef.current?.prev()
        break
      case 'Home':
        event.preventDefault()
        void engineRef.current?.goToFraction(0)
        break
      case 'End':
        event.preventDefault()
        void engineRef.current?.goToFraction(1)
        break
      case 't':
      case 'T':
        openSide('toc')
        break
      case 'n':
      case 'N':
        openSide('notes')
        break
      case 's':
      case 'S':
        openSearch()
        break
      case 'b':
      case 'B':
        toggleBookmark()
        break
      case 'r':
      case 'R':
        toggleTTS()
        break
      case 'f':
      case 'F':
        setImmersive(value => !value)
        break
      case '?':
        setShortcutsOpen(true)
        break
      case '+':
      case '=':
        event.preventDefault()
        if (isPdf) applyPdfZoom(pdfZoom + 0.1)
        else onSettingsChange({ ...settings, fontSize: Math.min(34, settings.fontSize + 1) })
        break
      case '-':
        event.preventDefault()
        if (isPdf) applyPdfZoom(pdfZoom - 0.1)
        else onSettingsChange({ ...settings, fontSize: Math.max(14, settings.fontSize - 1) })
        break
      default:
        break
    }
  }, [
    activeAnnotationId, applyPdfZoom, immersive, isPdf, moreOpen, noteEditor,
    onSettingsChange, openSearch, openSide, panel, pdfZoom, selection, settings,
    shortcutsOpen, toggleBookmark, toggleTTS,
  ])

  keyHandlerRef.current = handleKeyDown

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    if (!moreOpen) return
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.reader-more-wrap')) setMoreOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [moreOpen])

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  useEffect(() => {
    let cancelled = false
    annotationsRef.current = []
    setAnnotations([])
    setSelection(null)
    setActiveAnnotationId(null)
    setNoteEditor(null)
    setShortcutsOpen(false)
    setMoreOpen(false)
    setImmersive(false)
    setTtsState({ active: false, paused: false, text: '' })
    getAnnotations(book.id)
      .then(list => {
        if (cancelled) return
        annotationsRef.current = list
        setAnnotations(list)
        engineRef.current?.setAnnotations(list)
      })
      .catch(error => {
        console.error(error)
        if (!cancelled) notifyRef.current('无法读取这本书的笔记', 'error')
      })
    return () => { cancelled = true }
  }, [book.id])

  useEffect(() => {
    annotationsRef.current = annotations
    engineRef.current?.setAnnotations(annotations)
  }, [annotations])

  useEffect(() => {
    engineRef.current?.setSettings(settings)
  }, [settings])

  useEffect(() => {
    if (panel !== 'search') return
    const query = searchQuery.trim()
    const timer = window.setTimeout(() => {
      engineRef.current?.startSearch(query)
    }, query ? 320 : 0)
    return () => window.clearTimeout(timer)
  }, [panel, searchQuery])

  useEffect(() => {
    if (!panel) return
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.reader-drawer')) closePanel()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
    // closePanel is intentionally read fresh through the closure below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, openSearch, searchQuery])

  useEffect(() => {
    if (!selection && !activeAnnotationId) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('.selection-toolbar, .annotation-popover')) return
      if (target.closest('.reader-drawer, .reader-topbar, .reader-footer, .reader-modal-root')) return
      setSelection(null)
      setActiveAnnotationId(null)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [selection, activeAnnotationId])

  useEffect(() => {
    const container = stageRef.current
    if (!container) return
    let progressTimer: number | undefined
    let latestProgress: ReadingProgress | null = null

    const scheduleSave = (loc: ReaderLocation) => {
      latestProgress = {
        fraction: clamp(loc.fraction || 0, 0, 1),
        label: loc.label || undefined,
        location: isPdf ? (loc.page ? `pdf:${loc.page}` : undefined) : loc.cfi,
        updatedAt: Date.now(),
      }
      if (progressTimer) window.clearTimeout(progressTimer)
      progressTimer = window.setTimeout(() => {
        if (latestProgress) onProgressRef.current(bookIdRef.current, latestProgress)
      }, 900)
    }

    const flush = () => {
      if (progressTimer) {
        window.clearTimeout(progressTimer)
        progressTimer = undefined
      }
      if (latestProgress) {
        onProgressRef.current(bookIdRef.current, latestProgress)
        latestProgress = null
      }
    }
    flushProgressRef.current = flush

    setLoading(true)
    setError(null)
    setToc([])
    setLocation(null)
    setScrub(null)
    setPanel(null)
    setSearchQuery('')
    setSearchState(emptySearchState())
    setPdfZoom(1)
    setIsFixedLayout(false)

    const callbacks = {
      onReady: (info: { toc: TocItem[]; isFixedLayout: boolean }) => {
        setToc(info.toc)
        setIsFixedLayout(info.isFixedLayout)
        setLoading(false)
      },
      onRelocate: (loc: ReaderLocation) => {
        setLocation(loc)
        setSelection(null)
        setActiveAnnotationId(null)
        scheduleSave(loc)
      },
      onSelection: (sel: SelectionInfo | null) => {
        if (!sel) return
        setSelection(sel)
        setActiveAnnotationId(null)
      },
      onAnnotationClick: (id: string, rect: ScreenRect | null) => {
        setSelection(null)
        setActiveAnnotationId(id)
        setAnnotationRect(rect)
      },
      onSearchUpdate: (state: SearchState) => setSearchState(state),
      onTTSUpdate: (state: TTSState) => setTtsState(state),
      onDismissPopovers: () => {
        setSelection(null)
        setActiveAnnotationId(null)
      },
      onKeyDown: (event: KeyboardEvent) => keyHandlerRef.current(event),
      onToast: (message: string) => notifyRef.current(message),
      onError: (message: string) => {
        setError(toReadableError(new Error(message), book.format))
        setLoading(false)
      },
    }

    const engine = isPdf
      ? new PdfEngine({
        container,
        settings: settingsRef.current,
        annotations: annotationsRef.current,
        callbacks,
      })
      : new ReflowableEngine({
        container,
        settings: settingsRef.current,
        annotations: annotationsRef.current,
        callbacks,
      })
    engineRef.current = engine

    if (engine instanceof PdfEngine) {
      void engine.open({
        file: book.file,
        initialLocation: book.progress.location,
        language: book.language,
      })
    } else {
      void engine.open({
        file: book.file,
        format: book.format,
        title: book.title,
        author: book.author,
        language: book.language,
        initialLocation: book.progress.location,
      })
    }

    return () => {
      flush()
      engine.destroy()
      engineRef.current = null
      setTtsState({ active: false, paused: false, text: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, reloadKey])

  useEffect(() => {
    if (!panel) return
    setMoreOpen(false)
  }, [panel])

  const handleBack = useCallback(() => {
    flushProgressRef.current()
    engineRef.current?.stopTTS()
    onBack()
  }, [onBack])

  const handleEditAnnotation = useCallback((annotation: Annotation) => {
    setActiveAnnotationId(null)
    setNoteEditor({
      mode: 'edit',
      quote: annotation.quote,
      note: annotation.note ?? '',
      color: annotation.color ?? 'amber',
      annotation,
    })
  }, [])

  const handleDeleteAnnotation = useCallback((annotation: Annotation) => {
    deleteAnnotation(annotation.id)
    notify('已删除这条批注', 'info')
  }, [deleteAnnotation, notify])

  const fraction = location?.fraction ?? 0
  const sliderValue = scrub ?? fraction * 1000
  const percent = Math.round((scrub != null ? scrub / 10 : fraction * 100))
  const canHighlight = !isFixedLayout
  const normalizeLabel = (value?: string) => value?.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() ?? ''
  const showChapterInHeader = !!location?.chapter
    && normalizeLabel(location.chapter) !== normalizeLabel(book.title)

  const style = {
    ...getThemeVars(theme),
    '--reader-page-width': `${Math.min(settings.pageWidth + 140, 1120)}px`,
  } as CSSProperties

  return (
    <div
      className={`reader ${immersive ? 'is-immersive' : ''} ${theme.dark ? 'reader--dark' : ''}`}
      style={style}
      data-format={book.format}
    >
      <header className="reader-topbar">
        <div className="reader-topbar__left">
          <button type="button" className="reader-back" onClick={handleBack} aria-label="返回书架">
            <ArrowLeft size={18} />
          </button>
          <div className="reader-book-info">
            <strong title={book.title}>{book.title}</strong>
            <span>
              {showChapterInHeader
                ? location?.chapter
                : book.author || '墨阅'}
            </span>
          </div>
        </div>

        <div className="reader-topbar__actions">
          <button
            type="button"
            className={`reader-action ${panel === 'toc' ? 'is-active' : ''}`}
            onClick={() => (panel === 'toc' ? closePanel() : openSide('toc'))}
            title="目录 (T)"
            aria-label="目录"
          >
            <ListTree size={18} />
          </button>
          <button
            type="button"
            className={`reader-action ${panel === 'search' ? 'is-active' : ''}`}
            onClick={() => (panel === 'search' ? closePanel() : openSearch())}
            title="搜索 (S)"
            aria-label="搜索全书"
          >
            <Search size={18} />
          </button>
          {canHighlight && (
            <button
              type="button"
              className={`reader-action reader-action--optional ${panel === 'notes' ? 'is-active' : ''}`}
              onClick={() => (panel === 'notes' ? closePanel() : openSide('notes'))}
              title="笔记 (N)"
              aria-label="笔记"
            >
              <Highlighter size={18} />
              {noteCount > 0 && <span className="reader-action__badge">{noteCount > 99 ? '99+' : noteCount}</span>}
            </button>
          )}
          <button
            type="button"
            className={`reader-action reader-action--optional ${currentBookmark ? 'is-active' : ''}`}
            onClick={toggleBookmark}
            title={currentBookmark ? '移除书签 (B)' : '添加书签 (B)'}
            aria-label={currentBookmark ? '移除书签' : '添加书签'}
          >
            <Bookmark size={18} fill={currentBookmark ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            className={`reader-action reader-action--optional ${ttsState.active ? 'is-active' : ''}`}
            onClick={toggleTTS}
            title={ttsState.active ? (ttsState.paused ? '继续朗读 (R)' : '暂停朗读 (R)') : '朗读 (R)'}
            aria-label="朗读"
          >
            <Volume2 size={18} />
            {ttsState.active && <span className="reader-action__pulse" />}
          </button>
          <span className="reader-action__divider reader-action--optional" />
          <button
            type="button"
            className={`reader-action ${panel === 'settings' ? 'is-active' : ''}`}
            onClick={() => (panel === 'settings' ? closePanel() : openSettings())}
            title="阅读设置"
            aria-label="阅读设置"
          >
            <Settings2 size={18} />
          </button>
          <button
            type="button"
            className="reader-action reader-action--optional"
            onClick={() => setImmersive(true)}
            title="沉浸阅读 (F)"
            aria-label="沉浸阅读"
          >
            <Maximize2 size={17} />
          </button>

          <div className="reader-more-wrap">
            <button
              type="button"
              className="reader-action reader-more-button"
              onClick={() => setMoreOpen(open => !open)}
              aria-label="更多操作"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal size={19} />
            </button>
            {moreOpen && (
              <div className="reader-more-menu">
                {canHighlight && (
                  <button type="button" onClick={() => openSide('notes')}>
                    <Highlighter size={16} /> 笔记 {noteCount > 0 && <span>{noteCount}</span>}
                  </button>
                )}
                <button type="button" onClick={() => { setMoreOpen(false); toggleBookmark() }}>
                  <Bookmark size={16} fill={currentBookmark ? 'currentColor' : 'none'} />
                  {currentBookmark ? '移除书签' : '添加书签'}
                </button>
                <button type="button" onClick={() => { setMoreOpen(false); toggleTTS() }}>
                  <Volume2 size={16} /> {ttsState.active ? '暂停/继续朗读' : '朗读'}
                </button>
                <button type="button" onClick={() => { setMoreOpen(false); setImmersive(true) }}>
                  <Maximize2 size={16} /> 沉浸阅读
                </button>
                <button type="button" onClick={() => { setMoreOpen(false); setShortcutsOpen(true) }}>
                  <Keyboard size={16} /> 快捷键
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="reader-stage">
        <div
          className={`reader-sheet ${isPdf ? 'reader-sheet--pdf' : ''} ${settings.flow === 'scrolled' && !isPdf ? 'reader-sheet--scrolled' : ''}`}
        >
          <div className="reader-engine-host" ref={stageRef} />
          {loading && (
            <div className="reader-loading">
              <div className="reader-loading__mark">墨</div>
              <Loader2 className="spin" size={20} />
              <p>正在翻开《{book.title}》</p>
              <span>{isPdf ? '正在准备页面与文字层…' : '正在整理章节与排版…'}</span>
            </div>
          )}
          {error && !loading && (
            <div className="reader-error">
              <AlertTriangle size={26} />
              <h3>这本书暂时打不开</h3>
              <p>{error}</p>
              <div>
                <button type="button" className="btn btn--primary" onClick={() => setReloadKey(key => key + 1)}>
                  再试一次
                </button>
                <button type="button" className="btn btn--ghost" onClick={handleBack}>返回书架</button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="reader-footer">
        <button type="button" className="reader-page-button" onClick={() => void engineRef.current?.prev()} aria-label="上一页">
          <ChevronLeft size={19} />
        </button>
        <div className="reader-progress">
          <div className="reader-progress__meta">
            <span className="reader-progress__label">{location?.label || (loading ? '正在准备…' : '')}</span>
            <span className="reader-progress__percent">{percent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={sliderValue}
            className="reader-progress__range"
            style={{ '--range-progress': `${sliderValue / 10}%` } as CSSProperties}
            aria-label="阅读进度"
            onChange={event => setScrub(Number(event.target.value))}
            onPointerUp={() => {
              if (scrub != null) {
                void engineRef.current?.goToFraction(scrub / 1000)
                setScrub(null)
              }
            }}
            onKeyUp={() => {
              if (scrub != null) {
                void engineRef.current?.goToFraction(scrub / 1000)
                setScrub(null)
              }
            }}
            onBlur={() => {
              if (scrub != null) {
                void engineRef.current?.goToFraction(scrub / 1000)
                setScrub(null)
              }
            }}
          />
        </div>
        <button type="button" className="reader-page-button" onClick={() => void engineRef.current?.next()} aria-label="下一页">
          <ChevronRight size={19} />
        </button>
      </footer>

      {panel && <div className="reader-scrim" onPointerDown={closePanel} />}

      <SidePanel
        open={panel === 'toc' || panel === 'notes' || panel === 'bookmarks'}
        tab={sideTab}
        onTab={handleSideTab}
        onClose={closePanel}
        toc={toc}
        isPdf={isPdf}
        totalPages={location?.totalPages ?? 0}
        location={location}
        annotations={annotations}
        onSelectToc={navigateToToc}
        onJumpPage={page => { void engineRef.current?.goTo({ page }); closePanel() }}
        onSelectAnnotation={annotation => {
          navigateToAnnotation(annotation)
          if (isSmallScreen()) closePanel()
        }}
        onEditAnnotation={handleEditAnnotation}
        onDeleteAnnotation={handleDeleteAnnotation}
      />

      <SearchPanel
        open={panel === 'search'}
        state={searchState}
        query={searchQuery}
        isPdf={isPdf}
        onQueryChange={setSearchQuery}
        onClose={closePanel}
        onSelectHit={handleSelectHit}
      />

      <SettingsPanel
        open={panel === 'settings'}
        settings={settings}
        isPdf={isPdf}
        voices={voices}
        pdfZoom={pdfZoom}
        onPdfZoom={applyPdfZoom}
        onChange={onSettingsChange}
        onClose={closePanel}
        onReset={() => {
          onSettingsChange(resetReaderSettings(settings))
          applyPdfZoom(1)
        }}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      {canHighlight && selection && !noteEditor && !panel && (
        <SelectionToolbar
          selection={selection}
          onHighlight={color => createFromSelection(selection, color)}
          onNote={() => {
            setNoteEditor({
              mode: 'create',
              quote: selection.text,
              note: '',
              color: 'amber',
              selection,
            })
            setSelection(null)
          }}
          onCopy={() => { void copyText(selection.text); setSelection(null) }}
          onSearch={handleSearchFromSelection}
        />
      )}

      {activeAnnotation && !noteEditor && !selection && (
        <AnnotationPopover
          quote={activeAnnotation.quote}
          note={activeAnnotation.note}
          color={activeAnnotation.color ?? 'amber'}
          createdAt={activeAnnotation.createdAt}
          rect={annotationRect}
          onEdit={() => handleEditAnnotation(activeAnnotation)}
          onCopy={() => {
            const text = activeAnnotation.note
              ? `${activeAnnotation.quote}\n\n${activeAnnotation.note}`
              : activeAnnotation.quote
            void copyText(text)
            setActiveAnnotationId(null)
          }}
          onDelete={() => handleDeleteAnnotation(activeAnnotation)}
        />
      )}

      {noteEditor && (
        <NoteDialog
          state={noteEditor}
          onClose={() => setNoteEditor(null)}
          onSave={saveNote}
          onDelete={noteEditor.annotation
            ? () => {
              deleteAnnotation(noteEditor.annotation!.id)
              setNoteEditor(null)
              notify('已删除这条批注', 'info')
            }
            : undefined}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      <TTSBar
        state={ttsState}
        onToggle={toggleTTS}
        onStop={() => engineRef.current?.stopTTS()}
        onPrev={() => engineRef.current?.prevTTSSentence()}
        onNext={() => engineRef.current?.nextTTSSentence()}
        onSettings={openSettings}
      />

      {immersive && (
        <>
          <button type="button" className="immersive-exit" onClick={() => setImmersive(false)} title="显示工具栏 (Esc)">
            <Minimize2 size={16} />
          </button>
          <div className="immersive-progress" aria-hidden>
            <span style={{ width: `${Math.max(0.5, fraction * 100)}%` }} />
          </div>
        </>
      )}
    </div>
  )
}
