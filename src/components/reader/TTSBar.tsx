import { Pause, Play, Settings2, SkipBack, SkipForward, Square } from 'lucide-react'
import type { TTSState } from '../../types'

interface Props {
  state: TTSState
  onToggle: () => void
  onStop: () => void
  onPrev: () => void
  onNext: () => void
  onSettings: () => void
}

export const TTSBar = ({ state, onToggle, onStop, onPrev, onNext, onSettings }: Props) => {
  if (!state.active) return null
  return (
    <div className="tts-bar" role="region" aria-label="语音朗读">
      <div className="tts-bar__badge">
        <span className={`tts-bar__pulse ${state.paused ? 'is-paused' : ''}`} />
        {state.paused ? '已暂停' : '朗读中'}
      </div>
      <div className="tts-bar__text">
        <span className="tts-bar__chapter">{state.chapter}</span>
        <p title={state.text}>{state.text}</p>
      </div>
      <div className="tts-bar__controls">
        <button type="button" className="icon-button icon-button--sm" onClick={onPrev} aria-label="上一句" title="上一句">
          <SkipBack size={15} />
        </button>
        <button type="button" className="tts-bar__play" onClick={onToggle} aria-label={state.paused ? '继续朗读' : '暂停朗读'}>
          {state.paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
        </button>
        <button type="button" className="icon-button icon-button--sm" onClick={onNext} aria-label="下一句" title="下一句">
          <SkipForward size={15} />
        </button>
        <button type="button" className="icon-button icon-button--sm" onClick={onSettings} aria-label="朗读设置" title="朗读设置">
          <Settings2 size={15} />
        </button>
        <button type="button" className="icon-button icon-button--sm" onClick={onStop} aria-label="停止朗读" title="停止朗读">
          <Square size={14} />
        </button>
      </div>
    </div>
  )
}
