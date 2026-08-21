import { describe, expect, it } from 'vitest'
import { MEETING_PROMPT } from '../src/index.ts'

describe('meeting prompt', () => {
  it('requires bounded factual Obsidian output without credentials', () => {
    expect(MEETING_PROMPT).toContain('get_meeting_materials')
    expect(MEETING_PROMPT).toContain('待确认')
    expect(MEETING_PROMPT).toContain('Output only the Markdown document')
    expect(MEETING_PROMPT).not.toContain('Bearer ')
    expect(MEETING_PROMPT).not.toContain('caller_token')
  })
})
