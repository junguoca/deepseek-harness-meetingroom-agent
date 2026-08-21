# @deepseek-ai/dsh-client-ui-voice

[English](README.md) | 中文

DSH Web GUI 的语音输入：在 conversation 声明的 `conversation.input.left` 座位（左侧工具行，紧邻附件与 Plan）里放一个麦克风开关。node 半侧是空 apply（仅注册名册行）；浏览器半侧渲染一个两态按钮——空闲（麦克风图标）与聆听中（红色呼吸）。

识别走浏览器内置 **Web Speech API**（`SpeechRecognition`），免费、无需密钥、流式出临时结果。点击开始 zh-CN 连续识别，每一段最终文本通过标准 `inputActions.setDraft` 通道追加进草稿框；再点一次停止。语音错误（麦克风权限被拒、未检测到语音、无设备、网络、语言不支持）以内联短提示展示。不支持 `SpeechRecognition` 的浏览器不渲染该按钮。

## Model Experience

无。麦克风只把识别文本追加进 composer 草稿框，模型可见效果全部由组合的会话、提示词与工具承担。

#### KV Cache effect

无。本包不组装也不发送任何 provider 请求。
