import { makeBook } from '../vendor/foliate/view.js'
import type { Book } from '../types'
import { generateCover } from './cover'
import { decodeTextFile, parseTxtHeader } from './txt'
import { extractPdfInfo, loadPdfDocument, renderPdfCover } from './pdf'
import { cleanTitle, detectFormat, stripHtml, textValue, uid } from './utils'

const AUTHOR_KEYS = ['author', 'creator', 'authors']

const getAuthors = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return ''
  for (const key of AUTHOR_KEYS) {
    const value = textValue(metadata[key])
    if (value) return value
  }
  return ''
}

const isUsableCover = (blob: Blob | null | undefined) =>
  !!blob && blob.size > 600

export const createBookFromFile = async (file: File): Promise<Book> => {
  const format = detectFormat(file.name)
  if (!format) throw new Error('不支持的文件格式')
  if (file.size === 0) throw new Error('文件为空')

  const cleaned = cleanTitle(file.name)
  let title = cleaned.title
  let author = cleaned.author
  let cover: Blob | null = null
  let description = ''
  let publisher = ''
  let language = ''
  let published = ''

  if (format === 'EPUB' || format === 'MOBI' || format === 'AZW3') {
    const book = await makeBook(file) as any
    const metadata = book?.metadata ?? {}
    title = textValue(metadata.title).trim() || title
    author = getAuthors(metadata) || author
    description = stripHtml(textValue(metadata.description)) || ''
    publisher = textValue(metadata.publisher)
    language = textValue(metadata.language)
    published = textValue(metadata.published)
    try {
      const fetched = await book?.getCover?.()
      if (fetched instanceof Blob) cover = fetched
      else if (fetched instanceof Uint8Array) cover = new Blob([new Uint8Array(fetched).buffer])
    } catch {
      /* cover is optional */
    }
    try {
      book?.destroy?.()
    } catch {
      /* ignore */
    }
  } else if (format === 'PDF') {
    const buffer = await file.arrayBuffer()
    const pdf = await loadPdfDocument(buffer)
    try {
      const info = await extractPdfInfo(pdf)
      title = (textValue(info.title) || title).trim()
      author = (textValue(info.author) || author).trim()
      description = textValue(info.description).trim().slice(0, 500)
      publisher = textValue(info.publisher)
      language = textValue(info.language)
      cover = await renderPdfCover(pdf)
    } finally {
      await pdf.destroy()
    }
  } else if (format === 'TXT') {
    const { text, encoding } = await decodeTextFile(file)
    const header = parseTxtHeader(file.name, text)
    title = header.titleFromContent || title
    author = header.authorFromContent || author
    language = /[\u3400-\u9fff]/.test(text.slice(0, 3000)) ? 'zh-CN' : 'en'
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 240)
    description = `纯文本 · ${encoding}${preview ? ` · ${preview}` : ''}`
  }

  if (!isUsableCover(cover)) {
    cover = await generateCover(title, author, format)
  }

  const now = Date.now()
  return {
    id: uid(),
    title: title || '未命名书籍',
    author: author || '佚名',
    format,
    fileName: file.name,
    fileSize: file.size,
    file,
    cover,
    addedAt: now,
    lastOpenedAt: 0,
    progress: { fraction: 0, updatedAt: now },
    description,
    publisher,
    language,
    published,
  }
}

