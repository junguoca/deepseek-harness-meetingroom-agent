import { describe, expect, it } from 'vitest'
import { truncateUtf8 } from '../src/truncate.ts'

describe('truncateUtf8', () => {
  it('preserves complete multibyte characters', () => {
    const result = truncateUtf8('甲乙丙', 4)
    expect(result.value).toContain('甲')
    expect(result.value).not.toContain('�')
    expect(result.truncated).toBe(true)
  })

  it('keeps values inside the byte budget', () => {
    const result = truncateUtf8('hello', 10)
    expect(result).toEqual({ value: 'hello', bytes: 5, truncated: false })
  })
})
