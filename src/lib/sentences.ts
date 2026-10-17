export interface Sentence {
  text: string
  range: Range
}

const SKIP_SELECTOR = 'script, style, noscript, rt, rp, [aria-hidden="true"]'
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, pre, td, th, article, section, div, aside, header, footer, main'

const isSkippable = (node: Node) => {
  const parent = node.parentElement
  if (!parent) return true
  return !!parent.closest(SKIP_SELECTOR)
}

const sentenceEnd = /[。！？!?；;…\n]+[”’」』"'）)】》]*|[.](?=\s|$)/g

const hasWords = (text: string) => /[\p{L}\p{N}]/u.test(text)

interface TextNodeInfo {
  node: Text
  start: number
  end: number
}

const collectText = (root: ParentNode | null, geometry = false) => {
  if (!root) return { text: '', nodes: [] as TextNodeInfo[] }
  const ownerDocument = root.ownerDocument ?? (root as Document)
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      if (isSkippable(node)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: TextNodeInfo[] = []
  let text = ''
  let previous: { rect: DOMRect; fontSize: number } | null = null
  let previousBlock: Element | null | undefined
  let node = walker.nextNode() as Text | null
  while (node) {
    const value = node.nodeValue ?? ''
    const parent = node.parentElement
    if (!geometry) {
      const block = parent?.closest(BLOCK_SELECTOR) ?? null
      if (previousBlock !== undefined && block !== previousBlock) text += '\n'
      previousBlock = block
    }
    let current: { rect: DOMRect; fontSize: number } | null = null
    if (geometry && parent) {
      const rect = parent.getBoundingClientRect()
      const fontSize = Number.parseFloat(getComputedStyle(parent).fontSize) || rect.height
      current = { rect, fontSize }
      if (previous && rect.width && previous.rect.width) {
        const sameLine = Math.abs(rect.top - previous.rect.top)
          < Math.max(rect.height, previous.rect.height) * 0.6
        const bigSizeChange = fontSize > previous.fontSize * 1.18
          || fontSize < previous.fontSize * 0.85
        const verticalGap = rect.top - previous.rect.bottom
        const horizontalGap = rect.left - previous.rect.right
        if (bigSizeChange || (!sameLine && verticalGap > Math.max(fontSize, previous.fontSize) * 0.85)) {
          text += '\n'
        } else if (sameLine && horizontalGap > Math.max(fontSize, previous.fontSize) * 0.5) {
          text += ' '
        }
      }
    }
    nodes.push({ node, start: text.length, end: text.length + value.length })
    text += value
    if (current) previous = current
    node = walker.nextNode() as Text | null
  }
  return { text, nodes }
}

const pointAt = (nodes: TextNodeInfo[], offset: number) => {
  let low = 0
  let high = nodes.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const info = nodes[mid]
    if (offset < info.start) high = mid - 1
    else if (offset > info.end) low = mid + 1
    else {
      return {
        node: info.node,
        offset: Math.min(info.node.nodeValue?.length ?? 0, Math.max(0, offset - info.start)),
      }
    }
  }
  const last = nodes[nodes.length - 1]
  return last
    ? { node: last.node, offset: last.node.nodeValue?.length ?? 0 }
    : null
}

const splitSegment = (text: string, start: number, end: number, maxLength: number): Array<[number, number]> => {
  const part = text.slice(start, end)
  if (part.length <= maxLength) return [[start, end]]
  const result: Array<[number, number]> = []
  let cursor = 0
  while (cursor < part.length) {
    let cut = Math.min(part.length, cursor + maxLength)
    if (cut < part.length) {
      const windowText = part.slice(cursor, cut)
      const breakpoints = [...windowText.matchAll(/[，,、；;：:\s]/g)]
        .map(match => match.index ?? -1)
        .filter(index => index > maxLength * 0.4)
      if (breakpoints.length) cut = cursor + breakpoints[breakpoints.length - 1] + 1
    }
    result.push([start + cursor, start + cut])
    cursor = cut
  }
  return result
}

export const extractSentences = (root: Document | HTMLElement, maxLength = 170): Sentence[] => {
  // Documents from a book iframe belong to another realm, so `instanceof` is unreliable.
  const isDocument = root.nodeType === 9
  const documentNode = root as Document
  const container = isDocument ? documentNode.body : root as HTMLElement
  const doc = isDocument ? documentNode : (root as HTMLElement).ownerDocument
  if (!container || !doc) return []
  const geometry = !isDocument && !!container.classList?.contains('textLayer')
  const { text, nodes } = collectText(container, geometry)
  if (!text.trim() || !nodes.length) return []

  const sentences: Sentence[] = []
  let lastIndex = 0
  const pushRange = (start: number, end: number) => {
    for (const [partStart, partEnd] of splitSegment(text, start, end, maxLength)) {
      let from = partStart
      let to = partEnd
      while (from < to && /\s/.test(text[from])) from++
      while (to > from && /\s/.test(text[to - 1])) to--
      if (to - from < 1) continue
      const content = text.slice(from, to)
      if (!hasWords(content)) continue
      const startPoint = pointAt(nodes, from)
      const endPoint = pointAt(nodes, to)
      if (!startPoint || !endPoint) continue
      const range = doc.createRange()
      try {
        range.setStart(startPoint.node, startPoint.offset)
        range.setEnd(endPoint.node, endPoint.offset)
      } catch {
        continue
      }
      if (!range.collapsed) sentences.push({ text: content, range })
    }
  }

  sentenceEnd.lastIndex = 0
  for (const match of text.matchAll(sentenceEnd)) {
    const end = (match.index ?? 0) + match[0].length
    pushRange(lastIndex, end)
    lastIndex = end
  }
  if (lastIndex < text.length) pushRange(lastIndex, text.length)
  return sentences
}

export const findSentenceIndex = (sentences: Sentence[], range: Range | null): number => {
  if (!range) return 0
  try {
    const index = sentences.findIndex(sentence =>
      range.compareBoundaryPoints(Range.START_TO_START, sentence.range) <= 0)
    return index === -1 ? sentences.length - 1 : index
  } catch {
    return 0
  }
}

export const chooseVoice = (language: string, voiceURI: string): SpeechSynthesisVoice | null => {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return null
  if (voiceURI) {
    const selected = voices.find(voice => voice.voiceURI === voiceURI)
    if (selected) return selected
  }
  const normalized = (language || 'zh-CN').toLowerCase()
  const exact = voices.find(voice => voice.lang.toLowerCase() === normalized)
  if (exact) return exact
  const prefix = normalized.slice(0, 2)
  return voices.find(voice => voice.lang.toLowerCase().startsWith(prefix))
    ?? voices.find(voice => voice.default)
    ?? voices[0]
}

export const normalizeLanguage = (language?: unknown) => {
  let raw: unknown = language
  if (Array.isArray(raw)) raw = raw[0]
  else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    raw = record.name ?? record.value ?? Object.values(record)[0]
  }
  if (typeof raw === 'string') {
    const value = raw.trim()
    if (/^[a-zA-Z]{2,3}([_-][a-zA-Z]{2,4})?$/.test(value)) {
      const normalized = value.toLowerCase()
      if (normalized.startsWith('zh')) {
        return normalized.includes('tw') || normalized.includes('hk') ? 'zh-TW' : 'zh-CN'
      }
      return normalized.length === 2 ? normalized : normalized.replace('_', '-')
    }
  }
  return 'zh-CN'
}
