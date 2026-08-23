import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutline16, IconListPenOutline16, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createMeetingStore } from './store.ts'
import css from './MeetingPanel.module.css'

export type MeetingPanelProps = PropsRuntime<'shell.overlay'> & PropsStore<ReturnType<typeof createMeetingStore>>
export type MeetingTriggerProps = PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createMeetingStore>>

type MeetingStatus = 'loading' | 'recording' | 'stopping' | 'stopped' | 'summarizing' | 'completed' | 'failed'
type Segment = { sequence: number; startMs: number; endMs: number; text: string }
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } }
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function speechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}
type Summary = { fromMs: number; toMs: number; markdown: string; createdAt: number }
type Ledger = {
  meetingId: string
  archivePath: string
  sessionId: string
  status: MeetingStatus
  startedAt: number
  endedAt?: number
  segments: Segment[]
  summaries: Summary[]
  minutes: string
  audioParts: number
  error: string
}

async function fetchWithRetry(path: string, init: RequestInit, attempts = 4): Promise<Response> {
  let failure: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(path, init)
      if (response.ok || response.status < 500) return response
      failure = new Error(`会议服务暂时不可用（${response.status}）`)
    } catch (caught) {
      failure = caught
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => { window.setTimeout(resolve, 500 * 2 ** attempt) })
  }
  throw failure instanceof Error ? failure : new Error(String(failure))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  const response = await fetchWithRetry(path, { ...init, headers })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `会议服务请求失败（${response.status}）`)
  return result
}

function clockMinute(_startedAt: number, offsetMs: number): number {
  return Math.floor(Math.max(0, offsetMs) / 60_000)
}

