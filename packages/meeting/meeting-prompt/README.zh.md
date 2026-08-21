# `@deepseek-ai/dsh-meeting-prompt`

注册会议纪要系统提示词。该插件指导 Agent 根据会议转写和可信材料工具结果生成 Obsidian Markdown 会议纪要，不创建 Agent、不管理会话、不处理凭证，也不调用业务服务。

```yaml
- id: meeting-prompt
  name: '@deepseek-ai/dsh-meeting-prompt'
```

插件通过 `SystemPrompt.section()` 注册，并在卸载时自动移除。
