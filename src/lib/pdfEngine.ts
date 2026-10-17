import * as pdfjsLib from 'pdfjs-dist'
import type {
  Annotation, EngineCallbacks, HighlightColor, PdfRect, ReadyInfo,
  ReaderEngineHandle, ReaderLocation, ReaderSettings, ReaderTarget, ScreenRect,
  SearchHit, SearchState, SelectionInfo, TTSState, TocItem,
} from '../types'
import { HIGHLIGHT_COLORS } from '../types'
import { buildPdfToc, loadPdfDocument, type PDFDocument } from './pdf'
import { chooseVoice, extractSentences, normalizeLanguage, type Sentence } from './sentences'
import { READER_THEMES } from './themes'
import { clamp } from './utils'

interface OpenOptions {
  file: Blob
  initialLocation?: string
  language?: string
}

interface PageState {
  number: number
  wrapper: HTMLDivElement
  surface: HTMLDivElement
  canvas: HTMLCanvasElement
  textLayer: HTMLDivElement
  annotationLayer: HTMLDivElement
  overlayLayer: HTMLDivElement
  dims?: { width: number; height: number }
  rendered: boolean
  rendering: Promise<void> | null
}

const emptySearchState = (query = ''): SearchState => ({
  query, running: false, progress: 0, groups: [], total: 0,
})

const rectToScreen = (rect: DOMRect): ScreenRect => ({
  left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
  width: rect.width, height: rect.height,
})

const mergeRects = (rects: PdfRect[]): PdfRect[] => {
  const merged: PdfRect[] = []
  for (const rect of rects) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.y - rect.y) < 0.004 && Math.abs(last.h - rect.h) < 0.004
      && rect.x - (last.x + last.w) < 0.012) {
      const right = Math.max(last.x + last.w, rect.x + rect.w)
      last.w = right - last.x
    } else {
      merged.push({ ...rect })
    }
  }
  return merged
}

