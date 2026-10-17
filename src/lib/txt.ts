import { escapeHtml } from './utils'

type ParsedText = { text: string; encoding: string }

const decoder = (label: string, bytes: Uint8Array, fatal = false) =>
  new TextDecoder(label, { fatal }).decode(bytes)

export const decodeTextFile = async (blob: Blob): Promise<ParsedText> => {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decoder('utf-8', bytes.subarray(3)), encoding: 'UTF-8 BOM' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decoder('utf-16le', bytes.subarray(2)), encoding: 'UTF-16 LE' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decoder('utf-16be', bytes.subarray(2)), encoding: 'UTF-16 BE' }
  }

  try {
    const text = decoder('utf-8', bytes, true)
    const badChars = (text.match(/\uFFFD/g) || []).length
    if (badChars / Math.max(1, text.length) < 0.002) {
      return { text: text.replace(/^\uFEFF/, ''), encoding: 'UTF-8' }
    }
  } catch {
    /* try GB18030 below */
  }

  try {
    const text = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
    const badChars = (text.match(/\uFFFD/g) || []).length
    if (badChars / Math.max(1, text.length) < 0.01) {
      return { text: text.replace(/^\uFEFF/, ''), encoding: 'GB18030' }
    }
  } catch {
    /* fall back to permissive UTF-8 */
  }

  return {
    text: new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, ''),
    encoding: 'UTF-8 (容错)',
  }
}

const HEADING_PATTERNS = [
  /^(?:正文\s*)?第[0-9零〇一二两三四五六七八九十百千万亿]+[章节回卷集部篇](?:[\s、：:.-]|$).{0,40}$/,
  /^(?:序章|序言|序|楔子|引子|前言|后记|尾声|终章|番外篇|番外|自序)(?:[\s、：:.-].{0,40})?$/,
  /^Chapter\s+[0-9IVXLC]+(?:[\s.:：-].{0,60})?$/i,
  /^(?:卷[一二三四五六七八九十百0-9]+|上部|中部|下部|上卷|中卷|下卷)(?:[\s、：:.-].{0,40})?$/,
]

export interface ChapterData {
  title: string
  html: string
  charCount: number
}

const isHeading = (line: string) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 48) return false
  return HEADING_PATTERNS.some(pattern => pattern.test(trimmed))
}

const splitLongText = (text: string, limit = 60000): string[] => {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit)
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit)
    if (cut < limit * 0.5) cut = limit
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.trim()) chunks.push(rest)
  return chunks
}

const paragraphsToHtml = (text: string) => {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  const blocks = normalized.split(/\n{2,}/)
  const html: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const nonEmpty = lines.filter(line => line.trim())
    if (!nonEmpty.length) continue
    for (const line of lines) {
      const value = line.trim()
      if (!value) continue
      const isDialog = /^[「“"'『]/.test(value)
      const isCentered = /^[•·※—=-]{3,}$/.test(value)
      if (isCentered) {
        html.push('<p class="txt-divider">＊　＊　＊</p>')
      } else {
        html.push(`<p${isDialog ? ' class="txt-dialog"' : ''}>${escapeHtml(value)}</p>`)
      }
    }
  }
  return html.join('\n')
}

export const parseTxtHeader = (fileName: string, text: string) => {
  const head = text.slice(0, 4000)
  const titleLine = /^\s*(?:书\s*名|题\s*名)\s*[:：]\s*(.+)$/m.exec(head)?.[1]?.trim()
  const authorLine = /^\s*作\s*者\s*[:：]\s*(.+)$/m.exec(head)?.[1]?.trim()
  const quoted = /《([^》\n]{1,60})》/.exec(head.slice(0, 300))
  return {
    titleFromContent: titleLine || quoted?.[1]?.trim() || '',
    authorFromContent: authorLine || '',
  }
}

const stripLeadingHeader = (text: string, title: string, author?: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  let removed = 0
  while (index < lines.length && removed < 4) {
    const line = lines[index].trim()
    if (!line) {
      index++
      continue
    }
    const plain = line.replace(/[《》]/g, '').trim()
    const isTitle = plain === title
      || /^书\s*名\s*[:：]/.test(line) && line.includes(title)
    const isAuthor = !!author && (
      plain === author
      || /^作\s*者\s*[:：]/.test(line) && line.includes(author)
    )
    if (isTitle || isAuthor) {
      index++
      removed++
      continue
    }
    break
  }
  const rest = lines.slice(index).join('\n').trim()
  return rest || text.trim()
}

