/**
 * Voice-input plugin, browser half: contributes a mic toggle to the
 * conversation-declared `conversation.input.left` list seat (the composer's
 * left tool row, beside the resident attach/plan chrome). Speech recognition
 * rides the browser Web Speech API directly — no key, no backend — and
 * recognized final text is appended to the draft through the standard
 * `inputActions.setDraft` channel. Unsupported browsers (no
 * SpeechRecognition) render nothing.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { VoiceInput } from './VoiceInput.tsx'

/** Required services: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the mic toggle over the composer tool-row seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'voice-input',
    order: 300,
  }, VoiceInput))
}
