import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TocItem } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const BASE = import.meta.env.BASE_URL

export const loadPdfDocument = (data: ArrayBuffer | Uint8Array) =>
  pdfjsLib.getDocument({
    data,
    cMapUrl: `${BASE}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

export type PDFDocument = Awaited<ReturnType<typeof loadPdfDocument>>

export const renderPdfCover = async (pdf: PDFDocument): Promise<Blob | null> => {
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = 680 / baseViewport.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, viewport }).promise
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88))
  } catch {
    return null
  }
}

export const extractPdfInfo = async (pdf: PDFDocument) => {
  let info: Record<string, unknown> = {}
  try {
    const metadata = await pdf.getMetadata()
    const raw = metadata.info as Record<string, unknown> | undefined
    const generic = metadata.metadata
    info = {
      title: generic?.get?.('dc:title') || raw?.Title,
      author: generic?.get?.('dc:creator') || raw?.Author,
      description: generic?.get?.('dc:description') || raw?.Subject,
      publisher: generic?.get?.('dc:publisher') || raw?.Publisher,
      language: generic?.get?.('dc:language'),
    }
  } catch {
    /* metadata is optional */
  }
  return info as {
    title?: string
    author?: string
    description?: string
    publisher?: string
    language?: string
  }
}

export const buildPdfToc = async (pdf: PDFDocument): Promise<TocItem[]> => {
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return []
    const resolvePage = async (dest: string | unknown[]) => {
      const resolved = typeof dest === 'string'
        ? await pdf.getDestination(dest)
        : dest
      if (!resolved?.[0]) return undefined
      try {
        return (await pdf.getPageIndex(resolved[0] as never)) + 1
      } catch {
        return undefined
      }
    }
    const mapItems = async (items: typeof outline): Promise<TocItem[]> => {
      const result: TocItem[] = []
      for (const item of items) {
        const page = item.dest ? await resolvePage(item.dest) : undefined
        result.push({
          label: item.title || '未命名章节',
          page,
          subitems: item.items?.length ? await mapItems(item.items) : undefined,
        })
      }
      return result
    }
    return await mapItems(outline)
  } catch {
    return []
  }
}
