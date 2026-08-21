# `@deepseek-ai/dsh-meeting-prompt`

English | [中文](README.zh.md)

Registers the meeting-minutes system-prompt section. The section instructs an Agent to produce one Obsidian-flavoured Markdown document from a transcript and trusted material-tool results. The plugin does not create Agents, own sessions, handle credentials, or call business services.

## Wiring

```yaml
- id: meeting-prompt
  name: '@deepseek-ai/dsh-meeting-prompt'
```

The registration uses the scoped `SystemPrompt.section()` effect and is removed when the plugin unloads.

## Model Experience

### System prompt

The model receives instructions to extract conclusions and action items, mark uncertain facts as `待确认`, call `get_meeting_materials` only when trusted materials are absent, and return Markdown without a preamble or code fence. Credentials and internal service details are explicitly excluded from the generated document.

#### Token effect

The fixed meeting instructions repeat on each model request and consume tokens proportional to their text length.

#### KV Cache effect

The section is prefix-stable while the plugin and text remain unchanged.

## Known Limitations and Deferred Work

- The prompt cannot enforce tool-call count or factual correctness by itself; the tool and gateway own retries, authorization, and output validation.
- The package does not provide a per-request identity context; deployments must keep credentials outside model-visible messages.
