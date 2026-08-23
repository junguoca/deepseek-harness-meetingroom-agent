/** Host-managed FunASR transcription and meeting-summary runtime. @module @deepseek-ai/dsh-meeting-runtime */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'meeting-runtime'
export const inject = ['agents', 'webServer'] as const

export interface Config {
  storageRoot: string
  summaryIntervalMs: number
  maxAudioChunkBytes: number
  maxTranscriptChars: number
}

export const Config: z<Config> = z.object({
  storageRoot: z.string().required(),
  summaryIntervalMs: z.number().step(1).min(1).required(),
  maxAudioChunkBytes: z.number().step(1).min(1).required(),
  maxTranscriptChars: z.number().step(1).min(1).required(),
})

type MeetingStatus = 'loading' | 'recording' | 'stopping' | 'stopped' | 'summarizing' | 'completed' | 'failed'
type Segment = { sequence: number; startMs: number; endMs: number; text: string }
type Summary = { fromMs: number; toMs: number; markdown: string; createdAt: number }
type MeetingLedger = {
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
type ActiveMeeting = {
  ledger: MeetingLedger
  summaryTimer?: NodeJS.Timeout
  summaryCursor: number
  summaryChain: Promise<void>
  stopping: boolean
}

const API_PREFIX = '/api/meeting-runtime'
const SOURCE = { kind: 'plugin', plugin: 'meeting-runtime' } as const

function assertConfig(config: Config): void {
  if (!isAbsolute(config.storageRoot)) throw new Error('meeting-runtime: storageRoot must be an absolute path')
}

function safeMeetingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error('meetingId must use 1-128 letters, digits, dots, underscores, or hyphens')
  }
  return value
}

async function nextMeetingId(config: Config): Promise<string> {
  const prefix = `meeting-${new Date().toISOString().slice(2, 10)}`
  let next = 1
  for (const entry of await readdir(config.storageRoot, { withFileTypes: true }).catch(() => [])) {
    const match = entry.name.match(new RegExp(`^${prefix}-(\\d+)$`))
    if (match !== null) next = Math.max(next, Number(match[1]) + 1)
  }
  return `${prefix}-${next}`
}

function meetingDir(config: Config, meetingId: string): string {
  return join(config.storageRoot, meetingId)
}

function ledgerPath(config: Config, meetingId: string): string {
  return join(meetingDir(config, meetingId), 'ledger.json')
}

async function persist(config: Config, ledger: MeetingLedger): Promise<void> {
  const dir = meetingDir(config, ledger.meetingId)
  await mkdir(dir, { recursive: true })
  const path = ledgerPath(config, ledger.meetingId)
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temporary, JSON.stringify(ledger, null, 2) + '\n', 'utf8')
  await rename(temporary, path)
  const elapsed = Math.max(0, ledger.segments.at(-1)?.endMs ?? 0)
  const part = Math.floor(elapsed / config.summaryIntervalMs) + 1
  const fromMs = (part - 1) * config.summaryIntervalMs
  const toMs = part * config.summaryIntervalMs
  const partSegments = ledger.segments.filter(segment => segment.startMs >= fromMs && segment.startMs < toMs)
  const timeline = transcript(ledger.startedAt, partSegments, config.maxTranscriptChars)
  await writeFile(join(dir, `timeline-${String(part).padStart(4, '0')}.md`), `# ${ledger.meetingId} 时间线 ${part}\n\n${timeline}\n`, 'utf8')
  if (ledger.minutes !== '') await writeFile(join(dir, 'final-minutes.md'), ledger.minutes + '\n', 'utf8')
}

