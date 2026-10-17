import type { BookFormat, ReaderSettings } from '../types'
import { FONT_FAMILIES, READER_THEMES } from './themes'

const txtExtras = `
  .txt-book p { margin: 0 0 0.9em !important; text-indent: 2em !important; }
  .txt-book p.txt-dialog { text-indent: 0 !important; }
  .txt-book p.txt-divider {
    text-indent: 0 !important; text-align: center !important;
    letter-spacing: 0.35em; opacity: 0.7; margin: 1.6em 0 !important;
  }
  .txt-book .txt-chapter-title {
    font-size: 1.5em !important; font-weight: 600 !important;
    margin: 0.3em 0 1.4em !important; text-align: center !important;
    text-indent: 0 !important; letter-spacing: 0.06em;
  }
  .txt-book .txt-book-title {
    font-size: 1.9em !important; font-weight: 600 !important;
    margin: 0.6em 0 1.6em !important; text-align: center !important;
    text-indent: 0 !important;
  }
`

export const buildFoliateStyles = (
  settings: ReaderSettings,
  format: BookFormat,
  isFixedLayout = false,
): [string, string] => {
  const theme = READER_THEMES[settings.theme]
  const font = FONT_FAMILIES[settings.fontFamily]

  const before = `
    :root {
      color-scheme: ${theme.dark ? 'dark' : 'light'};
      --overlayer-highlight-opacity: ${theme.dark ? '0.34' : '0.38'};
      --overlayer-highlight-blend-mode: ${theme.dark ? 'normal' : 'multiply'};
    }
    html, body {
      background-color: ${theme.bg} !important;
      color: ${theme.text};
    }
    body { overflow-wrap: break-word; }
    a:link, a:visited { color: ${theme.accent}; }
    ::selection { background: ${theme.selection} !important; }
  `

  if (isFixedLayout) {
    return [before, `
      html, body { background-color: ${theme.bg} !important; }
      ::selection { background: ${theme.selection} !important; }
    `]
  }

  const after = `
    html, body {
      background-color: ${theme.bg} !important;
      color: ${theme.text} !important;
    }
    body, body *:not(pre):not(code):not(kbd):not(samp):not(svg):not(path) {
      font-family: ${font.stack} !important;
    }
    body {
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      text-align: initial;
      letter-spacing: 0.005em;
    }
    p, li, blockquote, dd, figcaption {
      font-size: 1em !important;
      line-height: ${settings.lineHeight} !important;
      text-align: ${settings.justify ? 'justify' : 'start'} !important;
      text-justify: inter-ideograph;
      -webkit-hyphens: auto;
      hyphens: auto;
    }
    [align="left"] { text-align: left !important; }
    [align="right"] { text-align: right !important; }
    [align="center"] { text-align: center !important; }
    h1, h2, h3, h4, h5, h6 {
      font-family: ${FONT_FAMILIES.serif.stack} !important;
      line-height: 1.45 !important;
      color: ${theme.text} !important;
    }
    a:link, a:visited { color: ${theme.accent}; }
    hr { border-color: ${theme.border}; }
    img, svg, video {
      max-width: 100% !important;
      height: auto !important;
    }
    table { max-width: 100% !important; }
    pre { white-space: pre-wrap !important; }
    mark {
      color: inherit;
      background: ${theme.selection};
    }
    ${theme.dark ? 'img { filter: brightness(0.88) contrast(1.03); }' : ''}
    ${format === 'TXT' ? txtExtras : ''}
  `

  return [before, after]
}
