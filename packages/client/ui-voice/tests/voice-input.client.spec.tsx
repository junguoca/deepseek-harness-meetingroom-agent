// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  VoiceInput, isTerminalSpeechError, speechErrorMessage, speechRecognitionConstructor,
} from '../src/client/VoiceInput.tsx'
import type { VoiceInputProps } from '../src/client/VoiceInput.tsx'
import type { SpeechRecognitionEventLike, SpeechRecognitionLike } from '../src/client/VoiceInput.tsx'

/** Every recognition instance ever constructed, in order (fresh instance per segment). */
let recognitions: FakeRecognition[] = []

class FakeRecognition implements SpeechRecognitionLike {
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = 0
  stopped = 0
  aborted = 0
  start(): void { this.started += 1 }
  stop(): void { this.stopped += 1 }
  abort(): void { this.aborted += 1 }
}

function installFake(): void {
  recognitions = []
  const Ctor = class extends FakeRecognition {
    constructor() {
      super()
      recognitions.push(this)
    }
  }
  ;(globalThis as unknown as { SpeechRecognition: new () => FakeRecognition }).SpeechRecognition = Ctor
}

/** The newest recognition instance. */
function latest(): FakeRecognition {
  const rec = recognitions.at(-1)
  if (rec === undefined) throw new Error('no recognition was constructed')
  return rec
}

/** Minimal standard-kit stubs for the input.left seat (typed loosely; the component reads only draft + setDraft). */
function props(overrides: { draft?: string; setDraft?: (text: string) => void } = {}): VoiceInputProps {
  const setDraft = overrides.setDraft ?? (() => {})
  const inputState = {
    draft: overrides.draft ?? '',
    imageIds: [],
    draftRev: 0,
    phase: 'plain',
    occurrences: [],
    queue: [],
  }
  return {
    session: {},
    input: inputState,
    sessionId: 's1',
    useSession: () => { throw new Error('unused') },
    useProjection: () => undefined,
    useSessions: () => { throw new Error('unused') },
    useWorkspaces: () => { throw new Error('unused') },
    useInput: (selector: (state: typeof inputState) => unknown) => selector(inputState),
    inputActions: {
      setDraft,
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
  } as never
}

afterEach(() => {
  cleanup()
  delete (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition
  recognitions = []
})

describe('speech helpers', () => {
  it('detects no constructor without window support', () => {
    expect(speechRecognitionConstructor()).toBeUndefined()
  })

  it('classifies terminal vs recoverable speech errors', () => {
    expect(isTerminalSpeechError('not-allowed')).toBe(true)
    expect(isTerminalSpeechError('audio-capture')).toBe(true)
    expect(isTerminalSpeechError('network')).toBe(false)
    expect(isTerminalSpeechError('no-speech')).toBe(false)
    expect(isTerminalSpeechError('aborted')).toBe(false)
  })

  it('maps terminal speech error codes to product copy', () => {
    expect(speechErrorMessage('not-allowed')).toContain('麦克风权限')
    expect(speechErrorMessage('no-speech')).toBe('')
    expect(speechErrorMessage('network')).toContain('连接中断')
    expect(speechErrorMessage('other')).toBe('')
  })
})

describe('VoiceInput', () => {
  it('renders nothing when speech recognition is unsupported', () => {
    const { container } = render(<VoiceInput {...props()} />)
    expect(container.innerHTML).toBe('')
  })

  it('opens a short-lived zh-CN segment on click', () => {
    installFake()
    render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    expect(latest().lang).toBe('zh-CN')
    expect(latest().continuous).toBe(false)
    expect(latest().interimResults).toBe(true)
    expect(recognitions).toHaveLength(1)
    expect(latest().started).toBe(1)
  })

  it('appends a final transcript to the draft with a separating space', () => {
    installFake()
    const setDraft = vi.fn()
    render(<VoiceInput {...props({ draft: '你好', setDraft })} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    latest().onresult?.({
      resultIndex: 0,
      results: { 0: { isFinal: true, 0: { transcript: '世界' } }, length: 1 },
    })
    expect(setDraft).toHaveBeenCalledWith('你好 世界')
  })

  it('re-opens a FRESH segment after a normal utterance end', () => {
    installFake()
    render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    const first = latest()
    act(() => { first.onend?.() })
    expect(recognitions).toHaveLength(2)
    expect(latest()).not.toBe(first)
    expect(latest().started).toBe(1)
    expect(screen.getByRole('button', { name: '停止语音输入' })).toBeTruthy()
  })

  it('recovers from network drops on fresh instances and only fails after the cap', () => {
    installFake()
    render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    // 3 recoverable drops: each opens a fresh instance, no error surfaced.
    for (let i = 0; i < 3; i += 1) {
      const rec = latest()
      act(() => {
        rec.onerror?.({ error: 'network' })
        rec.onend?.()
      })
    }
    expect(recognitions).toHaveLength(4)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '停止语音输入' })).toBeTruthy()
    // 4th consecutive drop exceeds the cap and settles the session.
    const rec = latest()
    act(() => {
      rec.onerror?.({ error: 'network' })
      rec.onend?.()
    })
    expect(screen.getByRole('alert').textContent).toContain('连接中断')
    expect(screen.queryByRole('button', { name: '停止语音输入' })).toBeNull()
  })

  it('settles immediately on a terminal error', () => {
    installFake()
    render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    act(() => { latest().onerror?.({ error: 'not-allowed' }) })
    expect(screen.getByRole('alert').textContent).toContain('麦克风权限')
    expect(screen.queryByRole('button', { name: '停止语音输入' })).toBeNull()
  })

  it('stops on a second click and ignores the superseded segment end', () => {
    installFake()
    render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '语音输入' }))
    const first = latest()
    fireEvent.click(screen.getByRole('button', { name: '停止语音输入' }))
    expect(first.aborted).toBe(1)
    // The aborted segment's late onend must NOT re-open a new segment.
    act(() => { first.onend?.() })
    expect(recognitions).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '停止语音输入' })).toBeNull()
  })
})