async function readLedger(config: Config, meetingId: string): Promise<MeetingLedger | undefined> {
  try {
    const ledger = JSON.parse(await readFile(ledgerPath(config, meetingId), 'utf8')) as MeetingLedger
    ledger.archivePath = meetingDir(config, meetingId)
    if (['loading', 'recording', 'stopping', 'summarizing'].includes(ledger.status)) {
      ledger.status = 'stopped'
      ledger.error = '上次会议因 Host 退出或连接中断而停止；已保存的转写仍可生成纪要。'
      ledger.endedAt ??= Date.now()
      await persist(config, ledger)
    }
    return ledger
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    length += bytes.length
    if (length > limit) throw new Error('request body is too large')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, length)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > 64 * 1024) throw new Error('request body is too large')
  }
  return body === '' ? {} : JSON.parse(body) as Record<string, unknown>
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function textFromAssistant(agent: Agent, fromSeq: number): string {
  const event = [...agent.session.events].reverse().find(candidate => candidate.seq >= fromSeq && candidate.type === 'assistant/message')
  if (event?.type !== 'assistant/message') throw new Error('meeting summary produced no assistant response')
  return event.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

function clockMinute(_startedAt: number, offsetMs: number): number {
  return Math.floor(Math.max(0, offsetMs) / 60_000)
}

function formatClockMinute(startedAt: number, minuteOffsetMs: number): string {
  const date = new Date(startedAt + Math.max(0, minuteOffsetMs))
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function minuteSegments(startedAt: number, segments: readonly Segment[]): Segment[] {
  const grouped: Segment[] = []
  for (const segment of segments) {
    const minute = clockMinute(startedAt, segment.startMs)
    const current = grouped.at(-1)
    if (current?.startMs === minute * 60_000) {
      current.endMs = Math.max(current.endMs, segment.endMs)
      current.text = `${current.text}${segment.text}`
    } else {
      grouped.push({ sequence: segment.sequence, startMs: minute * 60_000, endMs: segment.endMs, text: segment.text })
    }
  }
  return grouped
}

function transcript(startedAt: number, segments: readonly Segment[], maxChars: number): string {
  const full = minuteSegments(startedAt, segments).map(segment => `[${formatClockMinute(startedAt, segment.startMs)}] ${segment.text}`).join('\n')
  if (full.length <= maxChars) return full
  return '[较早转写已截断]\n' + full.slice(-maxChars)
}

async function askAgent(agent: Agent, prompt: string): Promise<string> {
  const fromSeq = agent.session.seq
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: SOURCE }))
  await agent.whenIdle()
  return textFromAssistant(agent, fromSeq)
}

function incrementalPrompt(ledger: MeetingLedger, segments: readonly Segment[]): string {
  return `你正在为会议 ${ledger.meetingId} 生成第 ${ledger.summaries.length + 1} 次增量摘要。只根据下面新增的带时间戳转写，输出简洁 Markdown，包含：本阶段讨论、阶段结论、待办事项、风险与待确认。不得编造；未知信息写“待确认”。\n\n${transcript(ledger.startedAt, segments, 48_000)}`
}

function finalPrompt(ledger: MeetingLedger, maxChars: number): string {
  const prior = ledger.summaries.map((summary, index) => `### 增量摘要 ${index + 1}\n${summary.markdown}`).join('\n\n')
  return `请为会议 ${ledger.meetingId} 生成最终 Obsidian Markdown 会议纪要。必须只使用转写和已有增量摘要中的事实，不得编造；未知信息写“待确认”。包含会议概览、核心结论、讨论内容、待办事项、风险与问题、待确认事项。只输出 Markdown。\n\n## 已有增量摘要\n${prior || '无'}\n\n## 完整带时间戳转写\n${transcript(ledger.startedAt, ledger.segments, maxChars)}`
}

