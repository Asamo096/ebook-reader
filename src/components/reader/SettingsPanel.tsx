import {
  AlignJustify, Columns2, Keyboard, Minus, Plus, RotateCcw, Rows3,
  Settings2, Volume2, X, ZoomIn,
} from 'lucide-react'
import type { FontFamilyId, ReaderSettings, ReaderThemeId } from '../../types'
import { DEFAULT_SETTINGS, FONT_FAMILIES, READER_THEMES } from '../../lib/themes'

interface Props {
  open: boolean
  settings: ReaderSettings
  isPdf: boolean
  voices: SpeechSynthesisVoice[]
  pdfZoom: number
  onPdfZoom: (zoom: number) => void
  onChange: (settings: ReaderSettings) => void
  onClose: () => void
  onReset: () => void
  onShowShortcuts: () => void
}

const PAGE_WIDTHS: Array<{ value: number; label: string }> = [
  { value: 560, label: '窄' },
  { value: 720, label: '适中' },
  { value: 880, label: '宽' },
]

export const SettingsPanel = ({
  open, settings, isPdf, voices, pdfZoom, onPdfZoom,
  onChange, onClose, onReset, onShowShortcuts,
}: Props) => {
  if (!open) return null
  const update = (patch: Partial<ReaderSettings>) => onChange({ ...settings, ...patch })
  const sortedVoices = [...voices].sort((a, b) => {
    const az = a.lang.toLowerCase().startsWith('zh') ? 0 : 1
    const bz = b.lang.toLowerCase().startsWith('zh') ? 0 : 1
    return az - bz || a.name.localeCompare(b.name)
  })

  return (
    <aside className="reader-drawer reader-drawer--right settings-panel" aria-label="阅读设置">
      <div className="drawer-head drawer-head--simple">
        <div>
          <span className="drawer-eyebrow">APPEARANCE</span>
          <h2>阅读设置</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置">
          <X size={17} />
        </button>
      </div>

      <div className="settings-body">
        <section className="settings-section">
          <div className="settings-label">
            <span>阅读主题</span>
            <small>{READER_THEMES[settings.theme].label}</small>
          </div>
          <div className="theme-grid">
            {(Object.keys(READER_THEMES) as ReaderThemeId[]).map(id => {
              const theme = READER_THEMES[id]
              return (
                <button
                  key={id}
                  type="button"
                  className={`theme-option ${settings.theme === id ? 'is-active' : ''}`}
                  onClick={() => update({ theme: id })}
                  aria-label={theme.label}
                >
                  <span
                    className="theme-option__preview"
                    style={{ background: theme.bg, color: theme.text, borderColor: theme.border }}
                  >
                    <em style={{ color: theme.accent }}>Aa</em>
                    <i />
                    <i />
                  </span>
                  <span>{theme.label}</span>
                </button>
              )
            })}
          </div>
        </section>

        {!isPdf && (
          <>
            <section className="settings-section">
              <div className="settings-label"><span>字体</span></div>
              <div className="segmented segmented--three">
                {(Object.keys(FONT_FAMILIES) as FontFamilyId[]).map(id => (
                  <button
                    key={id}
                    type="button"
                    className={settings.fontFamily === id ? 'is-active' : ''}
                    onClick={() => update({ fontFamily: id })}
                  >
                    <b style={{ fontFamily: FONT_FAMILIES[id].stack }}>字</b>
                    <span>{FONT_FAMILIES[id].label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-label">
                <span>字号</span>
                <small>{settings.fontSize} px</small>
              </div>
              <div className="stepper-row">
                <button
                  type="button"
                  className="stepper-button"
                  onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
                  aria-label="减小字号"
                >
                  <Minus size={14} />
                </button>
                <input
                  type="range"
                  min={14}
                  max={34}
                  step={1}
                  value={settings.fontSize}
                  onChange={event => update({ fontSize: Number(event.target.value) })}
                  aria-label="字号"
                />
                <button
                  type="button"
                  className="stepper-button"
                  onClick={() => update({ fontSize: Math.min(34, settings.fontSize + 1) })}
                  aria-label="增大字号"
                >
                  <Plus size={14} />
                </button>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-label">
                <span>行距</span>
                <small>{settings.lineHeight.toFixed(1)}</small>
              </div>
              <input
                type="range"
                min={1.2}
                max={2.6}
                step={0.1}
                value={settings.lineHeight}
                onChange={event => update({ lineHeight: Number(event.target.value) })}
                aria-label="行距"
              />
            </section>

            <section className="settings-section">
              <div className="settings-label"><span>版心宽度</span></div>
              <div className="segmented segmented--three">
                {PAGE_WIDTHS.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={Math.abs(settings.pageWidth - item.value) < 80 ? 'is-active' : ''}
                    onClick={() => update({ pageWidth: item.value })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-label"><span>翻页方式</span></div>
              <div className="layout-options">
                <button
                  type="button"
                  className={settings.flow === 'paginated' ? 'is-active' : ''}
                  onClick={() => update({ flow: 'paginated' })}
                >
                  <Columns2 size={18} />
                  <strong>分页</strong>
                  <small>左右翻页，专注一屏</small>
                </button>
                <button
                  type="button"
                  className={settings.flow === 'scrolled' ? 'is-active' : ''}
                  onClick={() => update({ flow: 'scrolled' })}
                >
                  <Rows3 size={18} />
                  <strong>滚动</strong>
                  <small>连续向下，随手滑动</small>
                </button>
              </div>
            </section>

            <section className="settings-section settings-section--row">
              <div className="settings-label">
                <span><AlignJustify size={15} /> 两端对齐</span>
                <small>让段落边缘更整齐</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.justify}
                className={`switch ${settings.justify ? 'is-on' : ''}`}
                onClick={() => update({ justify: !settings.justify })}
                aria-label="两端对齐"
              >
                <span />
              </button>
            </section>
          </>
        )}

        {isPdf && (
          <section className="settings-section">
            <div className="settings-label">
              <span><ZoomIn size={15} /> PDF 缩放</span>
              <small>{Math.round(pdfZoom * 100)}%</small>
            </div>
            <div className="stepper-row">
              <button
                type="button"
                className="stepper-button"
                onClick={() => onPdfZoom(Math.max(0.6, Math.round((pdfZoom - 0.1) * 10) / 10))}
                aria-label="缩小 PDF"
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={0.6}
                max={2.5}
                step={0.1}
                value={pdfZoom}
                onChange={event => onPdfZoom(Number(event.target.value))}
                aria-label="PDF 缩放"
              />
              <button
                type="button"
                className="stepper-button"
                onClick={() => onPdfZoom(Math.min(2.5, Math.round((pdfZoom + 0.1) * 10) / 10))}
                aria-label="放大 PDF"
              >
                <Plus size={14} />
              </button>
            </div>
            <button type="button" className="text-link settings-inline-link" onClick={() => onPdfZoom(1)}>
              恢复适应宽度
            </button>
            <p className="settings-note">PDF 会保留原始版式，字号与字体设置不适用于它。</p>
          </section>
        )}

        <section className="settings-section">
          <div className="settings-label">
            <span><Volume2 size={15} /> 朗读</span>
            <small>{settings.ttsRate.toFixed(1)}×</small>
          </div>
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.1}
            value={settings.ttsRate}
            onChange={event => update({ ttsRate: Number(event.target.value) })}
            aria-label="朗读语速"
          />
          <label className="voice-select">
            <span>声音</span>
            <select
              value={settings.ttsVoiceURI}
              onChange={event => update({ ttsVoiceURI: event.target.value })}
            >
              <option value="">跟随系统默认</option>
              {sortedVoices.map(voice => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} · {voice.lang}
                </option>
              ))}
            </select>
          </label>
          {!voices.length && (
            <p className="settings-note">没有检测到额外的系统语音，将使用浏览器默认声音。</p>
          )}
        </section>

        <div className="settings-footer">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            <RotateCcw size={14} /> 恢复默认
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onShowShortcuts}>
            <Keyboard size={14} /> 快捷键
          </button>
          <span className="settings-footer__badge"><Settings2 size={13} /> 即时生效</span>
        </div>
      </div>
    </aside>
  )
}

export const resetReaderSettings = (current: ReaderSettings): ReaderSettings => ({
  ...DEFAULT_SETTINGS,
  ttsVoiceURI: current.ttsVoiceURI,
})
