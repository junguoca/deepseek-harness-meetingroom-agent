# Agent Note: Browser speech meeting runtime

Status: implemented

English | [中文](2026-08-22-browser-speech-meeting-runtime.zh.md)

## Problem

CPU-only FunASR processes meeting audio slower than real time on the target Windows host. Delay grows throughout a long meeting, and process exit can leave the Host reporting a recording that no longer captures audio.

## Decision

The meeting panel captures the browser microphone with Web Speech API and MediaRecorder. Each short-lived speech-recognition instance emits interim text locally and posts only final transcript increments to the Host; normal end, no-speech, aborted, and transient network outcomes open a fresh recognition instance while the panel remains mounted. Terminal permission, service, language, or capture errors stop local capture and surface an error.

The Host owns meeting identity, ordered transcript persistence, incremental-summary scheduling, audio storage, and final-minutes generation. Transcript frames carry a monotonic sequence and the Host ignores duplicates. MediaRecorder emits one audio chunk every five minutes; ordered chunks persist as audio-NNNN.webm or audio-NNNN.ogg and the ledger records the committed count so resumed capture never overwrites an earlier chunk.

The Host persists each final transcript before acknowledging it. Every successful incremental summary writes an independent summary-NNNN.md. Final generation reads the complete persisted transcript and all committed summaries without deleting intermediate files. A browser refresh stops capture but leaves the Host ledger recording; the panel presents a resume operation that continues transcript and audio numbering.

## Alternatives considered

**Keep CPU FunASR for live transcription.** The measured process accumulated more than three minutes of lag during a short meeting, so it cannot satisfy low-latency long-session presentation on the target CPU.

**Use Web Speech without retaining audio.** This lowers latency but makes speech during browser-service or network failures unrecoverable. Five-minute MediaRecorder chunks preserve source material for later recovery.

**Generate only final minutes.** A long meeting could lose all derived structure when final generation fails. Independent incremental-summary files provide durable checkpoints and remain optional input to a retryable final generation.

## Consequences

Live recognition has browser-service latency instead of local model backlog and no longer launches Python or FunASR. Recognition requires browser support, microphone permission, an open meeting panel, and access to the browser speech service. The restart loop reduces ordinary disconnects but cannot capture while the browser or operating system suspends the page. Uploaded audio preserves completed five-minute chunks; offline automatic retranscription remains deferred.
