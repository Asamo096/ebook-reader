import type { CSSProperties } from 'react'
import type { FontFamilyId, ReaderSettings, ReaderThemeId } from '../types'

export interface ReaderTheme {
  id: ReaderThemeId
  label: string
  dark: boolean
  bg: string
  surface: string
  surfaceStrong: string
  text: string
  muted: string
  accent: string
  border: string
  selection: string
  shadow: string
}

export const READER_THEMES: Record<ReaderThemeId, ReaderTheme> = {
  paper: {
    id: 'paper',
    label: '纸白',
    dark: false,
    bg: '#f7f4ed',
    surface: '#fbf9f4',
    surfaceStrong: '#ffffff',
    text: '#2e2a23',
    muted: '#8b8275',
    accent: '#a6542f',
    border: 'rgba(64, 53, 40, 0.13)',
    selection: 'rgba(166, 84, 47, 0.22)',
    shadow: 'rgba(58, 45, 31, 0.12)',
  },
  cream: {
    id: 'cream',
    label: '米黄',
    dark: false,
    bg: '#f0e6cf',
    surface: '#f5eddc',
    surfaceStrong: '#fbf5e8',
    text: '#3b3123',
    muted: '#8a7860',
    accent: '#996a32',
    border: 'rgba(89, 69, 41, 0.16)',
    selection: 'rgba(153, 106, 50, 0.24)',
    shadow: 'rgba(84, 62, 31, 0.15)',
  },
  sage: {
    id: 'sage',
    label: '青瓷',
    dark: false,
    bg: '#e4ece5',
    surface: '#eaf2eb',
    surfaceStrong: '#f4f8f3',
    text: '#29372d',
    muted: '#6d7f70',
    accent: '#4f7358',
    border: 'rgba(50, 75, 56, 0.14)',
    selection: 'rgba(79, 115, 88, 0.22)',
    shadow: 'rgba(44, 68, 50, 0.12)',
  },
  dusk: {
    id: 'dusk',
    label: '暮色',
    dark: true,
    bg: '#26241f',
    surface: '#2d2a24',
    surfaceStrong: '#36322b',
    text: '#ded6c8',
    muted: '#9b9285',
    accent: '#d79a6b',
    border: 'rgba(222, 214, 200, 0.13)',
    selection: 'rgba(215, 154, 107, 0.28)',
    shadow: 'rgba(0, 0, 0, 0.35)',
  },
  night: {
    id: 'night',
    label: '深夜',
    dark: true,
    bg: '#111315',
    surface: '#181b1e',
    surfaceStrong: '#202428',
    text: '#c7c3ba',
    muted: '#85827c',
    accent: '#c58e68',
    border: 'rgba(199, 195, 186, 0.12)',
    selection: 'rgba(197, 142, 104, 0.3)',
    shadow: 'rgba(0, 0, 0, 0.5)',
  },
}

export const FONT_FAMILIES: Record<FontFamilyId, { label: string; stack: string; note: string }> = {
  serif: {
    label: '宋体',
    stack: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif',
    note: '沉稳书卷气',
  },
  sans: {
    label: '黑体',
    stack: '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    note: '清晰现代',
  },
  kai: {
    label: '楷体',
    stack: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif',
    note: '温润手写感',
  },
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'paper',
  fontFamily: 'serif',
  fontSize: 19,
  lineHeight: 1.9,
  pageWidth: 720,
  flow: 'paginated',
  justify: true,
  ttsRate: 1,
  ttsVoiceURI: '',
}

const SETTINGS_KEY = 'moyue.settings.v1'

export const loadSettings = (): ReaderSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      theme: parsed.theme && parsed.theme in READER_THEMES ? parsed.theme : DEFAULT_SETTINGS.theme,
      fontFamily: parsed.fontFamily && parsed.fontFamily in FONT_FAMILIES
        ? parsed.fontFamily : DEFAULT_SETTINGS.fontFamily,
      fontSize: clamp(Number(parsed.fontSize) || DEFAULT_SETTINGS.fontSize, 14, 34),
      lineHeight: clamp(Number(parsed.lineHeight) || DEFAULT_SETTINGS.lineHeight, 1.2, 2.6),
      pageWidth: clamp(Number(parsed.pageWidth) || DEFAULT_SETTINGS.pageWidth, 480, 1000),
      ttsRate: clamp(Number(parsed.ttsRate) || 1, 0.5, 2),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const saveSettings = (settings: ReaderSettings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    /* storage may be unavailable */
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export const getThemeVars = (theme: ReaderTheme) => ({
  '--reader-bg': theme.bg,
  '--reader-surface': theme.surface,
  '--reader-surface-strong': theme.surfaceStrong,
  '--reader-text': theme.text,
  '--reader-muted': theme.muted,
  '--reader-accent': theme.accent,
  '--reader-border': theme.border,
  '--reader-selection': theme.selection,
  '--reader-shadow': theme.shadow,
}) as CSSProperties
