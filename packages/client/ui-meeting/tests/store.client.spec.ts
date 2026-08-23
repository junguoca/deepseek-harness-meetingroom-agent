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

  it('keeps the editable meeting id across panel visibility changes', () => {
    const { store, actions } = createMeetingStore().create()
    actions.setMeetingId('weekly-sync')
    actions.open()
    actions.close()
    expect(store.getSnapshot()).toMatchObject({ open: false, meetingId: 'weekly-sync' })
  })
})