export class PdfEngine implements ReaderEngineHandle {
  #container: HTMLElement
  #callbacks: EngineCallbacks
  #settings: ReaderSettings
  #annotations: Annotation[] = []
  #pdf: PDFDocument | null = null
  #scroll: HTMLDivElement | null = null
  #pagesHost: HTMLDivElement | null = null
  #pages = new Map<number, PageState>()
  #observer: IntersectionObserver | null = null
  #currentPage = 1
  #totalPages = 0
  #zoom = 1
  #baseScale = 1
  #firstDims = { width: 612, height: 792 }
  #pageTextCache = new Map<number, string>()
  #toc: TocItem[] = []
  #language = 'zh-CN'
  #destroyed = false
  #renderGeneration = 0
  #scrollFrame = 0
  #searchGeneration = 0
  #searchState = emptySearchState()
  #searchQuery = ''
  #searchPage = 0
  #searchMatchIndex = 0
  #tts: {
    active: boolean
    paused: boolean
    page: number
    sentences: Sentence[]
    index: number
    token: number
  } | null = null
  #ttsHighlight: { page: number; rects: PdfRect[] } | null = null
  #lastEmittedPage = 0
  #events = new AbortController()

  constructor(options: {
    container: HTMLElement
    settings: ReaderSettings
    annotations: Annotation[]
    callbacks: EngineCallbacks
  }) {
    this.#container = options.container
    this.#settings = options.settings
    this.#annotations = options.annotations
    this.#callbacks = options.callbacks
  }

  async open(options: OpenOptions) {
    this.#language = normalizeLanguage(options.language)
    const root = document.createElement('div')
    root.className = 'pdf-engine'
    root.tabIndex = 0
    const scroll = document.createElement('div')
    scroll.className = 'pdf-scroll'
    const pagesHost = document.createElement('div')
    pagesHost.className = 'pdf-pages'
    scroll.append(pagesHost)
    root.append(scroll)
    this.#container.replaceChildren(root)
    this.#scroll = scroll
    this.#pagesHost = pagesHost

    scroll.addEventListener('scroll', this.#onScroll, { passive: true })
    root.addEventListener('mouseup', this.#onMouseUp)
    root.addEventListener('touchend', this.#onMouseUp)
    root.addEventListener('pointerdown', () => this.#callbacks.onDismissPopovers())
    const resizeObserver = new ResizeObserver(() => this.#relayout())
    resizeObserver.observe(this.#container)
    this.#events.signal.addEventListener('abort', () => resizeObserver.disconnect())

    try {
      const buffer = await options.file.arrayBuffer()
      const pdf = await loadPdfDocument(buffer)
      if (this.#destroyed) {
        await pdf.destroy()
        return
      }
      this.#pdf = pdf
      this.#totalPages = pdf.numPages
      const firstPage = await pdf.getPage(1)
      const firstViewport = firstPage.getViewport({ scale: 1 })
      this.#firstDims = { width: firstViewport.width, height: firstViewport.height }
      this.#toc = await buildPdfToc(pdf)
      this.#buildPageSkeletons()
      this.#relayout()

      const initial = Number(/^pdf:(\d+)/.exec(options.initialLocation ?? '')?.[1]) || 1
      this.#currentPage = clamp(initial, 1, this.#totalPages)
      this.#observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const number = Number((entry.target as HTMLElement).dataset.page)
          if (number) void this.#renderPage(number)
        }
      }, { root: scroll, rootMargin: '900px 0px' })
      for (const state of this.#pages.values()) this.#observer.observe(state.wrapper)

      await this.#renderPage(this.#currentPage)
      if (this.#destroyed) return
      this.#scrollToPage(this.#currentPage, 'auto')
      this.#emitRelocate(true)

      const info: ReadyInfo = {
        toc: this.#toc,
        isFixedLayout: false,
        chapterCount: this.#totalPages,
      }
      this.#callbacks.onReady(info)
    } catch (error) {
      if (this.#destroyed) return
      const message = error instanceof Error ? error.message : String(error)
      this.#callbacks.onError(/password/i.test(message)
        ? '这份 PDF 已加密，需要密码才能打开。'
        : message || '无法打开 PDF')
    }
  }

  #buildPageSkeletons() {
    if (!this.#pagesHost) return
    const fragment = document.createDocumentFragment()
    const ratio = this.#firstDims.height / this.#firstDims.width
    for (let page = 1; page <= this.#totalPages; page++) {
      const wrapper = document.createElement('div')
      wrapper.className = 'pdf-page'
      wrapper.dataset.page = String(page)
      const surface = document.createElement('div')
      surface.className = 'pdf-page__surface'
      surface.style.paddingBottom = `${ratio * 100}%`
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-page__canvas'
      const textLayer = document.createElement('div')
      textLayer.className = 'textLayer'
      const annotationLayer = document.createElement('div')
      annotationLayer.className = 'pdf-page__annotations'
      const overlayLayer = document.createElement('div')
      overlayLayer.className = 'pdf-page__overlay'
      surface.append(canvas, textLayer, annotationLayer, overlayLayer)
      const label = document.createElement('span')
      label.className = 'pdf-page__label'
      label.textContent = String(page)
      wrapper.append(surface, label)
      fragment.append(wrapper)
      this.#pages.set(page, {
        number: page, wrapper, surface, canvas, textLayer,
        annotationLayer, overlayLayer, rendered: false, rendering: null,
      })
    }
    this.#pagesHost.append(fragment)
  }

  #computeScale() {
    const width = this.#scroll?.clientWidth ?? this.#container.clientWidth
    const available = Math.min(940, Math.max(320, width - 48))
    this.#baseScale = available / this.#firstDims.width
    return this.#baseScale * this.#zoom
  }

  #relayout() {
    if (!this.#scroll || !this.#pages.size) return
    this.#baseScale = this.#computeScale() / this.#zoom
    const previouslyRendered = Array.from(this.#pages.values())
      .filter(state => state.rendered)
      .map(state => state.number)
    for (const state of this.#pages.values()) {
      state.rendered = false
      state.rendering = null
      state.textLayer.replaceChildren()
      state.overlayLayer.replaceChildren()
      state.annotationLayer.replaceChildren()
      state.canvas.width = 0
      state.canvas.height = 0
      state.canvas.style.width = '0'
      state.canvas.style.height = '0'
      if (state.dims) {
        const width = state.dims.width * this.#baseScale * this.#zoom
        const height = state.dims.height * this.#baseScale * this.#zoom
        state.surface.style.paddingBottom = '0'
        state.surface.style.width = `${width}px`
        state.surface.style.height = `${height}px`
      }
    }
    if (this.#pagesHost) {
      this.#pagesHost.style.setProperty(
        '--pdf-page-width',
        `${this.#firstDims.width * this.#baseScale * this.#zoom}px`,
      )
    }
    this.#renderGeneration++
    for (const page of previouslyRendered) void this.#renderPage(page)
    void this.#renderPage(this.#currentPage)
  }

  async #renderPage(number: number): Promise<void> {
    const state = this.#pages.get(number)
    if (!state || !this.#pdf || this.#destroyed) return
    if (state.rendered) {
      this.#paintAnnotations(state)
      this.#paintSearch(state)
      this.#paintTTS(state)
      return
    }
    if (state.rendering) return state.rendering

    const generation = this.#renderGeneration
    state.rendering = (async () => {
      try {
        const page = await this.#pdf!.getPage(number)
        const baseViewport = page.getViewport({ scale: 1 })
        state.dims = { width: baseViewport.width, height: baseViewport.height }
        const scale = this.#baseScale * this.#zoom
        const viewport = page.getViewport({ scale })
        const cssPixels = Math.max(1, viewport.width * viewport.height)
        const dpr = Math.max(1, Math.min(
          2,
          window.devicePixelRatio || 1,
          Math.sqrt(12_000_000 / cssPixels),
        ))
        const renderViewport = page.getViewport({ scale: scale * dpr })

        state.surface.style.paddingBottom = '0'
        state.surface.style.width = `${viewport.width}px`
        state.surface.style.height = `${viewport.height}px`
        state.surface.style.setProperty('--total-scale-factor', String(scale))

        const canvas = state.canvas
        canvas.width = Math.floor(renderViewport.width)
        canvas.height = Math.floor(renderViewport.height)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('无法创建画布')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({
          canvas,
          viewport: renderViewport,
        }).promise
        if (this.#destroyed || generation !== this.#renderGeneration) return

        const textLayer = state.textLayer
        textLayer.replaceChildren()
        textLayer.style.width = `${viewport.width}px`
        textLayer.style.height = `${viewport.height}px`
        textLayer.style.setProperty('--total-scale-factor', String(scale))
        const layer = new (pdfjsLib as unknown as {
          TextLayer: new (options: {
            textContentSource: ReadableStream
            container: HTMLElement
            viewport: unknown
          }) => { render: () => Promise<void> }
        }).TextLayer({
          textContentSource: await page.streamTextContent(),
          container: textLayer,
          viewport,
        })
        await layer.render()
        if (this.#destroyed || generation !== this.#renderGeneration) return
        const endOfContent = document.createElement('div')
        endOfContent.className = 'endOfContent'
        textLayer.append(endOfContent)

        state.rendered = true
        this.#paintAnnotations(state)
        this.#paintSearch(state)
        this.#paintTTS(state)
      } catch (error) {
        if (!this.#destroyed) {
          console.error('PDF page render failed', number, error)
        }
      } finally {
        state.rendering = null
      }
    })()
    return state.rendering
  }

  #paintAnnotations(state: PageState) {
    state.annotationLayer.replaceChildren()
    const highlights = this.#annotations.filter(annotation =>
      annotation.engine === 'pdf' && annotation.page === state.number
      && annotation.kind === 'highlight' && annotation.rects?.length)
    for (const annotation of highlights) {
      const color = HIGHLIGHT_COLORS[(annotation.color ?? 'amber') as HighlightColor]?.value
        ?? HIGHLIGHT_COLORS.amber.value
      for (const rect of annotation.rects!) {
        const el = document.createElement('div')
        el.className = 'pdf-highlight'
        el.style.left = `${rect.x * 100}%`
        el.style.top = `${rect.y * 100}%`
        el.style.width = `${rect.w * 100}%`
        el.style.height = `${rect.h * 100}%`
        el.style.background = color
        el.title = annotation.note || annotation.quote
        el.addEventListener('click', event => {
          event.stopPropagation()
          this.#callbacks.onAnnotationClick(annotation.id, rectToScreen(el.getBoundingClientRect()))
        })
        state.annotationLayer.append(el)
      }
    }
  }

  #paintSearch(state: PageState) {
    if (state.number !== this.#searchPage || !this.#searchQuery) return
    const matches = this.#findDomMatches(state, this.#searchQuery)
    for (const rects of matches) {
      for (const rect of rects) {
        const el = document.createElement('div')
        el.className = 'pdf-search-hit'
        el.style.left = `${rect.x * 100}%`
        el.style.top = `${rect.y * 100}%`
        el.style.width = `${rect.w * 100}%`
        el.style.height = `${rect.h * 100}%`
        state.overlayLayer.append(el)
      }
    }
  }

  #paintTTS(state: PageState) {
    const highlight = this.#ttsHighlight
    if (!highlight || highlight.page !== state.number) return
    for (const rect of highlight.rects) {
      const el = document.createElement('div')
      el.className = 'pdf-tts-hit'
      el.style.left = `${rect.x * 100}%`
      el.style.top = `${rect.y * 100}%`
      el.style.width = `${rect.w * 100}%`
      el.style.height = `${rect.h * 100}%`
      el.style.background = READER_THEMES[this.#settings.theme].accent
      state.overlayLayer.append(el)
    }
  }

  #findDomMatches(state: PageState, query: string): PdfRect[][] {
    const textLayer = state.textLayer
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
    const nodes: Array<{ node: Text; start: number }> = []
    let text = ''
    let node = walker.nextNode() as Text | null
    while (node) {
      nodes.push({ node, start: text.length })
      text += node.nodeValue ?? ''
      node = walker.nextNode() as Text | null
    }
    const haystack = text.toLocaleLowerCase()
    const needle = query.toLocaleLowerCase()
    if (!needle) return []
    const pageRect = state.textLayer.getBoundingClientRect()
    const results: PdfRect[][] = []
    let index = -1
    const pointAt = (offset: number) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (offset >= nodes[i].start) {
          return { node: nodes[i].node, offset: offset - nodes[i].start }
        }
      }
      return { node: nodes[0].node, offset: 0 }
    }
    while ((index = haystack.indexOf(needle, index + 1)) > -1) {
      const start = pointAt(index)
      const end = pointAt(index + needle.length)
      try {
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        const rects = Array.from(range.getClientRects())
          .filter(rect => rect.width > 0.5 && rect.height > 0.5)
          .map(rect => ({
            x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
            y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
            w: clamp(rect.width / pageRect.width, 0, 1),
            h: clamp(rect.height / pageRect.height, 0, 1),
          }))
        if (rects.length) results.push(mergeRects(rects))
      } catch {
        /* skip */
      }
      if (results.length > 500) break
    }
    return results
  }

  #onScroll = () => {
    if (this.#scrollFrame) return
    this.#scrollFrame = requestAnimationFrame(() => {
      this.#scrollFrame = 0
      if (!this.#scroll || !this.#pages.size) return
      const anchor = this.#scroll.scrollTop + this.#scroll.clientHeight * 0.32
      let page = 1
      for (const state of this.#pages.values()) {
        if (state.wrapper.offsetTop <= anchor) page = state.number
        else break
      }
      if (page !== this.#currentPage) {
        this.#currentPage = page
        this.#emitRelocate()
      }
    })
  }

  #emitRelocate(force = false) {
    if (!force && this.#lastEmittedPage === this.#currentPage) return
    this.#lastEmittedPage = this.#currentPage
    this.#prunePages()
    const label = `第 ${this.#currentPage} / ${this.#totalPages} 页`
    const location: ReaderLocation = {
      fraction: this.#totalPages ? this.#currentPage / this.#totalPages : 0,
      label,
      chapter: label,
      page: this.#currentPage,
      totalPages: this.#totalPages,
    }
    this.#callbacks.onRelocate(location)
  }

  #prunePages() {
    for (const state of this.#pages.values()) {
      if (!state.rendered || Math.abs(state.number - this.#currentPage) <= 4) continue
      state.rendered = false
      state.rendering = null
      state.canvas.width = 0
      state.canvas.height = 0
      state.canvas.style.width = '0'
      state.canvas.style.height = '0'
      state.textLayer.replaceChildren()
      state.annotationLayer.replaceChildren()
      state.overlayLayer.replaceChildren()
    }
  }

  #scrollToPage(page: number, behavior: ScrollBehavior = 'auto') {
    if (!this.#scroll) return
    const state = this.#pages.get(page)
    if (!state) return
    this.#currentPage = page
    const scrollRect = this.#scroll.getBoundingClientRect()
    const top = state.wrapper.getBoundingClientRect().top - scrollRect.top
      + this.#scroll.scrollTop - 14
    this.#scroll.scrollTo({ top, behavior })
    this.#emitRelocate()
  }

  #onMouseUp = () => {
    window.setTimeout(() => this.#emitSelection(), 20)
  }

  #emitSelection() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    const text = selection.toString().trim()
    if (!text) return
    const anchor = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
    const pageEl = anchor?.closest('.pdf-page') as HTMLElement | null
    if (!pageEl) return
    const page = Number(pageEl.dataset.page)
    const surface = pageEl.querySelector('.pdf-page__surface') as HTMLElement | null
    if (!surface) return
    const pageRect = surface.getBoundingClientRect()
    const rects = Array.from(range.getClientRects())
      .filter(rect => rect.width > 0.5 && rect.height > 0.5)
      .filter(rect => rect.bottom > pageRect.top && rect.top < pageRect.bottom)
      .map(rect => ({
        x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        w: clamp(rect.width / pageRect.width, 0, 1),
        h: clamp(rect.height / pageRect.height, 0, 1),
      }))
    if (!rects.length) return
    const bounding = range.getBoundingClientRect()
    this.#callbacks.onSelection({
      text: text.slice(0, 1000),
      page,
      rects: mergeRects(rects),
      rect: rectToScreen(bounding),
      chapter: `第 ${page} 页`,
    })
  }

  async next() {
    if (this.#tts?.active) this.stopTTS()
    await this.goTo({ page: Math.min(this.#totalPages, this.#currentPage + 1) })
  }

  async prev() {
    if (this.#tts?.active) this.stopTTS()
    await this.goTo({ page: Math.max(1, this.#currentPage - 1) })
  }

  async goTo(target: ReaderTarget) {
    if (typeof target.page === 'number') {
      const page = clamp(Math.round(target.page), 1, this.#totalPages)
      await this.#renderPage(page)
      this.#scrollToPage(page, 'smooth')
      return
    }
    if (typeof target.fraction === 'number') {
      await this.goToFraction(target.fraction)
    }
  }

  async goToFraction(fraction: number) {
    const page = clamp(Math.round(fraction * this.#totalPages) || 1, 1, this.#totalPages)
    await this.goTo({ page })
  }

  setZoom(zoom: number) {
    this.#zoom = clamp(zoom, 0.6, 2.5)
    this.#relayout()
    requestAnimationFrame(() => this.#scrollToPage(this.#currentPage, 'auto'))
  }

  getZoom() {
    return this.#zoom
  }

  getCurrentPage() {
    return this.#currentPage
  }

  getTotalPages() {
    return this.#totalPages
  }

  setSettings(settings: ReaderSettings) {
    this.#settings = settings
    for (const state of this.#pages.values()) {
      if (state.rendered) {
        state.overlayLayer.replaceChildren()
        this.#paintSearch(state)
        this.#paintTTS(state)
      }
    }
  }

  setAnnotations(annotations: Annotation[]) {
    this.#annotations = annotations
    for (const state of this.#pages.values()) {
      if (state.rendered) this.#paintAnnotations(state)
    }
  }

  startSearch(query: string) {
    const trimmed = query.trim()
    const generation = ++this.#searchGeneration
    this.#searchQuery = trimmed
    this.#searchPage = 0
    this.#searchMatchIndex = 0
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
    for (const pageState of this.#pages.values()) {
      pageState.overlayLayer.replaceChildren()
      this.#paintTTS(pageState)
    }

    void (async () => {
      try {
        for (let page = 1; page <= this.#totalPages; page++) {
          if (generation !== this.#searchGeneration || this.#destroyed) return
          const text = await this.#pageText(page)
          if (!text) {
            state.progress = page / this.#totalPages
            continue
          }
          const haystack = text.toLocaleLowerCase()
          const needle = trimmed.toLocaleLowerCase()
          const hits: SearchHit[] = []
          let index = -1
          let matchIndex = 0
          while ((index = haystack.indexOf(needle, index + 1)) > -1) {
            const pre = text.slice(Math.max(0, index - 42), index)
            const match = text.slice(index, index + trimmed.length)
            const post = text.slice(index + trimmed.length, index + trimmed.length + 64)
            hits.push({
              id: `pdf-${page}-${matchIndex}`,
              pre, match, post,
              chapter: `第 ${page} 页`,
              payload: { page, matchIndex },
            })
            matchIndex++
            if (state.total + hits.length >= 500) break
          }
          if (hits.length) {
            state.groups.push({ label: `第 ${page} 页`, hits })
            state.total += hits.length
          }
          state.progress = page / this.#totalPages
          this.#callbacks.onSearchUpdate({ ...state, groups: [...state.groups] })
          if (state.total >= 500) {
            state.error = '结果较多，仅显示前 500 条。可尝试更精确的关键词。'
            break
          }
          if (page % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0))
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

  async #pageText(page: number) {
    const cached = this.#pageTextCache.get(page)
    if (cached != null) return cached
    if (!this.#pdf) return ''
    try {
      const pageProxy = await this.#pdf.getPage(page)
      const content = await pageProxy.getTextContent()
      const text = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      this.#pageTextCache.set(page, text)
      return text
    } catch {
      this.#pageTextCache.set(page, '')
      return ''
    }
  }

  clearSearch() {
    this.#searchGeneration++
    this.#searchQuery = ''
    this.#searchPage = 0
    for (const state of this.#pages.values()) {
      state.overlayLayer.replaceChildren()
      this.#paintTTS(state)
    }
    this.#searchState = emptySearchState()
    this.#callbacks.onSearchUpdate(this.#searchState)
  }

  async revealSearchHit(hit: SearchHit) {
    const payload = hit.payload as { page?: number; matchIndex?: number } | undefined
    const page = payload?.page
    if (!page) return
    if (this.#tts?.active) this.stopTTS()
    this.#searchPage = page
    this.#searchMatchIndex = payload.matchIndex ?? 0
    this.#searchQuery = this.#searchState.query || this.#searchQuery
    for (const state of this.#pages.values()) state.overlayLayer.replaceChildren()
    await this.#renderPage(page)
    this.#scrollToPage(page, 'smooth')
    const state = this.#pages.get(page)
    if (!state) return
    await new Promise(resolve => setTimeout(resolve, 80))
    state.overlayLayer.replaceChildren()
    this.#paintTTS(state)
    this.#paintSearch(state)
    const hits = state.overlayLayer.querySelectorAll('.pdf-search-hit')
    if (hits.length) {
      const perMatch = this.#findDomMatches(state, this.#searchQuery)
      const before = perMatch.slice(0, this.#searchMatchIndex)
        .reduce((sum, rects) => sum + rects.length, 0)
      const target = hits[Math.min(hits.length - 1, before)]
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  clearTTSHighlight() {
    this.#ttsHighlight = null
    for (const state of this.#pages.values()) {
      state.overlayLayer.replaceChildren()
      this.#paintSearch(state)
    }
  }

  startTTS() {
    if (typeof speechSynthesis === 'undefined') {
      this.#callbacks.onToast('当前浏览器不支持语音朗读')
      return
    }
    this.stopTTS()
    void this.#startTTSAtPage(this.#currentPage)
  }

  async #startTTSAtPage(startPage: number) {
    let page = startPage
    while (page <= this.#totalPages && !(await this.#pageText(page)).trim()) page++
    if (page > this.#totalPages) {
      this.#callbacks.onToast('没有找到可朗读的文字，扫描版 PDF 暂不支持朗读')
      return
    }
    await this.#renderPage(page)
    const state = this.#pages.get(page)
    if (!state || !state.rendered) {
      this.#callbacks.onToast('这一页还没有准备好')
      return
    }
    const sentences = extractSentences(state.textLayer)
    if (!sentences.length) {
      this.#callbacks.onToast('没有找到可提取的文字，扫描版 PDF 暂不支持朗读')
      return
    }
    this.#tts = {
      active: true,
      paused: false,
      page,
      sentences,
      index: 0,
      token: 1,
    }
    this.#scrollToPage(page, 'smooth')
    this.#speakCurrent()
  }

  #emitTTS(text: string) {
    this.#callbacks.onTTSUpdate({
      active: !!this.#tts?.active,
      paused: !!this.#tts?.paused,
      text,
      chapter: `第 ${this.#tts?.page ?? this.#currentPage} 页`,
    })
  }

  #speakCurrent() {
    const tts = this.#tts
    if (!tts?.active) return
    if (tts.index >= tts.sentences.length) {
      void this.#advanceTTSPage()
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

  #highlightTTSSentence(sentence: Sentence) {
    const state = this.#pages.get(this.#tts?.page ?? 0)
    if (!state || !state.rendered) return
    const layerRect = state.textLayer.getBoundingClientRect()
    const rects = Array.from(sentence.range.getClientRects())
      .filter(rect => rect.width > 0.5 && rect.height > 0.5)
      .map(rect => ({
        x: clamp((rect.left - layerRect.left) / layerRect.width, 0, 1),
        y: clamp((rect.top - layerRect.top) / layerRect.height, 0, 1),
        w: clamp(rect.width / layerRect.width, 0, 1),
        h: clamp(rect.height / layerRect.height, 0, 1),
      }))
    this.#ttsHighlight = { page: state.number, rects: mergeRects(rects) }
    state.overlayLayer.replaceChildren()
    this.#paintSearch(state)
    this.#paintTTS(state)
    const first = state.overlayLayer.querySelector('.pdf-tts-hit') as HTMLElement | null
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async #advanceTTSPage() {
    const tts = this.#tts
    if (!tts?.active) return
    let nextPage = tts.page + 1
    while (nextPage <= this.#totalPages && !(await this.#pageText(nextPage)).trim()) nextPage++
    if (nextPage > this.#totalPages) {
      this.stopTTS()
      this.#callbacks.onToast('已经读到最后一页')
      return
    }
    await this.#renderPage(nextPage)
    const state = this.#pages.get(nextPage)
    if (!state) {
      this.stopTTS()
      return
    }
    const sentences = extractSentences(state.textLayer)
    if (!sentences.length) {
      this.stopTTS()
      this.#callbacks.onToast('后面的页面没有可提取的文字')
      return
    }
    this.#tts = {
      ...tts,
      page: nextPage,
      sentences,
      index: 0,
      token: tts.token + 1,
    }
    this.#ttsHighlight = null
    this.#scrollToPage(nextPage, 'smooth')
    this.#speakCurrent()
  }

  toggleTTS() {
    if (!this.#tts?.active) {
      this.startTTS()
      return
    }
    if (this.#tts.paused) {
      speechSynthesis.resume()
      this.#tts.paused = false
    } else {
      speechSynthesis.pause()
      this.#tts.paused = true
    }
    this.#emitTTS(this.#tts.sentences[this.#tts.index]?.text ?? '')
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
    if (this.#ttsHighlight) this.clearTTSHighlight()
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
    this.#searchGeneration++
    this.stopTTS()
    this.#events.abort()
    if (this.#scrollFrame) cancelAnimationFrame(this.#scrollFrame)
    this.#observer?.disconnect()
    this.#observer = null
    if (this.#scroll) this.#scroll.removeEventListener('scroll', this.#onScroll)
    this.#pages.clear()
    const pdf = this.#pdf
    this.#pdf = null
    void pdf?.destroy()
    this.#container.replaceChildren()
  }
}