export const splitTxtIntoChapters = (
  rawText: string,
  fallbackTitle = '正文',
  author = '',
): ChapterData[] => {
  const text = rawText.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const lines = text.split('\n')
  const headings: Array<{ line: number; title: string }> = []

  for (let i = 0; i < lines.length; i++) {
    if (isHeading(lines[i])) {
      const lookahead = lines.slice(i + 1, i + 5).filter(line => line.trim()).length
      if (lookahead > 0) headings.push({ line: i, title: lines[i].trim() })
    }
  }

  const chapters: ChapterData[] = []
  const pushChapter = (title: string, content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    for (const [index, chunk] of splitLongText(trimmed).entries()) {
      const partTitle = index === 0 ? title : `${title}（续）`
      chapters.push({
        title: partTitle,
        html: `<h2 class="txt-chapter-title">${escapeHtml(title)}</h2>\n${paragraphsToHtml(chunk)}`,
        charCount: chunk.length,
      })
    }
  }

  if (headings.length >= 2) {
    const preface = lines.slice(0, headings[0].line).join('\n').trim()
    if (preface.length > 80) pushChapter('卷首', preface)
    for (const [index, heading] of headings.entries()) {
      const end = headings[index + 1]?.line ?? lines.length
      const content = lines.slice(heading.line + 1, end).join('\n')
      pushChapter(heading.title, content)
    }
  } else if (headings.length === 1) {
    const heading = headings[0]
    const before = lines.slice(0, heading.line).join('\n').trim()
    const after = lines.slice(heading.line + 1).join('\n').trim()
    if (before.length > 80) pushChapter('卷首', before)
    pushChapter(heading.title, after)
  } else {
    const body = stripLeadingHeader(text, fallbackTitle, author)
    const chunks = splitLongText(body, 30000)
    if (chunks.length === 1) {
      chapters.push({
        title: fallbackTitle,
        html: paragraphsToHtml(chunks[0]),
        charCount: chunks[0].length,
      })
    } else {
      for (const [index, chunk] of chunks.entries()) {
        pushChapter(`第 ${index + 1} 节`, chunk)
      }
    }
  }

  return chapters.length ? chapters : [{
    title: fallbackTitle,
    html: paragraphsToHtml(stripLeadingHeader(text, fallbackTitle, author)),
    charCount: text.length,
  }]
}

const BASE_STYLE = `
  html, body { margin: 0; padding: 0; }
  body.txt-book { padding: 0; }
  .txt-chapter-title { margin: 0.2em 0 1.1em; font-weight: 600; text-align: center; letter-spacing: 0.04em; }
  .txt-book-title { margin: 0.3em 0 1.4em; text-align: center; font-weight: 600; }
  .txt-book p { margin: 0 0 0.9em; text-indent: 2em; }
  .txt-book p.txt-dialog { text-indent: 0; }
  .txt-book p.txt-divider { text-indent: 0; text-align: center; letter-spacing: 0.4em; opacity: 0.65; }
`

export interface TxtBookData {
  title: string
  author: string
  chapters: ChapterData[]
}

export class TxtBook {
  metadata: { title: string; author?: string; language: string }
  toc: Array<{ label: string; href: string; subitems?: null }>
  sections: Array<{
    id: number
    size: number
    linear: string
    load: () => Promise<string>
    createDocument: () => Promise<Document>
    unload?: () => void
  }>
  dir = 'ltr'
  rendition = { layout: 'reflowable' }
  #urls = new Map<number, string>()

  constructor(data: TxtBookData) {
    this.metadata = {
      title: data.title,
      author: data.author || undefined,
      language: 'zh-CN',
    }
    this.toc = data.chapters.map((chapter, index) => ({
      label: chapter.title,
      href: `txt:${index}`,
    }))
    this.sections = data.chapters.map((chapter, index) => {
      const html = this.#makeDocument(chapter)
      const byteSize = new Blob([html]).size
      return {
        id: index,
        size: byteSize,
        linear: 'yes',
        load: async () => this.#getUrl(index, html),
        createDocument: async () => new DOMParser().parseFromString(html, 'text/html'),
      }
    })
  }

  #makeDocument(chapter: ChapterData) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${escapeHtml(chapter.title)}</title><style>${BASE_STYLE}</style></head>
<body class="txt-book">
${chapter.html}
</body>
</html>`
  }

  #getUrl(index: number, html: string) {
    let url = this.#urls.get(index)
    if (!url) {
      url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      this.#urls.set(index, url)
    }
    return url
  }

  resolveHref(href: string) {
    const match = /^txt:(\d+)/.exec(href)
    if (match) return { index: Number(match[1]) }
    return { index: 0 }
  }

  splitTOCHref(href: string) {
    const match = /^txt:(\d+)/.exec(href)
    return [Number(match?.[1] ?? 0), null]
  }

  getTOCFragment(doc: Document) {
    return doc.body.querySelector('h1, h2') ?? doc.body
  }

  isExternal(uri: string) {
    return /^(https?:|mailto:|tel:)/i.test(uri)
  }

  destroy() {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
  }
}
