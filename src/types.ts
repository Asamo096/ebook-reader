export type BookFormat = 'EPUB' | 'MOBI' | 'AZW3' | 'PDF' | 'TXT'

export type EngineKind = 'reflowable' | 'pdf'

export interface ReadingProgress {
  fraction: number
  location?: string
  label?: string
  updatedAt: number
}

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  fileName: string
  fileSize: number
  file: Blob
  cover?: Blob | null
  addedAt: number
  lastOpenedAt: number
  progress: ReadingProgress
  description?: string
  publisher?: string
  language?: string
  published?: string
}

export type HighlightColor = 'amber' | 'sage' | 'sky' | 'rose'

export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  bookId: string
  kind: 'highlight' | 'bookmark'
  engine: EngineKind
  /** EPUB / MOBI / AZW3 / TXT location */
  cfi?: string
  /** PDF page, 1-based */
  page?: number
  /** PDF highlight rectangles, normalized to the page */
  rects?: PdfRect[]
  quote: string
  note?: string
  color?: HighlightColor
  chapter?: string
  createdAt: number
  updatedAt: number
}

export interface TocItem {
  label: string
  href?: string
  page?: number
  subitems?: TocItem[]
}

export interface ReaderLocation {
  fraction: number
  label: string
  chapter?: string
  cfi?: string
  page?: number
  totalPages?: number
  tocHref?: string
}

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface SelectionInfo {
  text: string
  rect: ScreenRect | null
  chapter: string
  cfi?: string
  page?: number
  rects?: PdfRect[]
}

export interface SearchHit {
  id: string
  pre: string
  match: string
  post: string
  chapter: string
  payload: unknown
}

export interface SearchGroup {
  label: string
  hits: SearchHit[]
}

export interface SearchState {
  query: string
  running: boolean
  progress: number
  groups: SearchGroup[]
  total: number
  error?: string
}

export interface TTSState {
  active: boolean
  paused: boolean
  text: string
  chapter?: string
}

export type ReaderThemeId = 'paper' | 'cream' | 'sage' | 'dusk' | 'night'
export type FontFamilyId = 'serif' | 'sans' | 'kai'
export type FlowMode = 'paginated' | 'scrolled'

export interface ReaderSettings {
  theme: ReaderThemeId
  fontFamily: FontFamilyId
  fontSize: number
  lineHeight: number
  pageWidth: number
  flow: FlowMode
  justify: boolean
  ttsRate: number
  ttsVoiceURI: string
}

export interface ReaderTarget {
  cfi?: string
  page?: number
  href?: string
  fraction?: number
}

export interface ReaderEngineHandle {
  next(): Promise<void>
  prev(): Promise<void>
  goTo(target: ReaderTarget): Promise<void>
  goToFraction(fraction: number): Promise<void>
  startSearch(query: string): void
  clearSearch(): void
  revealSearchHit(hit: SearchHit): Promise<void>
  startTTS(): void
  toggleTTS(): void
  stopTTS(): void
  nextTTSSentence(): void
  prevTTSSentence(): void
  setSettings(settings: ReaderSettings): void
  setAnnotations(annotations: Annotation[]): void
  destroy(): void
}

export interface ReadyInfo {
  toc: TocItem[]
  isFixedLayout: boolean
  chapterCount: number
}

export interface EngineCallbacks {
  onReady: (info: ReadyInfo) => void
  onRelocate: (location: ReaderLocation) => void
  onSelection: (selection: SelectionInfo | null) => void
  onAnnotationClick: (annotationId: string, rect: ScreenRect | null) => void
  onSearchUpdate: (state: SearchState) => void
  onTTSUpdate: (state: TTSState) => void
  onDismissPopovers: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onToast: (message: string) => void
  onError: (message: string) => void
}

export const FORMAT_INFO: Record<BookFormat, { label: string; color: string }> = {
  EPUB: { label: 'EPUB', color: '#5b8a72' },
  MOBI: { label: 'MOBI', color: '#a57b4f' },
  AZW3: { label: 'AZW3', color: '#7c6a9e' },
  PDF: { label: 'PDF', color: '#b15b4f' },
  TXT: { label: 'TXT', color: '#6f7d8c' },
}

export const HIGHLIGHT_COLORS: Record<HighlightColor, { label: string; value: string }> = {
  amber: { label: '琥珀', value: '#e0aa3e' },
  sage: { label: '青芽', value: '#78a884' },
  sky: { label: '天青', value: '#6f9fc4' },
  rose: { label: '蔷薇', value: '#d28b98' },
}
