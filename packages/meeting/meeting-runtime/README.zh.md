# @deepseek-ai/dsh-meeting-runtime

由 Host 持久管理的浏览器会议转写运行时。会议面板使用 Web Speech API 提供低延迟中文转写，并通过 MediaRecorder 每五分钟上传一个音频分片；Host 持久保存确定转写、音频分片、增量摘要和最终纪要。

## 配置

- `storageRoot`：会议账本和音频分片的绝对目录。
- `summaryIntervalMs`：增量摘要和时间线文件的保存间隔。
- `maxAudioChunkBytes`：单个浏览器音频分片允许上传的最大字节数。
- `maxTranscriptChars`：最终纪要请求包含的最大转写字符数。

## 文件归档

每个会议使用 `storageRoot/<meetingId>/` 文件夹。运行时持续写入 `ledger.json` 和按时间线分段的 `timeline-*.md`；浏览器每五分钟上传 `audio-*.webm` 或 `audio-*.ogg`；每次增量摘要写入 `summary-*.md`；手动生成完整纪要后写入 `final-minutes.md`。停止录音保留全部已上传内容，生成失败时原始账本、音频和分段文档保留，可再次生成。

## 模型体验

增量摘要和完整纪要请求作为插件来源消息进入启动会议时选中的 Harness 会话。原始转写片段只保存在会议账本中，仅本轮增量片段或结束时的完整转写进入模型上下文。

## 已知限制与后续工作

Web Speech 识别依赖浏览器支持、麦克风权限和浏览器语音服务。会议面板保持打开时会自动替换结束的识别实例；刷新后需要用户恢复采集。已上传音频保留可恢复的来源数据，但离线自动补转写、说话人分离和手机后台采集暂不实现。
