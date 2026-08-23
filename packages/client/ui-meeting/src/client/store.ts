import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export type MeetingState = {
  open: boolean
  meetingId: string
}

type MeetingActions = {
  open: (draft: MeetingState) => void
  close: (draft: MeetingState) => void
  setMeetingId: (draft: MeetingState, value: string) => void
}

export function createMeetingStore(): EngineStoreHandle<MeetingState, MeetingActions> {
  return defineStore({
    init: (): MeetingState => ({ open: false, meetingId: `meeting-${new Date().toISOString().slice(2, 10)}-1` }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
      setMeetingId: (draft, value) => { draft.meetingId = value },
    },
  })
}
