/**
 * The composer mic toggle. One button, two states: idle (mic glyph) and
 * listening (red, pulsing). Clicking starts segmented Web Speech API
 * recognition (zh-CN): one short-lived recognition per utterance
 * (continuous=false), re-opened with a fresh instance the moment each
 * utterance ends, so the stream never rides a single long-lived connection
 * (Edge/Chrome backend connections are routinely dropped by server timeout or
 * NAT idle timeout). Each final transcript chunk is appended to the draft
 * through inputActions.setDraft; a second click stops. Unsupported browsers
 * render nothing, and terminal speech errors surface as a short inline
 * message while transient network drops retry silently.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './VoiceInput.module.css'

/** Minimal structural face of the browser SpeechRecognition API this control drives. */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Structural result list of one recognition event. */
export interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: { isFinal: boolean; [index: number]: { transcript: string } }
  }
}

/** Structural speech-error event. */
export interface SpeechRecognitionErrorLike {
  error: string
}

/** Browser vendor-prefixed constructor accessor. */
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

/** Feature-detect the browser speech-recognition constructor. */
export function speechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/**
 * Whether a speech error ends the whole listening session. Recoverable codes
 * ('network', 'no-speech', 'aborted') just move on to the next segment.
 * @param code - browser speech-error code.
 */
export function isTerminalSpeechError(code: string): boolean {
  return code === 'not-allowed'
    || code === 'service-not-allowed'
    || code === 'audio-capture'
    || code === 'language-not-supported'
}

/** Map a terminal speech-error code to product copy (empty for recoverable codes). */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed': return '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问'
    case 'service-not-allowed': return '浏览器未开启语音识别服务'
    case 'audio-capture': return '未找到可用的麦克风设备'
    case 'language-not-supported': return '当前语言不支持语音识别'
    case 'network': return '语音识别服务连接中断，请检查网络后重试'
    default: return ''
  }
}

export type VoiceInputProps = PropsRuntime<'conversation.input.left'>

/** The composer mic toggle registered into conversation.input.left. */
export function VoiceInput({ useInput, inputActions }: VoiceInputProps) {
  const draft = useInput(state => state.draft)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Monotonic listening-session token: stop() bumps it so every in-flight
  // callback of a superseded session becomes a no-op (a late onend/onerror of
  // an old segment must never stop or restart a newer session).
  const sessionRef = useRef(0)
  // Consecutive network-drop count within one listening session; a successful
  // final transcript resets it. Above the cap the session fails loudly instead
  // of silently looping on a dead connection.
  const networkDropsRef = useRef(0)

  // Feature detection is stable across renders; the button simply never
  // renders in browsers without speech recognition.
  const supported = speechRecognitionConstructor() !== undefined

  const stop = useCallback(() => {
    sessionRef.current += 1
    recognitionRef.current?.abort()
    recognitionRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = speechRecognitionConstructor()
    if (Ctor === undefined) return
    const session = sessionRef.current + 1
    sessionRef.current = session
    networkDropsRef.current = 0
    setListening(true)
    setError(null)
    setInterim('')

    // Open one short-lived recognition segment for this session. Called once
    // at start and again after each utterance/error ends, so a dropped backend
    // connection is always replaced by a FRESH instance rather than a reused
    // (possibly wedged) one.
    const openSegment = (): void => {
      if (session !== sessionRef.current) return
      const recognition = new Ctor()
      recognition.lang = 'zh-CN'
      recognition.continuous = false
      recognition.interimResults = true
      // Per-segment error code, consumed by onend (the browser fires onerror
      // then onend for terminal and transient failures alike).
      let failure: string | null = null

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (session !== sessionRef.current) return
        let nextFinal = ''
        let nextInterim = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          if (result === undefined) continue
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) nextFinal += transcript
          else nextInterim += transcript
        }
        if (nextInterim !== '') setInterim(nextInterim)
        if (nextFinal !== '') {
          // Append only THIS event's final increment, not an accumulated
          // buffer: a re-emitted final result would otherwise re-append the
          // whole history. Write draftRef synchronously so a later onresult in
          // the same tick reads the just-appended draft.
          setInterim('')
          networkDropsRef.current = 0
          const current = draftRef.current
          const separator = current === '' || /\s$/.test(current) ? '' : ' '
          const next = current + separator + nextFinal
          draftRef.current = next
          inputActions.setDraft(next)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorLike) => {
        if (session !== sessionRef.current) return
        // Terminal errors settle the whole session. Recoverable codes are
        // recorded and handled in onend, which always follows onerror.
        if (isTerminalSpeechError(event.error)) {
          sessionRef.current += 1
          recognitionRef.current = null
          setListening(false)
          setInterim('')
          setError(speechErrorMessage(event.error))
          return
        }
        failure = event.error
      }

      recognition.onend = () => {
        if (session !== sessionRef.current) return
        if (failure === 'network') {
          networkDropsRef.current += 1
          if (networkDropsRef.current > 3) {
            sessionRef.current += 1
            recognitionRef.current = null
            setListening(false)
            setInterim('')
            setError(speechErrorMessage('network'))
            return
          }
        }
        // Normal utterance end, no-speech, aborted stop, or a recoverable
        // network drop: keep the session alive by opening a fresh segment.
        openSegment()
      }

      recognitionRef.current = recognition
      recognition.start()
    }

    openSegment()
  }, [inputActions])

  // Teardown: abort the live stream so a navigation cannot keep the mic open.
  useEffect(() => () => { recognitionRef.current?.abort() }, [])

  if (!supported) return null

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={listening ? css.micListening : css.mic}
        aria-label={listening ? '停止语音输入' : '语音输入'}
        aria-pressed={listening}
        title={listening ? '正在聆听，点击停止' : '点击开始语音输入'}
        onClick={() => { if (listening) stop(); else start() }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
          {listening ? (
            <rect x="5" y="5" width="6" height="6" rx="1.5" fill="currentColor" />
          ) : (
            <>
              <rect x="6" y="1.5" width="4" height="7" rx="2" fill="currentColor" />
              <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>
      </button>
      {listening && <span className={css.hint}>{interim !== '' ? interim : '聆听中…'}</span>}
      {error !== null && <span className={css.error} role="alert">{error}</span>}
    </span>
  )
}