export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  let active: ActiveMeeting | undefined
  let loaded: MeetingLedger | undefined

  const summarize = async (meeting: ActiveMeeting, final: boolean): Promise<void> => {
    const agent = ctx.agents.get(SessionId(meeting.ledger.sessionId))
    if (agent === undefined) throw new Error('绑定的 Harness 会话当前不可用')
    if (final) {
      meeting.ledger.status = 'summarizing'
      await persist(config, meeting.ledger)
      meeting.ledger.minutes = await askAgent(agent, finalPrompt(meeting.ledger, config.maxTranscriptChars))
      meeting.ledger.status = 'completed'
      meeting.ledger.endedAt = Date.now()
      await persist(config, meeting.ledger)
      return
    }
    const pending = meeting.ledger.segments.slice(meeting.summaryCursor)
    if (pending.length === 0) return
    const fromMs = pending[0]?.startMs ?? 0
    const toMs = pending.at(-1)?.endMs ?? fromMs
    const markdown = await askAgent(agent, incrementalPrompt(meeting.ledger, pending))
    meeting.ledger.summaries.push({ fromMs, toMs, markdown, createdAt: Date.now() })
    await mkdir(meetingDir(config, meeting.ledger.meetingId), { recursive: true })
    await writeFile(join(meetingDir(config, meeting.ledger.meetingId), 'summary-' + String(meeting.ledger.summaries.length).padStart(4, '0') + '.md'), markdown + '\n', 'utf8')
    meeting.summaryCursor = meeting.ledger.segments.length
    await persist(config, meeting.ledger)
  }

  const queueSummary = (meeting: ActiveMeeting, final: boolean): Promise<void> => {
    meeting.summaryChain = meeting.summaryChain.then(() => summarize(meeting, final)).catch(async (error: unknown) => {
      meeting.ledger.error = error instanceof Error ? error.message : String(error)
      if (final) meeting.ledger.status = 'failed'
      await persist(config, meeting.ledger)
    })
    return meeting.summaryChain
  }

  const stop = async (meeting: ActiveMeeting): Promise<void> => {
    if (meeting.stopping) return
    meeting.stopping = true
    if (meeting.summaryTimer !== undefined) clearInterval(meeting.summaryTimer)
    meeting.ledger.status = 'stopped'
    meeting.ledger.endedAt = Date.now()
    await queueSummary(meeting, false)
    await persist(config, meeting.ledger)
    loaded = meeting.ledger
    meeting.stopping = false
  }

  const generateMinutes = async (meeting: ActiveMeeting): Promise<void> => {
    if (meeting.ledger.status === 'recording' || meeting.ledger.status === 'loading' || meeting.ledger.status === 'stopping') {
      throw new Error('请先停止录音，再生成纪要')
    }
    meeting.ledger.status = 'summarizing'
    meeting.ledger.error = ''
    await persist(config, meeting.ledger)
    await queueSummary(meeting, false)
    await queueSummary(meeting, true)
  }

  const start = async (meetingId: string, sessionId: string): Promise<MeetingLedger> => {
    if (active !== undefined && !['stopped', 'completed', 'failed'].includes(active.ledger.status)) throw new Error('meeting ' + active.ledger.meetingId + ' is already active')
    if (ctx.agents.get(SessionId(sessionId)) === undefined) throw new Error('请选择一个当前可用的 Harness 会话')
    const ledger: MeetingLedger = { meetingId, archivePath: meetingDir(config, meetingId), sessionId, status: 'recording', startedAt: Date.now(), segments: [], summaries: [], minutes: '', audioParts: 0, error: '' }
    const meeting: ActiveMeeting = { ledger, summaryCursor: 0, summaryChain: Promise.resolve(), stopping: false }
    meeting.summaryTimer = setInterval(() => { void queueSummary(meeting, false) }, config.summaryIntervalMs)
    active = meeting
    loaded = ledger
    await persist(config, ledger)
    return ledger
  }

  const appendTranscript = async (
    meeting: ActiveMeeting,
    sequence: number,
    startMs: number,
    endMs: number,
    text: string,
  ): Promise<void> => {
    if (meeting.ledger.status !== 'recording') throw new Error('会议当前未录音')
    if (meeting.ledger.segments.some(segment => segment.sequence === sequence)) return
    meeting.ledger.segments.push({ sequence, startMs, endMs, text })
    meeting.ledger.segments.sort((left, right) => left.sequence - right.sequence)
    await persist(config, meeting.ledger)
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (req.method === 'GET' && url.pathname === `${API_PREFIX}/next-id`) {
        json(res, 200, { meetingId: await nextMeetingId(config) })
        return
      }
      if (req.method === 'POST' && url.pathname === `${API_PREFIX}/start`) {
        const input = await readJson(req)
        const meetingId = safeMeetingId(input.meetingId)
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
        json(res, 201, await start(meetingId, sessionId))
        return
      }
      if (req.method === 'POST' && url.pathname === `${API_PREFIX}/transcript`) {
        const input = await readJson(req)
        const meetingId = safeMeetingId(input.meetingId)
        if (active?.ledger.meetingId !== meetingId) throw new Error('指定会议当前未录音')
        const sequence = typeof input.sequence === 'number' ? input.sequence : Number.NaN
        const startMs = typeof input.startMs === 'number' ? input.startMs : Number.NaN
        const endMs = typeof input.endMs === 'number' ? input.endMs : Number.NaN
        const text = typeof input.text === 'string' ? input.text.trim() : ''
        if (![sequence, startMs, endMs].every(Number.isSafeInteger) || sequence < 0 || startMs < 0 || endMs < startMs || text === '') throw new Error('invalid transcript frame')
        await appendTranscript(active, sequence, startMs, endMs, text)
        json(res, 200, active.ledger)
        return
      }
      if (req.method === 'POST' && url.pathname === `${API_PREFIX}/audio`) {
        const meetingId = safeMeetingId(url.searchParams.get('meetingId'))
        const part = Number(url.searchParams.get('part'))
        const extension = url.searchParams.get('extension') === 'ogg' ? 'ogg' : 'webm'
        if (!Number.isSafeInteger(part) || part < 1) throw new Error('invalid audio part')
        const bytes = await readBytes(req, config.maxAudioChunkBytes)
        const dir = meetingDir(config, meetingId)
        await mkdir(dir, { recursive: true })
        if (active?.ledger.meetingId !== meetingId) throw new Error('指定会议当前未录音')
        if (part <= active.ledger.audioParts) { json(res, 200, { bytes: 0, part }); return }
        if (part !== active.ledger.audioParts + 1) throw new Error('audio part is out of sequence')
        await writeFile(join(dir, `audio-${String(part).padStart(4, '0')}.${extension}`), bytes)
        active.ledger.audioParts = part
        await persist(config, active.ledger)
        json(res, 201, { bytes: bytes.length, part })
        return
      }
      if (req.method === 'POST' && url.pathname === `${API_PREFIX}/stop`) {
        if (active === undefined) throw new Error('no meeting is active')
        await stop(active)
        json(res, 200, active.ledger)
        return
      }
      if (req.method === 'POST' && url.pathname === `${API_PREFIX}/generate`) {
        const input = await readJson(req)
        const requestedId = safeMeetingId(input.meetingId)
        const archived = active?.ledger.meetingId === requestedId ? active.ledger : await readLedger(config, requestedId)
        const meeting = active?.ledger.meetingId === requestedId
          ? active
          : archived === undefined
            ? undefined
            : {
              ledger: archived,
              summaryCursor: archived.segments.length,
              summaryChain: Promise.resolve(),
              stopping: true,
            } as ActiveMeeting
        if (meeting === undefined) throw new Error('no meeting is loaded')
        if (active === undefined) active = meeting
        await generateMinutes(meeting)
        loaded = meeting.ledger
        json(res, 200, meeting.ledger)
        return
      }
      if (req.method === 'GET' && url.pathname === `${API_PREFIX}/active`) {
        const requestedId = url.searchParams.get('meetingId')
        const current = active?.ledger ?? loaded
        json(res, 200, requestedId === null || current?.meetingId === requestedId ? current ?? null : null)
        return
      }
      const match = url.pathname.match(/^\/api\/meeting-runtime\/meetings\/([^/]+)$/)
      if (req.method === 'GET' && match !== null) {
        const ledger = await readLedger(config, safeMeetingId(decodeURIComponent(match[1] ?? '')))
        json(res, ledger === undefined ? 404 : 200, ledger ?? { error: 'meeting not found' })
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  } }), 'meeting-runtime: HTTP routes')

  ctx.effect(() => async () => {
    if (active !== undefined) await stop(active)
  }, 'meeting-runtime: stop active meeting')
}
