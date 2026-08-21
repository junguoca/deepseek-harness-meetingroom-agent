# `@deepseek-ai/dsh-meeting-materials-tool`

English | [中文](README.zh.md)

Registers `get_meeting_materials`, a model-facing read tool that fetches authorized meeting agenda, participants, and materials from an external business service. The model supplies only `meetingId`; deployment credentials come from plugin configuration or `MEETING_INTERNAL_TOKEN` and never enter the model-visible request.

## Wiring

```yaml
- id: meeting-materials
  name: '@deepseek-ai/dsh-meeting-materials-tool'
  config:
    serviceUrl: 'http://127.0.0.1:4010'
    timeoutMs: 15000
    maxOutputBytes: 32768
```

The service must expose `GET /api/meetings/:meetingId/materials`. It owns user and meeting authorization. Credential-bearing requests reject redirects.

## Tool

`get_meeting_materials({ meetingId })` returns the meeting id, agenda, participant names, and material records. The complete serialized result is bounded by `maxOutputBytes`; oversized material content is projected into a new truncated result rather than mutating the HTTP response.

## Model Experience

### System prompt

The tool contributes no independent prompt section. The meeting prompt package describes when the model should use it.

### Tool schema and result

The model sees a single `meetingId` string argument. It never sees service tokens or a user-id authorization argument. Tool results contain only the bounded business response.

#### Token effect

The schema and returned material content consume request context tokens according to their size.

#### KV Cache effect

The schema is stable while the tool remains enabled; returned material is appended request content.

## Known Limitations and Deferred Work

- The current provider reads `MEETING_INTERNAL_TOKEN` from the Runtime environment and is suitable for an isolated task Runtime; a shared multi-tenant Runtime needs a request-scoped credential provider.
- The package does not implement login, file storage, ASR, or meeting-minute persistence.
