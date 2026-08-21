import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

export type MeetingState = {
  open: boolean
  meetingId: string
  transcript: string
  requestId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  markdown: string
  error: string
}

type MeetingActions = {
  open: (draft: MeetingState) => void
  close: (draft: MeetingState) => void
  setMeetingId: (draft: MeetingState, value: string) => void
  setTranscript: (draft: MeetingState, value: string) => void
  setRequest: (draft: MeetingState, value: string) => void
  setResult: (draft: MeetingState, status: MeetingState['status'], markdown: string, error: string) => void
}

export function createMeetingStore(): EngineStoreHandle<MeetingState, MeetingActions> {
  return defineStore({
    init: (): MeetingState => ({ open: false, meetingId: 'meeting-001', transcript: '', requestId: null, status: 'idle', markdown: '', error: '' }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
      setMeetingId: (draft, value) => { draft.meetingId = value },
      setTranscript: (draft, value) => { draft.transcript = value },
      setRequest: (draft, value) => { draft.requestId = value; draft.status = 'running'; draft.markdown = ''; draft.error = '' },
      setResult: (draft, status, markdown, error) => { draft.status = status; draft.markdown = markdown; draft.error = error },
    },
  })
}
