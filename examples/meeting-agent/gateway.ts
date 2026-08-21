import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

interface Job {
  requestId: string
  meetingId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  markdown?: string
  error?: string
  runtime?: DeepSeekHarness
}

const jobs = new Map<string, Job>()
const meetings = new Set(['meeting-001'])
const ROOT = resolve(process.cwd())
// Load the repository-root .env once so credentials and service addresses
// survive restarts without re-exporting them in every shell. .env is
// git-ignored. Values in .env WIN over inherited environment variables:
// a stale key exported earlier in the same shell must not shadow the file.
const ENV_FILE = resolve(ROOT, '.env')
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match === null) continue
    let value = match[2] ?? ''
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1)
    process.env[match[1]] = value
  }
}
const PORT = Number(process.env.PORT ?? 4010)
const RUNTIME = resolve(ROOT, 'packages/examples/jsonrpc-demo/lib/bin.js')
const CONFIG = resolve(ROOT, 'examples/meeting-agent/cordis.yml')
// A hung model provider must fail the job loudly instead of leaving the UI
// polling a forever-running task. Generous on purpose: first-token latency on
// the demo provider was observed between seconds and ~3 minutes.
const RUN_TIMEOUT_MS = Number(process.env.MEETING_RUN_TIMEOUT_MS ?? 10 * 60_000)

function createHarness(): DeepSeekHarness {
  const apiKey = process.env.NBWCODE_API_KEY
  if (!apiKey) throw new Error('NBWCODE_API_KEY is required')
  return new DeepSeekHarness({
    cwd: ROOT,
    provider: 'nbwcode',
    model: 'gpt-5.6-sol',
    launch: {
      command: process.execPath,
      args: [RUNTIME],
      cwd: ROOT,
      env: {
        ...process.env,
        DSH_CORDIS_CONFIG: CONFIG,
        MEETING_SERVICE_URL: process.env.MEETING_SERVICE_URL ?? `http://127.0.0.1:${PORT}`,
        MEETING_INTERNAL_TOKEN: process.env.MEETING_INTERNAL_TOKEN ?? 'demo-user-001',
        NBWCODE_API_KEY: apiKey,
      },
    },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:3080',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(value))
}

function publicJob(job: Job): Omit<Job, 'runtime'> {
  const { runtime: _runtime, ...result } = job
  return result
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of req) text += String(chunk)
  return text.length === 0 ? {} : JSON.parse(text) as Record<string, unknown>
}

function authenticated(req: IncomingMessage): boolean {
  return req.headers.authorization === 'Bearer demo-user-001'
}

async function runMeetingAgent(job: Job, transcript: string): Promise<void> {
  const harness = createHarness()
  job.runtime = harness
  try {
    const result = await withTimeout(
      harness.run(
        `会议上下文：meeting_id=${job.meetingId}。请根据下面的会议转写生成 Obsidian Markdown 会议纪要。不要输出解释，只输出 Markdown。\n\n${transcript}`,
        { sessionId: `meeting-${job.requestId}` },
      ),
      RUN_TIMEOUT_MS,
      `meeting agent run timed out after ${RUN_TIMEOUT_MS / 1000}s`,
    )
    const markdown = normalizeMarkdown(result.finalResponse)
    const error = validateMarkdown(markdown)
    // Diagnostics for local debugging: print the received model output when
    // validation fails so the mismatch (empty, preamble, code fence, or a
    // different frontmatter) is visible in the gateway window.
    if (error) {
      console.error(`[meeting-agent] ${error} for ${job.requestId}; finalResponse length=${markdown.length}`)
      for (const event of result.events.slice(-8)) {
        console.error(`[meeting-agent] event ${event.type}: ${JSON.stringify(event.data).slice(0, 400)}`)
      }
    }
    const current = jobs.get(job.requestId)
    if (!current || current.status === 'cancelled') return
    if (error) { current.status = 'failed'; current.error = error }
    else { current.status = 'completed'; current.markdown = markdown }
  } catch (error) {
    const current = jobs.get(job.requestId)
    if (!current || current.status === 'cancelled') return
    current.status = 'failed'
    current.error = error instanceof Error ? error.message : String(error)
  } finally {
    job.runtime = undefined
    await harness.close()
  }
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replaceAll('\r\n', '\n').trim()
}

function validateMarkdown(markdown: string): string | undefined {
  if (!markdown.startsWith('---\n') || !markdown.includes('\nmeeting_id: ')) return 'invalid meeting markdown'
  if (markdown.includes('Bearer ') || markdown.includes('MEETING_INTERNAL_TOKEN')) return 'sensitive value in output'
  return undefined
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    json(res, 200, { accessToken: 'demo-user-001', user: { id: 'user-001', name: '张三' } })
    return
  }
  if (!authenticated(req)) {
    json(res, 401, { error: 'unauthorized' })
    return
  }
  if (req.method === 'GET' && /^\/api\/meetings\/[^/]+\/materials$/.test(url.pathname)) {
    const meetingId = url.pathname.split('/')[3]
    if (!meetings.has(meetingId)) {
      json(res, 404, { error: 'MEETING_NOT_FOUND' })
      return
    }
    json(res, 200, {
      meetingId,
      agenda: '接口开发进度、预算调整和下一版本规划',
      participants: ['张三', '李四', '王五'],
      materials: [{ name: '项目计划书.md', type: 'markdown', content: '订单查询接口：2026-08-20' }],
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/meeting-agent/run') {
    const input = await body(req)
    const meetingId = typeof input.meetingId === 'string' ? input.meetingId : ''
    const transcript = typeof input.transcript === 'string' ? input.transcript : ''
    const requestId = typeof input.requestId === 'string' && input.requestId.length > 0 ? input.requestId : randomUUID()
    if (!meetings.has(meetingId) || transcript.trim().length === 0) {
      json(res, 400, { error: 'meetingId and transcript are required' })
      return
    }
    const existing = jobs.get(requestId)
    if (existing) {
      json(res, 200, publicJob(existing))
      return
    }
    const job: Job = { requestId, meetingId, status: 'running' }
    jobs.set(requestId, job)
    json(res, 202, { requestId, status: job.status })
    void runMeetingAgent(job, transcript)
    return
  }
  const statusMatch = url.pathname.match(/^\/api\/meeting-agent\/([^/]+)\/status$/)
  if (req.method === 'GET' && statusMatch) {
    const job = jobs.get(statusMatch[1] ?? '')
    if (!job) json(res, 404, { error: 'not found' })
    else json(res, 200, publicJob(job))
    return
  }
  const cancelMatch = url.pathname.match(/^\/api\/meeting-agent\/([^/]+)\/cancel$/)
  if (req.method === 'POST' && cancelMatch) {
    const job = jobs.get(cancelMatch[1] ?? '')
    if (!job) json(res, 404, { error: 'not found' })
    else if (job.status === 'completed' || job.status === 'failed') json(res, 409, { error: 'already settled' })
    else {
      job.status = 'cancelled'
      void job.runtime?.close()
      json(res, 200, { requestId: job.requestId, meetingId: job.meetingId, status: job.status })
    }
    return
  }
  json(res, 404, { error: 'not found' })
}

createServer((req, res) => { void handle(req, res).catch(() => json(res, 500, { error: 'internal error' })) }).listen(PORT, () => {
  console.error(`Meeting gateway mock listening on http://127.0.0.1:${PORT}`)
})
