import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createMeetingStore } from './store.ts'
import { MeetingPanel, MeetingTrigger } from './MeetingPanel.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  const store = createMeetingStore()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'meeting-minutes',
    order: 10,
    store,
  }, MeetingTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'meeting-minutes-panel',
    order: 10,
    store,
  }, MeetingPanel))
}
