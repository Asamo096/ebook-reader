import '../vendor/foliate/view.js'
import { Overlayer } from '../vendor/foliate/overlayer.js'
import type {
  Annotation, BookFormat, EngineCallbacks, HighlightColor, ReadyInfo,
  ReaderEngineHandle, ReaderLocation, ReaderSettings, ReaderTarget, ScreenRect,
  SearchHit, SearchState, SelectionInfo, TTSState, TocItem,
} from '../types'
import { HIGHLIGHT_COLORS } from '../types'
import { buildFoliateStyles } from './readerStyles'
import { READER_THEMES } from './themes'
import { decodeTextFile, splitTxtIntoChapters, TxtBook } from './txt'
import { extractSentences, findSentenceIndex, normalizeLanguage, chooseVoice, type Sentence } from './sentences'
import { textValue } from './utils'

export type ReflowableEngineCallbacks = EngineCallbacks

interface OpenOptions {
  file: Blob
  format: BookFormat
  title: string
  author: string
  language?: string
  initialLocation?: string
}

const emptySearchState = (query = ''): SearchState => ({
  query, running: false, progress: 0, groups: [], total: 0,
})

const normalizeToc = (items: unknown): TocItem[] => {
  if (!Array.isArray(items)) return []
  return items.flatMap((item): TocItem[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const label = textValue(record.label ?? record.title).trim()
    const href = typeof record.href === 'string' ? record.href : undefined
    const subitems = normalizeToc(record.subitems)
    if (!label && !subitems.length) return []
    return [{
      label: label || '未命名章节',
      href,
      subitems: subitems.length ? subitems : undefined,
    }]
  })
}

const screenRectOfRange = (range: Range | null | undefined): ScreenRect | null => {
  if (!range) return null
  try {
    const doc = range.startContainer.ownerDocument
    const frame = doc?.defaultView?.frameElement as HTMLIFrameElement | null
    const frameRect = frame?.getBoundingClientRect()
    let rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      const rects = Array.from(range.getClientRects()).filter(item => item.width && item.height)
      if (rects.length) rect = rects[0]
    }
    if (!rect.width && !rect.height) return null
    const left = rect.left + (frameRect?.left ?? 0)
    const top = rect.top + (frameRect?.top ?? 0)
    return {
      left, top,
      right: left + rect.width,
      bottom: top + rect.height,
      width: rect.width,
      height: rect.height,
    }
  } catch {
    return null
  }
}

