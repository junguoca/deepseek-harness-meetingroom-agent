# @deepseek-ai/dsh-meeting-runtime

Host persistence for browser meeting transcription. The meeting panel uses Web Speech API for low-latency Chinese transcription and MediaRecorder to upload one audio chunk every five minutes; the Host persists final transcript segments, audio chunks, incremental summaries, and final minutes.

## Configuration

- `storageRoot`: absolute meeting archive directory.
- `summaryIntervalMs`: positive interval between incremental summaries and timeline partitions.
- `maxAudioChunkBytes`: maximum accepted byte size for one browser audio chunk.
- `maxTranscriptChars`: maximum transcript characters included in the final-minutes request.

## File Archive

Each meeting uses `storageRoot/<meetingId>/`. The Host continuously writes `ledger.json` and `timeline-*.md`; the browser uploads `audio-*.webm` or `audio-*.ogg`; each incremental summary writes `summary-*.md`; manual final generation writes `final-minutes.md`. Stopping preserves every uploaded artifact, and failed generation remains retryable.

## Model Experience

Incremental and final prompts enter the selected Harness session as ordinary plugin-origin messages. Final browser transcript segments stay in the meeting ledger and enter model context only in bounded summary batches or the final-minutes request.

## Known Limitations and Deferred Work

Web Speech recognition depends on browser support, microphone permission, and the browser speech service. The panel replaces ended recognition instances while it remains open; a refresh requires the user to resume capture. Uploaded audio preserves recoverable source material, but offline automatic retranscription, speaker diarization, and mobile background capture remain deferred.
