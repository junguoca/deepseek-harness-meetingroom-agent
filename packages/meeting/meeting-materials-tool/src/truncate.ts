/** UTF-8 byte-budget helpers for meeting material results. */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Truncate a string without retaining a partial UTF-8 code point.
 * @param value - source text.
 * @param maxBytes - maximum source bytes to retain.
 * @returns bounded text and its encoded byte count.
 */
export function truncateUtf8(value: string, maxBytes: number): { value: string; bytes: number; truncated: boolean } {
  const source = encoder.encode(value)
  if (source.length <= maxBytes) return { value, bytes: source.length, truncated: false }
  let end = Math.max(0, Math.min(maxBytes, source.length))
  while (end > 0) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(source.slice(0, end))
      break
    } catch {
      end--
    }
  }
  const prefix = decoder.decode(source.slice(0, end))
  return { value: `${prefix}\n… [内容已截断]`, bytes: encoder.encode(prefix).length, truncated: true }
}
