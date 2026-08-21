# `@deepseek-ai/dsh-meeting-materials-tool`

注册模型可见的 `get_meeting_materials` 工具，从外部业务服务读取会议议程、参会人和材料。模型只提供 `meetingId`；业务凭证来自插件配置或 Runtime 环境变量 `MEETING_INTERNAL_TOKEN`，不会进入模型请求。

业务服务必须提供 `GET /api/meetings/:meetingId/materials`，并负责用户和会议权限校验。带凭证请求拒绝重定向。工具结果按 `maxOutputBytes` 限制完整序列化大小。
