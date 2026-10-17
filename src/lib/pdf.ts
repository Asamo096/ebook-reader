import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TocItem } from '../types'
import { textValue } from './utils'

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
  let info: {
    title?: string
    author?: string
    description?: string
    publisher?: string
    language?: string
  } = {}
  try {
    const metadata = await pdf.getMetadata()
    const raw = metadata.info as Record<string, unknown> | undefined
    const generic = metadata.metadata
    const value = (input: unknown) => {
      const text = textValue(input).trim()
      return text || undefined
    }
    info = {
      title: value(generic?.get?.('dc:title')) ?? value(raw?.Title),
      author: value(generic?.get?.('dc:creator')) ?? value(raw?.Author),
      description: value(generic?.get?.('dc:description')) ?? value(raw?.Subject),
      publisher: value(generic?.get?.('dc:publisher')) ?? value(raw?.Publisher),
      language: value(generic?.get?.('dc:language')),
    }
  } catch {
    /* metadata is optional */
  }
  return info
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