export class ReflowableEngine implements ReaderEngineHandle {
  #container: HTMLElement
  #callbacks: ReflowableEngineCallbacks
  #settings: ReaderSettings
  #view: any = null
  #book: any = null
  #format: BookFormat = 'EPUB'
  #language = 'zh-CN'
  #annotations: Annotation[] = []
  #annotationIndex = new Map<string, number>()
  #drawn = new Map<string, Annotation>()
  #listenedDocs = new WeakSet<Document>()
  #searchGeneration = 0
  #searchState: SearchState = emptySearchState()
  #lastLocation: ReaderLocation | null = null
  #ready = false
  #destroyed = false
  #ttsHighlightCfi: string | null = null
  #ttsAdvancing = false
  #tts: {
    active: boolean
    paused: boolean
    doc: Document | null
    docIndex: number
    sentences: Sentence[]
    index: number
    token: number
  } | null = null

  constructor(options: {
    container: HTMLElement
    settings: ReaderSettings
    annotations: Annotation[]
    callbacks: ReflowableEngineCallbacks
  }) {
    this.#container = options.container
    this.#settings = options.settings
    this.#annotations = options.annotations
    this.#callbacks = options.callbacks
  }

  async open(options: OpenOptions) {
    this.#format = options.format
    this.#language = normalizeLanguage(options.language)

    const host = document.createElement('foliate-view') as any
    host.style.cssText = 'display:block;width:100%;height:100%;outline:none;'
    this.#container.replaceChildren(host)
    this.#view = host
    this.#attachViewListeners(host)

    try {
      let bookInput: unknown = options.file
      if (options.format === 'TXT') {
        const { text } = await decodeTextFile(options.file)
        const chapters = splitTxtIntoChapters(text, options.title, options.author)
        const txtBook = new TxtBook({
          title: options.title,
          author: options.author,
          chapters,
        })
        this.#book = txtBook
        bookInput = txtBook
      }
      if (this.#destroyed) return
      await host.open(bookInput)
      if (this.#destroyed) return
      this.#book = host.book
      this.#language = normalizeLanguage(this.#book?.metadata?.language || options.language)
      await this.#resolveAnnotationIndexes()
      this.applySettings(this.#settings)

      await host.init({
        lastLocation: options.initialLocation || undefined,
        showTextStart: !options.initialLocation,
      })
      if (this.#destroyed) return
      this.#ready = true

      const toc = normalizeToc(this.#book?.toc)
      this.#callbacks.onReady({
        toc,
        isFixedLayout: !!host.isFixedLayout,
        chapterCount: this.#book?.sections?.length ?? 0,
      })
      await this.#syncAnnotations()
    } catch (error) {
      if (!this.#destroyed) {
        this.#callbacks.onError(error instanceof Error ? error.message : String(error))
      }
    }
  }

  #attachViewListeners(host: any) {
    host.addEventListener('relocate', (event: CustomEvent) => {
      const detail = event.detail ?? {}
      const chapter = textValue(detail.tocItem?.label) || ''
      const label = chapter || (detail.location
        ? (Number(detail.location.current) > 0
          ? `位置 ${detail.location.current}`
          : '封面 · 扉页')
        : '阅读中')
      const location: ReaderLocation = {
        fraction: Number(detail.fraction) || 0,
        label,
        chapter,
        cfi: detail.cfi,
        tocHref: detail.tocItem?.href,
      }
      this.#lastLocation = location
      this.#callbacks.onRelocate(location)
    })

    host.addEventListener('load', (event: CustomEvent) => {
      const { doc, index } = event.detail ?? {}
      if (!doc) return
      if (this.#tts?.active && !this.#ttsAdvancing && index !== this.#tts.docIndex) {
        this.stopTTS()
      }
      this.#applyStylesToDoc(doc)
      this.#attachDocListeners(doc)
    })

    host.addEventListener('create-overlay', (event: CustomEvent) => {
      const index = event.detail?.index
      for (const annotation of this.#annotations) {
        if (annotation.kind !== 'highlight' || !annotation.cfi) continue
        if (this.#annotationIndex.get(annotation.cfi) !== index) continue
        host.addAnnotation({ ...annotation, value: annotation.cfi }).catch(() => {})
      }
    })

    host.addEventListener('draw-annotation', (event: CustomEvent) => {
      const { draw, annotation } = event.detail ?? {}
      if (!draw || !annotation) return
      if (annotation.tts) {
        draw(Overlayer.underline, { color: annotation.color, width: 2.5 })
      } else {
        const color = HIGHLIGHT_COLORS[annotation.color as HighlightColor]?.value
          ?? HIGHLIGHT_COLORS.amber.value
        draw(Overlayer.highlight, { color })
      }
    })

    host.addEventListener('show-annotation', (event: CustomEvent) => {
      const { value, range } = event.detail ?? {}
      if (!value) return
      const annotation = this.#annotations.find(item => item.cfi === value)
      if (!annotation) return
      this.#callbacks.onAnnotationClick(annotation.id, screenRectOfRange(range))
    })

    host.addEventListener('external-link', (event: Event) => {
      event.preventDefault()
      this.#callbacks.onToast('已拦截书中的外部链接')
    })
  }

  #attachDocListeners(doc: Document) {
    if (this.#listenedDocs.has(doc)) return
    this.#listenedDocs.add(doc)

    let timer: number | undefined
    const selectionHandler = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => this.#emitSelection(doc), 30)
    }
    doc.addEventListener('mouseup', selectionHandler)
    doc.addEventListener('touchend', selectionHandler)
    doc.addEventListener('mousedown', () => this.#callbacks.onDismissPopovers())
    doc.addEventListener('keydown', event => this.#callbacks.onKeyDown(event))
  }

  #emitSelection(doc: Document) {
    try {
      const selection = doc.defaultView?.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const text = selection.toString().trim()
      if (text.length < 1) return
      const contents = this.#view.renderer?.getContents?.() ?? []
      const index = contents.find((item: any) => item.doc === doc)?.index
      if (typeof index !== 'number') return
      const cfi = this.#view.getCFI(index, range)
      if (!cfi) return
      this.#callbacks.onSelection({
        cfi,
        text: text.slice(0, 1000),
        rect: screenRectOfRange(range),
        chapter: this.#lastLocation?.chapter || this.#lastLocation?.label || '',
      })
    } catch {
      /* ignore selection errors */
    }
  }

  async #resolveAnnotationIndexes() {
    this.#annotationIndex.clear()
    for (const annotation of this.#annotations) {
      if (annotation.kind !== 'highlight' || !annotation.cfi) continue
      try {
        const resolved = await this.#view.resolveNavigation(annotation.cfi)
        if (resolved && typeof resolved.index === 'number') {
          this.#annotationIndex.set(annotation.cfi, resolved.index)
        }
      } catch {
        /* old location may no longer resolve */
      }
    }
  }

  setAnnotations(annotations: Annotation[]) {
    this.#annotations = annotations
    if (!this.#ready) return
    void this.#resolveAnnotationIndexes().then(() => this.#syncAnnotations())
  }

  async #syncAnnotations() {
    if (!this.#view?.book || this.#view.isFixedLayout) return
    const highlights = this.#annotations.filter(item => item.kind === 'highlight' && item.cfi)
    const current = new Map(highlights.map(item => [item.cfi!, item]))

    for (const [cfi, drawn] of Array.from(this.#drawn.entries())) {
      const next = current.get(cfi)
      if (!next || next.updatedAt !== drawn.updatedAt || next.color !== drawn.color) {
        try {
          await this.#view.deleteAnnotation({ value: cfi })
        } catch {
          /* ignore */
        }
        this.#drawn.delete(cfi)
      }
    }

    for (const annotation of highlights) {
      if (this.#drawn.has(annotation.cfi!)) continue
      try {
        await this.#view.addAnnotation({ ...annotation, value: annotation.cfi })
        this.#drawn.set(annotation.cfi!, annotation)
      } catch {
        /* location may not resolve */
      }
    }
  }

  #applyStylesToDoc(doc: Document) {
    if (!doc) return
    const [before, after] = buildFoliateStyles(
      this.#settings, this.#format, !!this.#view?.isFixedLayout,
    )
    const renderer = this.#view?.renderer
    if (renderer?.setStyles) {
      renderer.setStyles([before, after])
    } else if (doc.head) {
      let style = doc.getElementById('moyue-reader-style') as HTMLStyleElement | null
      if (!style) {
        style = doc.createElement('style')
        style.id = 'moyue-reader-style'
        doc.head.append(style)
      }
      style.textContent = `${before}\n${after}`
    }
  }

  applySettings(settings: ReaderSettings) {
    this.#settings = settings
    const renderer = this.#view?.renderer
    if (!renderer) return
    renderer.setAttribute('flow', settings.flow)
    renderer.setAttribute('max-inline-size', `${settings.pageWidth}px`)
    renderer.setAttribute('max-column-count', '1')
    renderer.setAttribute('margin', '0')
    renderer.setAttribute('gap', '6%')
    this.#applyStylesToDoc(renderer.getContents?.()[0]?.doc)
    requestAnimationFrame(() => {
      try {
        renderer.render?.()
      } catch {
        /* ignore */
      }
    })
  }

  setSettings(settings: ReaderSettings) {
    if (this.#tts?.active) this.stopTTS()
    this.applySettings(settings)
  }

  async next() {
    if (!this.#view) return
    if (this.#tts?.active) this.stopTTS()
    await this.#view.next()
  }

  async prev() {
    if (!this.#view) return
    if (this.#tts?.active) this.stopTTS()
    await this.#view.prev()
  }

  async goTo(target: ReaderTarget) {
    if (!this.#view) return
    if (this.#tts?.active) this.stopTTS()
    if (typeof target.fraction === 'number') {
      await this.#view.goToFraction(target.fraction)
      return
    }
    if (target.cfi) {
      await this.#view.goTo(target.cfi)
      return
    }
    if (target.page) {
      try {
        const index = Math.max(0, target.page - 1)
        await this.#view.goTo(index)
      } catch {
        /* ignore */
      }
      return
    }
    if (target.href) {
      await this.#view.goTo(target.href)
    }
  }

  async goToFraction(fraction: number) {
    if (!this.#view) return
    if (this.#tts?.active) this.stopTTS()
    await this.#view.goToFraction(fraction)
  }

  startSearch(query: string) {
    const trimmed = query.trim()
    const generation = ++this.#searchGeneration
    if (!this.#view) return
    try {
      this.#view.clearSearch()
    } catch {
      /* ignore */
    }

    if (!trimmed) {
      this.#searchState = emptySearchState()
      this.#callbacks.onSearchUpdate(this.#searchState)
      return
    }

    const state: SearchState = {
      query: trimmed, running: true, progress: 0, groups: [], total: 0,
    }
    this.#searchState = state
    this.#callbacks.onSearchUpdate({ ...state })

    void (async () => {
      try {
        const iter = this.#view.search({
          query: trimmed,
          draw: Overlayer.outline,
          drawOptions: { color: READER_THEMES[this.#settings.theme].accent, width: 2 },
        })
        for await (const result of iter) {
          if (generation !== this.#searchGeneration) return
          if (result === 'done') break
          if (typeof result === 'object' && result && 'progress' in result
            && typeof (result as { progress?: number }).progress === 'number') {
            state.progress = (result as { progress: number }).progress
            this.#callbacks.onSearchUpdate({ ...state, groups: [...state.groups] })
            continue
          }
          if (result && typeof result === 'object' && 'subitems' in result) {
            const payload = result as {
              label?: string
              subitems?: Array<{ cfi: string; excerpt: { pre: string; match: string; post: string } }>
            }
            const label = payload.label || '未命名章节'
            const hits: SearchHit[] = (payload.subitems ?? []).map((item, index) => ({
              id: `${generation}-${state.groups.length}-${index}`,
              pre: item.excerpt?.pre ?? '',
              match: item.excerpt?.match ?? trimmed,
              post: item.excerpt?.post ?? '',
              chapter: label,
              payload: item.cfi,
            }))
            const existing = state.groups.findIndex(group => group.label === label)
            if (existing >= 0) state.groups[existing].hits.push(...hits)
            else state.groups.push({ label, hits })
            state.total += hits.length
            this.#callbacks.onSearchUpdate({ ...state, groups: [...state.groups] })
          }
        }
        if (generation !== this.#searchGeneration) return
        state.running = false
        state.progress = 1
        this.#callbacks.onSearchUpdate({ ...state, groups: [...state.groups] })
      } catch (error) {
        if (generation !== this.#searchGeneration) return
        state.running = false
        state.error = error instanceof Error ? error.message : '搜索失败'
        this.#callbacks.onSearchUpdate({ ...state, groups: [...state.groups] })
      }
    })()
  }

  clearSearch() {
    this.#searchGeneration++
    try {
      this.#view?.clearSearch()
    } catch {
      /* ignore */
    }
    this.#searchState = emptySearchState()
    this.#callbacks.onSearchUpdate(this.#searchState)
  }

  async revealSearchHit(hit: SearchHit) {
    if (!this.#view) return
    if (this.#tts?.active) this.stopTTS()
    try {
      await this.#view.goTo(String(hit.payload))
    } catch {
      this.#callbacks.onToast('无法定位这条搜索结果')
    }
  }

  startTTS() {
    if (typeof speechSynthesis === 'undefined') {
      this.#callbacks.onToast('当前浏览器不支持语音朗读')
      return
    }
    try {
      this.stopTTS()
      const content = this.#view?.renderer?.getContents?.()[0]
      if (!content?.doc) {
        this.#callbacks.onToast('页面尚未准备好，请稍后再试')
        return
      }
      const sentences = extractSentences(content.doc)
      if (!sentences.length) {
        this.#callbacks.onToast('当前章节没有可朗读的文字')
        return
      }
      const startIndex = findSentenceIndex(sentences, this.#lastVisibleRange())
      this.#tts = {
        active: true,
        paused: false,
        doc: content.doc,
        docIndex: content.index,
        sentences,
        index: Math.max(0, startIndex),
        token: 1,
      }
      speechSynthesis.cancel()
      this.#speakCurrent()
    } catch (error) {
      console.error(error)
      this.stopTTS()
      this.#callbacks.onToast('朗读启动失败，请稍后再试')
    }
  }

  #lastVisibleRange(): Range | null {
    const range = this.#view?.lastLocation?.range
    return range && typeof range.startContainer !== 'undefined' ? range : null
  }

  #chapterLabel() {
    return this.#lastLocation?.chapter || this.#lastLocation?.label || '正在朗读'
  }

  #emitTTS(text: string, extra?: Partial<TTSState>) {
    this.#callbacks.onTTSUpdate({
      active: !!this.#tts?.active,
      paused: !!this.#tts?.paused,
      text,
      chapter: this.#chapterLabel(),
      ...extra,
    })
  }

  #speakCurrent() {
    const tts = this.#tts
    if (!tts?.active) return
    if (tts.index >= tts.sentences.length) {
      void this.#advanceTTSChapter()
      return
    }
    const sentence = tts.sentences[tts.index]
    const token = ++tts.token
    this.#emitTTS(sentence.text)
    void this.#highlightTTSSentence(sentence)

    const utterance = new SpeechSynthesisUtterance(sentence.text)
    utterance.lang = this.#language
    utterance.rate = this.#settings.ttsRate
    const voice = chooseVoice(this.#language, this.#settings.ttsVoiceURI)
    if (voice) utterance.voice = voice

    utterance.onend = () => {
      if (!this.#tts?.active || this.#tts.token !== token) return
      this.#tts.index++
      window.setTimeout(() => this.#speakCurrent(), 30)
    }
    utterance.onerror = event => {
      if (!this.#tts?.active || this.#tts.token !== token) return
      if (event.error === 'canceled' || event.error === 'interrupted') return
      this.stopTTS()
      this.#callbacks.onToast('朗读中断，请检查系统的语音服务')
    }
    speechSynthesis.speak(utterance)
  }

  async #highlightTTSSentence(sentence: Sentence) {
    const tts = this.#tts
    const content = this.#view?.renderer?.getContents?.()[0]
    if (!tts?.active || !content?.doc || content.index !== tts.docIndex) return
    try {
      const renderer = this.#view.renderer
      if (renderer?.scrollToAnchor) await renderer.scrollToAnchor(sentence.range)
      if (!this.#tts?.active || this.#tts.token !== tts.token) return
      const cfi = this.#view.getCFI(content.index, sentence.range)
      if (this.#ttsHighlightCfi && this.#ttsHighlightCfi !== cfi) {
        await this.#view.deleteAnnotation({ value: this.#ttsHighlightCfi }).catch(() => {})
      }
      this.#ttsHighlightCfi = cfi
      await this.#view.addAnnotation({
        value: cfi,
        color: READER_THEMES[this.#settings.theme].accent,
        tts: true,
      })
    } catch {
      /* highlight is optional */
    }
  }

  async #advanceTTSChapter() {
    const tts = this.#tts
    if (!tts?.active || this.#ttsAdvancing) return
    this.#ttsAdvancing = true
    try {
      const currentIndex = this.#view.renderer?.getContents?.()[0]?.index ?? tts.docIndex
      const sections = this.#book?.sections ?? []
      let nextIndex = currentIndex + 1
      while (nextIndex < sections.length && sections[nextIndex]?.linear === 'no') nextIndex++
      if (nextIndex >= sections.length) {
        this.stopTTS()
        this.#callbacks.onToast('已经读到本书末尾')
        return
      }
      await this.#view.goTo(nextIndex)
      if (!this.#tts?.active) return
      const content = this.#view.renderer?.getContents?.()[0]
      if (!content?.doc) {
        this.stopTTS()
        return
      }
      const sentences = extractSentences(content.doc)
      this.#tts = {
        ...this.#tts,
        doc: content.doc,
        docIndex: content.index,
        sentences,
        index: 0,
        token: this.#tts.token + 1,
      }
      this.#ttsAdvancing = false
      this.#speakCurrent()
    } catch {
      this.#ttsAdvancing = false
      this.stopTTS()
    }
  }

  toggleTTS() {
    if (!this.#tts?.active) {
      this.startTTS()
      return
    }
    if (this.#tts.paused) {
      speechSynthesis.resume()
      this.#tts.paused = false
      this.#emitTTS(this.#tts.sentences[this.#tts.index]?.text ?? '')
    } else {
      speechSynthesis.pause()
      this.#tts.paused = true
      this.#emitTTS(this.#tts.sentences[this.#tts.index]?.text ?? '')
    }
  }

  stopTTS() {
    const wasActive = !!this.#tts?.active
    if (this.#tts) this.#tts.token++
    this.#tts = null
    try {
      speechSynthesis.cancel()
    } catch {
      /* ignore */
    }
    if (this.#ttsHighlightCfi && this.#view) {
      this.#view.deleteAnnotation({ value: this.#ttsHighlightCfi }).catch(() => {})
      this.#ttsHighlightCfi = null
    }
    if (wasActive) this.#callbacks.onTTSUpdate({ active: false, paused: false, text: '' })
  }

  nextTTSSentence() {
    if (!this.#tts?.active) return
    this.#tts.index = Math.min(this.#tts.index + 1, this.#tts.sentences.length)
    speechSynthesis.cancel()
    this.#tts.paused = false
    this.#speakCurrent()
  }

  prevTTSSentence() {
    if (!this.#tts?.active) return
    this.#tts.index = Math.max(0, this.#tts.index - 1)
    speechSynthesis.cancel()
    this.#tts.paused = false
    this.#speakCurrent()
  }

  destroy() {
    this.#destroyed = true
    this.stopTTS()
    this.#searchGeneration++
    try {
      this.#view?.close?.()
    } catch {
      /* ignore */
    }
    try {
      this.#book?.destroy?.()
    } catch {
      /* ignore */
    }
    if (this.#container) this.#container.replaceChildren()
    this.#view = null
    this.#book = null
    this.#drawn.clear()
    this.#annotationIndex.clear()
  }
}
