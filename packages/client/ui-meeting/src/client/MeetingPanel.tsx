import { useEffect, useState } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutline16, IconListPenOutline16, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createMeetingStore } from './store.ts'
import css from './MeetingPanel.module.css'

export type MeetingPanelProps = PropsRuntime<'shell.overlay'> & PropsStore<ReturnType<typeof createMeetingStore>>
export type MeetingTriggerProps = PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createMeetingStore>>

type Job = { status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; markdown?: string; error?: string }
const GATEWAY = 'http://127.0.0.1:4010'
const AUTH = 'Bearer demo-user-001'

async function request(path: string, init?: RequestInit): Promise<Job> {
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { Authorization: AUTH, 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  })
  if (!response.ok) throw new Error((await response.text()) || `Gateway request failed (${response.status})`)
  return await response.json() as Job
}

export function MeetingTrigger({ wide, actions }: MeetingTriggerProps) {
  return (
    <button type="button" className={css.trigger} aria-label="会议纪要" title="会议纪要" onClick={() => { actions.open() }}>
      <IconListPenOutline16 size={wide ? 16 : 18} />
      {wide && <span className={css.triggerLabel}>会议纪要</span>}
    </button>
  )
}

export function MeetingPanel({ useStore, actions }: MeetingPanelProps) {
  const state = useStore(s => s)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const timer = window.setInterval(() => { setElapsed(seconds => seconds + 1) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [busy])

  useEffect(() => {
    if (state.status !== 'running' || state.requestId === null) return
    const requestId = state.requestId
    let cancelled = false
    const poll = async () => {
      try {
        const result = await request(`/api/meeting-agent/${encodeURIComponent(requestId)}/status`)
        if (cancelled) return
        if (result.status === 'running' || result.status === 'queued') {
          window.setTimeout(() => { void poll() }, 1200)
        } else {
          actions.setResult(result.status, result.markdown ?? '', result.error ?? '')
          setBusy(false)
        }
      } catch (error) {
        if (!cancelled) { actions.setResult('failed', '', error instanceof Error ? error.message : String(error)); setBusy(false) }
      }
    }
    void poll()
    return () => { cancelled = true }
  }, [actions, state.requestId, state.status])

  if (!state.open) return null
  const submit = async () => {
    if (state.meetingId.trim() === '' || state.transcript.trim() === '') return
    setBusy(true)
    const requestId = `web-${crypto.randomUUID()}`
    actions.setRequest(requestId)
    try {
      const result = await request('/api/meeting-agent/run', {
        method: 'POST',
        body: JSON.stringify({ requestId, meetingId: state.meetingId.trim(), transcript: state.transcript }),
      })
      if (result.status !== 'running' && result.status !== 'queued') actions.setResult(result.status, result.markdown ?? '', result.error ?? '')
    } catch (error) {
      actions.setResult('failed', '', error instanceof Error ? error.message : String(error)); setBusy(false)
    }
  }
  const cancel = async () => {
    if (state.requestId === null) return
    try { await request(`/api/meeting-agent/${encodeURIComponent(state.requestId)}/cancel`, { method: 'POST' }); actions.setResult('cancelled', '', '') } catch (error) { actions.setResult('failed', '', error instanceof Error ? error.message : String(error)) }
    setBusy(false)
  }

  return (
    <section className={css.panel} role="dialog" aria-label="会议纪要">
      <header className={css.header}>
        <h2 className={css.title}>会议纪要</h2>
        <button type="button" className={css.close} aria-label="关闭会议纪要" onClick={() => { actions.close() }}><IconCloseOutline16 size={16} /></button>
      </header>
      <div className={css.body}>
        <div className={css.form}>
          <label className={css.label} htmlFor="meeting-id">会议 ID</label>
          <input id="meeting-id" className={css.input} value={state.meetingId} onChange={(event) => { actions.setMeetingId(event.target.value) }} />
          <label className={css.label} htmlFor="meeting-transcript">会议转写</label>
          <textarea id="meeting-transcript" className={css.textarea} value={state.transcript} onChange={(event) => { actions.setTranscript(event.target.value) }} placeholder="粘贴会议转写内容" />
          <div className={css.actions}>
            <Button variant="primary" disabled={busy || state.transcript.trim() === ''} icon={busy ? <IconLoadingOutline16 size={14} /> : <IconListPenOutline16 size={14} />} onClick={() => { void submit() }}>生成纪要</Button>
            {busy && <Button variant="outline" onClick={() => { void cancel() }}>取消</Button>}
            <span className={css.status}>{state.status === 'running' ? `正在生成… 已等待 ${elapsed} 秒` : state.status === 'completed' ? '已完成' : state.status === 'cancelled' ? '已取消' : ''}</span>
          </div>
          {state.status === 'running' && <div className={css.hint}>模型首次响应可能需要 1-3 分钟，请耐心等待；如长时间无响应可取消后重试。</div>}
          {state.error !== '' && <div className={css.error} role="alert">{state.error}</div>}
        </div>
        <div className={css.result} aria-label="会议纪要结果">
          <pre>{state.markdown || '生成后的 Obsidian Markdown 将显示在这里。'}</pre>
        </div>
      </div>
    </section>
  )
}