function offset(startedAt: number, minuteOffsetMs: number): string {
  const date = new Date(startedAt + Math.max(0, minuteOffsetMs))
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function minuteTranscript(startedAt: number, segments: readonly Segment[]): string {
  const grouped: Segment[] = []
  for (const segment of segments) {
    const minute = clockMinute(startedAt, segment.startMs)
    const minuteOffsetMs = minute * 60_000
    const current = grouped.at(-1)
    if (current?.startMs === minuteOffsetMs) current.text = `${current.text}${segment.text}`
    else grouped.push({ ...segment, startMs: minuteOffsetMs })
  }
  return grouped.map(segment => `[${offset(startedAt, segment.startMs)}] ${segment.text}`).join('\n')
}

function statusText(status: MeetingStatus | undefined): string {
  if (status === 'loading') return '正在请求浏览器麦克风…'
  if (status === 'recording') return '正在录音并实时转写'
  if (status === 'summarizing') return '正在生成完整纪要…'
  if (status === 'stopping') return '正在停止录音…'
  if (status === 'stopped') return '录音已停止，可生成纪要'
  if (status === 'completed') return '会议已完成'
  if (status === 'failed') return '会议运行失败'
  return '尚未开始'
}

export function MeetingTrigger({ wide, actions }: MeetingTriggerProps) {
  return <button type="button" className={css.trigger} aria-label="会议纪要" title="会议纪要" onClick={() => { actions.open() }}>
    <IconListPenOutline16 size={wide ? 16 : 18} />{wide && <span className={css.triggerLabel}>会议纪要</span>}
  </button>
}

export function MeetingPanel({ useStore, useSessions, actions }: MeetingPanelProps) {
  const state = useStore(value => value)
  const sessions = useSessions(value => value)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [interim, setInterim] = useState('')
  const [capturing, setCapturing] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef(0)
  const sequenceRef = useRef(0)
  const startedAtRef = useRef(0)
  const audioPartRef = useRef(0)
  const audioUploadRef = useRef<Promise<void>>(Promise.resolve())
  const transcriptUploadRef = useRef<Promise<void>>(Promise.resolve())
  const recorderTimerRef = useRef<number | null>(null)
  const transcript = useMemo(() => ledger === null ? '' : minuteTranscript(ledger.startedAt, ledger.segments), [ledger])

  useEffect(() => {
    if (!state.open) return
    let cancelled = false
    const poll = async () => {
      try {
        const current = await request<Ledger | null>('/api/meeting-runtime/active?meetingId=' + encodeURIComponent(state.meetingId.trim()))
        if (!cancelled) {
          if (current !== null) { setLedger(current); if (state.meetingId !== current.meetingId) actions.setMeetingId(current.meetingId) }
          else if (state.meetingId.trim() !== '') {
            try {
              const archived = await request<Ledger>('/api/meeting-runtime/meetings/' + encodeURIComponent(state.meetingId.trim()))
              setLedger(archived)
            } catch {
              setLedger(null)
            }
          }
          setError('')
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      }
      if (!cancelled) window.setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    return () => { cancelled = true }
  }, [state.open, state.meetingId])

  const stopBrowserCapture = useCallback(() => {
    sessionRef.current += 1
    recognitionRef.current?.abort()
    recognitionRef.current = null
    if (recorderTimerRef.current !== null) window.clearTimeout(recorderTimerRef.current)
    recorderTimerRef.current = null
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder?.state !== 'inactive') recorder?.stop()
    streamRef.current?.getTracks().forEach((track) => { track.stop() })
    streamRef.current = null
    setInterim('')
    setCapturing(false)
  }, [])

  const startBrowserCapture = useCallback(async (meetingId: string, startedAt: number, nextSequence: number, audioParts: number) => {
    const Ctor = speechRecognitionConstructor()
    if (Ctor === undefined) throw new Error('当前浏览器不支持 Web Speech API')
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream
    setCapturing(true)
    startedAtRef.current = startedAt
    sequenceRef.current = nextSequence
    audioPartRef.current = audioParts
    const session = sessionRef.current + 1
    sessionRef.current = session

    const openRecorder = (): void => {
      if (session !== sessionRef.current) return
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.onstop = () => {
        if (chunks.length > 0) {
          const part = audioPartRef.current + 1
          audioPartRef.current = part
          const extension = recorder.mimeType.includes('ogg') ? 'ogg' : 'webm'
          const body = new Blob(chunks, { type: recorder.mimeType || 'application/octet-stream' })
          audioUploadRef.current = audioUploadRef.current.then(async () => {
            const response = await fetchWithRetry('/api/meeting-runtime/audio?meetingId=' + encodeURIComponent(meetingId) + '&part=' + String(part) + '&extension=' + extension, { method: 'POST', headers: { 'content-type': body.type }, body })
            if (!response.ok) {
              const result = await response.json() as { error?: string }
              throw new Error(result.error ?? `音频分片上传失败（${response.status}）`)
            }
          }).catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : String(caught)) })
        }
        if (session === sessionRef.current) openRecorder()
      }
      recorder.start()
      recorderTimerRef.current = window.setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, 300_000)
    }
    openRecorder()

    const openSegment = (): void => {
      if (session !== sessionRef.current) return
      const recognition = new Ctor()
      recognition.lang = 'zh-CN'
      recognition.continuous = false
      recognition.interimResults = true
      let terminal = false
      recognition.onresult = (event) => {
        if (session !== sessionRef.current) return
        let finalText = ''
        let interimText = ''
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          if (result === undefined) continue
          if (result.isFinal) finalText += result[0]?.transcript ?? ''
          else interimText += result[0]?.transcript ?? ''
        }
        setInterim(interimText)
        if (finalText.trim() !== '') {
          setInterim('')
          const sequence = sequenceRef.current
          sequenceRef.current += 1
          const endMs = Math.max(0, Date.now() - startedAtRef.current)
          const startMs = Math.max(0, endMs - 1_000)
          transcriptUploadRef.current = transcriptUploadRef.current.then(async () => {
            const updated = await request<Ledger>('/api/meeting-runtime/transcript', { method: 'POST', body: JSON.stringify({ meetingId, sequence, startMs, endMs, text: finalText.trim() }) })
            setLedger(updated)
          }).catch((caught: unknown) => { setError(caught instanceof Error ? caught.message : String(caught)) })
        }
      }
      recognition.onerror = (event) => {
        if (session !== sessionRef.current) return
        terminal = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(event.error)
        if (terminal) { setError('浏览器语音识别停止：' + event.error); stopBrowserCapture() }
      }
      recognition.onend = () => {
        if (session !== sessionRef.current || terminal) return
        window.setTimeout(openSegment, 150)
      }
      recognitionRef.current = recognition
      recognition.start()
    }
    openSegment()
  }, [])

  useEffect(() => () => { stopBrowserCapture() }, [stopBrowserCapture])

  if (!state.open) return null
  const start = async () => {
    if (sessions.current === undefined || state.meetingId.trim() === '') return
    setBusy(true); setError('')
    try {
      const started = await request<Ledger>('/api/meeting-runtime/start', { method: 'POST', body: JSON.stringify({ meetingId: state.meetingId.trim(), sessionId: sessions.current }) })
      setLedger(started)
      try {
        await startBrowserCapture(started.meetingId, started.startedAt, 0, started.audioParts)
      } catch (caught) {
        await request<Ledger>('/api/meeting-runtime/stop', { method: 'POST', body: '{}' }).then(setLedger).catch(() => undefined)
        throw caught
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }
  const resume = async () => {
    if (ledger === null) return
    setBusy(true); setError('')
    try { await startBrowserCapture(ledger.meetingId, ledger.startedAt, (ledger.segments.at(-1)?.sequence ?? -1) + 1, ledger.audioParts) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true); setError('')
    try { stopBrowserCapture(); setLedger(await request<Ledger>('/api/meeting-runtime/stop', { method: 'POST', body: '{}' })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }
  const generate = async () => {
    setBusy(true); setError('')
    try { setLedger(await request<Ledger>('/api/meeting-runtime/generate', { method: 'POST', body: JSON.stringify({ meetingId: state.meetingId.trim() }) })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setBusy(false) }
  }

  return <section className={css.panel} role="dialog" aria-label="会议纪要">
    <header className={css.header}>
      <div><h2 className={css.title}>会议实时纪要</h2><div className={css.status}>{statusText(ledger?.status)}</div></div>
      <button type="button" className={css.close} aria-label="关闭会议纪要" onClick={() => { actions.close() }}><IconCloseOutline16 size={16} /></button>
    </header>
    <div className={css.toolbar}>
      <label className={css.label} htmlFor="meeting-id">会议 ID</label>
      <input id="meeting-id" className={css.input} disabled={ledger !== null && ['loading', 'recording', 'stopping', 'summarizing'].includes(ledger.status)} value={state.meetingId} onChange={(event) => { actions.setMeetingId(event.target.value) }} />
      {ledger === null || ['completed', 'failed', 'stopping'].includes(ledger.status)
        ? <Button variant="primary" disabled={busy || sessions.current === undefined || state.meetingId.trim() === ''} icon={busy ? <IconLoadingOutline16 size={14} /> : <IconListPenOutline16 size={14} />} onClick={() => { void start() }}>开始会议</Button>
        : ledger.status === 'recording' ? capturing ? <Button variant="outline" disabled={busy} onClick={() => { void stop() }}>停止录音</Button> : <Button variant="primary" disabled={busy} onClick={() => { void resume() }}>恢复录音</Button> : ledger.status === 'stopped' ? <Button variant="primary" disabled={busy} onClick={() => { void generate() }}>生成纪要</Button> : <Button variant="outline" disabled>{ledger.status === 'loading' ? '正在请求麦克风…' : '正在生成纪要…'}</Button>}
      <span className={css.hint}>浏览器 Web Speech 实时识别 · 每 5 分钟保存音频和增量摘要</span>
    </div>
    <div className={css.archive}>保存位置：{ledger?.archivePath ?? 'F:\\deepseek_harness\\meeting-data\\' + state.meetingId}</div>
    {sessions.current === undefined && <div className={css.error} role="alert">请先选择一个 Harness 会话。</div>}
    {(error !== '' || ledger?.error) && <div className={css.error} role="alert">{error || ledger?.error}</div>}
    <div className={css.body}>
      <div className={css.column}>
        <h3>实时转写</h3>
        <pre className={css.transcript}>{transcript || '开始会议后，浏览器实时转写将显示在这里。'}{interim === '' ? '' : `\n[识别中] ${interim}`}</pre>
      </div>
      <div className={css.column}>
        <h3>增量摘要（{ledger?.summaries.length ?? 0}）</h3>
        <div className={css.summaries}>{ledger === null ? '每 5 分钟生成一次。' : ledger.summaries.map((summary, index) => <article key={summary.createdAt}><h4>{index + 1}. {offset(ledger.startedAt, summary.fromMs)}–{offset(ledger.startedAt, summary.toMs)}</h4><pre>{summary.markdown}</pre></article>)}</div>
      </div>
      <div className={css.column}>
        <h3>完整纪要</h3>
        <pre className={css.minutes}>{ledger?.minutes || '结束会议后生成完整纪要。'}</pre>
      </div>
    </div>
  </section>
}
