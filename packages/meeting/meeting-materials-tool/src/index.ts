/**
 * Registers the model-facing meeting materials lookup tool.
 * @module @deepseek-ai/dsh-meeting-materials-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'meeting-materials-tool'

/** Services used by this tool consumer. */
export const inject = ['tools'] as const

/** Materials service configuration. */
export interface Config {
  /** Base URL of the trusted materials service. */
  serviceUrl: string
  /** Internal service credential read by the plugin, never model-facing. */
  serviceToken?: string
  /** Complete UTF-8 byte budget for one tool result. */
  maxOutputBytes?: number
  /** Cooperative request timeout in milliseconds. */
  timeoutMs?: number
}

/** Schemastery configuration for the materials tool. */
export const Config: z<Config> = z.object({
  serviceUrl: z.string().required(),
  serviceToken: z.string(),
  maxOutputBytes: z.number().default(32_768),
  timeoutMs: z.number().default(15_000),
})

type Material = { name: string; type: string; content: string }
type MaterialsResult = {
  meetingId: string
  agenda: string
  participants: string[]
  materials: Material[]
}

const PARAMETERS = {
  meetingId: { type: 'string', required: true, description: 'The meeting identifier from the request context.' },
} as const

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meetingId: { type: 'string', required: true },
    agenda: { type: 'string', required: true },
    participants: { type: 'array', required: true, items: { type: 'string' } },
    materials: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          type: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
    },
  },
} as const

import { truncateUtf8 } from './truncate.ts'

const textEncoder = new TextEncoder()

function projectResult(result: MaterialsResult, maxBytes: number): MaterialsResult {
  let used = 0
  const materials = result.materials.map((material) => {
    const remaining = Math.max(0, maxBytes - used)
    const content = truncateUtf8(material.content, remaining)
    used += content.bytes
    return { ...material, content: content.value }
  })
  const projected = { ...result, materials }
  const serializedBytes = textEncoder.encode(JSON.stringify(projected)).length
  if (serializedBytes <= maxBytes) return projected
  return {
    ...projected,
    materials: materials.map(material => ({
      ...material,
      content: material.content.slice(0, Math.max(0, Math.floor(material.content.length / 2))) + '\n… [结果已截断]',
    })),
  }
}

async function fetchMaterials(
  config: Config,
  meetingId: string,
  signal: AbortSignal,
): Promise<MaterialsResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000)
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    const token = config.serviceToken ?? process.env.MEETING_INTERNAL_TOKEN
    if (token) headers.authorization = `Bearer ${token}`
    const response = await fetch(
      `${config.serviceUrl.replace(/\/$/, '')}/api/meetings/${encodeURIComponent(meetingId)}/materials`,
      { headers, signal: controller.signal, redirect: 'error' },
    )
    if (!response.ok) throw new Error(`MATERIALS_SERVICE_${response.status}`)
    return await response.json() as MaterialsResult
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

/**
 * Registers `get_meeting_materials`; credentials are deployment context, not model arguments.
 * @param ctx - Cordis context whose tool registry receives the definition.
 * @param config - validated materials-service configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'get_meeting_materials',
    description: 'Retrieve the agenda, participants, and authorized materials for a meeting.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: config.timeoutMs ?? 15_000,
    async execute(args, exec) {
      const result = await fetchMaterials(config, args.meetingId, exec.signal)
      return projectResult(result, config.maxOutputBytes ?? 32_768)
    },
  })), 'meeting-materials-tool: register')
}
