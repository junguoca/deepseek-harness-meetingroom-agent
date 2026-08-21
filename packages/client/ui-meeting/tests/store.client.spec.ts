// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createMeetingStore } from '../src/client/store.ts'

describe('meeting store', () => {
  it('opens and closes the panel', () => {
    const { store, actions } = createMeetingStore().create()
    expect(store.getSnapshot().open).toBe(false)
    actions.open()
    expect(store.getSnapshot().open).toBe(true)
    actions.close()
    expect(store.getSnapshot().open).toBe(false)
  })

  it('tracks a running request and its result', () => {
    const { store, actions } = createMeetingStore().create()
    actions.setRequest('req-1')
    expect(store.getSnapshot()).toMatchObject({ requestId: 'req-1', status: 'running', markdown: '', error: '' })
    actions.setResult('completed', '---\nmeeting_id: meeting-001\n---', '')
    expect(store.getSnapshot()).toMatchObject({ status: 'completed', markdown: '---\nmeeting_id: meeting-001\n---', error: '' })
  })

  it('records failures', () => {
    const { store, actions } = createMeetingStore().create()
    actions.setResult('failed', '', 'boom')
    expect(store.getSnapshot()).toMatchObject({ status: 'failed', error: 'boom' })
  })
})
