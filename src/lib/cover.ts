import type { BookFormat } from '../types'
import { escapeHtml, hashString } from './utils'

const COVER_PALETTES = [
  ['#566b5b', '#26332a'],
  ['#8a5b43', '#33241d'],
  ['#435d6e', '#1d2b34'],
  ['#7a6a4e', '#2e2820'],
  ['#72505f', '#2c1f27'],
  ['#4d587d', '#1d2436'],
  ['#7d5a3f', '#2c2018'],
  ['#4a6b68', '#1d2f2d'],
  ['#6f5560', '#291e24'],
]

const seededRandom = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const lines: string[] = []
  let current = ''
  for (const char of Array.from(text)) {
    if (char === '\n') {
      if (current) lines.push(current)
      current = ''
      continue
    }
    const next = current + char
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current.trimEnd())
      current = char.trimStart()
    } else {
      current = next
    }
  }
  if (current.trim()) lines.push(current.trim())
  return lines
}

const drawLetterspaced = (
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number, spacing: number,
) => {
  const chars = Array.from(text)
  const widths = chars.map(char => ctx.measureText(char).width)
  const total = widths.reduce((sum, width) => sum + width, 0) + spacing * Math.max(0, chars.length - 1)
  let cursor = x - total / 2
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursor + widths[i] / 2, y)
    cursor += widths[i] + spacing
  }
}

export const generateCover = async (
  title: string,
  author: string,
  format: BookFormat,
  subtitle?: string,
): Promise<Blob> => {
  const width = 600
  const height = 800
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const seed = hashString(`${title}${author}`)
  const palette = COVER_PALETTES[seed % COVER_PALETTES.length]
  const random = seededRandom(seed || 1)

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, palette[0])
  gradient.addColorStop(1, palette[1])
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // soft decorative circles
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = '#f4ead6'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(width * 0.82, height * 0.16, 170 + (seed % 60), 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(width * 0.82, height * 0.16, 118, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.06
  ctx.beginPath()
  ctx.arc(width * 0.08, height * 0.88, 220, 0, Math.PI * 2)
  ctx.fillStyle = '#f4ead6'
  ctx.fill()
  ctx.restore()

  // grain
  ctx.save()
  for (let i = 0; i < 2600; i++) {
    const x = random() * width
    const y = random() * height
    const alpha = 0.015 + random() * 0.045
    ctx.fillStyle = random() > 0.5
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha})`
    ctx.fillRect(x, y, 1.4, 1.4)
  }
  ctx.restore()

  // frame
  ctx.strokeStyle = 'rgba(245, 236, 218, 0.34)'
  ctx.lineWidth = 1
  ctx.strokeRect(34.5, 34.5, width - 69, height - 69)
  ctx.strokeStyle = 'rgba(245, 236, 218, 0.12)'
  ctx.strokeRect(42.5, 42.5, width - 85, height - 85)

  // title
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const ink = '#f4ecdd'
  let fontSize = 92
  let lines: string[] = []
  const maxTitleWidth = width - 150
  for (const candidate of [92, 82, 72, 62, 54, 46]) {
    ctx.font = `600 ${candidate}px "Noto Serif SC", "Songti SC", SimSun, Georgia, serif`
    const wrapped = wrapText(ctx, title, maxTitleWidth)
    if (wrapped.length <= 3 || candidate === 46) {
      fontSize = candidate
      lines = wrapped
      break
    }
  }
  if (lines.length > 4) {
    lines = [lines.slice(0, 3).join(''), `${lines.slice(3).join('')}…`]
  }
  const lineHeight = fontSize * 1.38
  const blockHeight = lines.length * lineHeight
  const titleTop = Math.max(190, 360 - blockHeight / 2)
  ctx.font = `600 ${fontSize}px "Noto Serif SC", "Songti SC", SimSun, Georgia, serif`
  ctx.fillStyle = ink
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 18
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, titleTop + lineHeight * (index + 0.5))
  })
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'

  // accent rule
  const ruleY = titleTop + blockHeight + 34
  ctx.strokeStyle = 'rgba(244, 236, 221, 0.55)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(width / 2 - 30, ruleY)
  ctx.lineTo(width / 2 + 30, ruleY)
  ctx.stroke()

  // author
  if (author) {
    ctx.font = '400 26px "Noto Serif SC", "Songti SC", "Microsoft YaHei", serif'
    ctx.fillStyle = 'rgba(244, 236, 221, 0.8)'
    const authorLines = wrapText(ctx, author, width - 220).slice(0, 2)
    authorLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, ruleY + 62 + index * 36)
    })
  }

  // footer
  ctx.font = '500 15px "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(244, 236, 221, 0.48)'
  drawLetterspaced(ctx, 'MOYUE  LIBRARY', width / 2, height - 94, 4)

  ctx.font = '600 30px "Noto Serif SC", "Songti SC", SimSun, serif'
  ctx.fillStyle = 'rgba(244, 236, 221, 0.72)'
  ctx.strokeStyle = 'rgba(244, 236, 221, 0.4)'
  ctx.lineWidth = 1.4
  ctx.strokeRect(width / 2 - 30, height - 74, 60, 38)
  ctx.fillText('阅', width / 2, height - 53)

  if (subtitle) {
    ctx.font = '400 16px "Noto Sans SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = 'rgba(244, 236, 221, 0.4)'
    ctx.textAlign = 'left'
    ctx.fillText(subtitle, 52, height - 58)
  }

  ctx.font = '500 15px "Noto Sans SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = 'rgba(244, 236, 221, 0.42)'
  ctx.textAlign = 'right'
  ctx.fillText(format, width - 52, height - 58)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('生成封面失败'))
    }, 'image/jpeg', 0.9)
  })
}

export const coverDataUrlFallback = (title: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
      <rect width="100%" height="100%" fill="#3f5046"/>
      <text x="50%" y="50%" fill="#f4ecdd" font-family="serif" font-size="24" text-anchor="middle">${escapeHtml(title.slice(0, 12))}</text>
    </svg>`)}`
