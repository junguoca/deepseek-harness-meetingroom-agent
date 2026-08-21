# @deepseek-ai/dsh-client-ui-voice

English | [中文](README.zh.md)

Voice input for the DSH Web GUI composer: a mic toggle in the conversation-declared `conversation.input.left` seat (the left tool row, beside attach and Plan). The node half is an empty apply (the roster row); the browser half renders one button with two states — idle (mic glyph) and listening (red, pulsing).

Recognition rides the browser's own **Web Speech API** (`SpeechRecognition`), so it is free, keyless, and streams interim results. Clicking starts a zh-CN continuous stream; each final transcript chunk is appended to the draft through the standard `inputActions.setDraft` channel; a second click stops it. Speech errors (mic permission denied, no speech, no device, network, unsupported language) surface as a short inline message. Browsers without `SpeechRecognition` render nothing.

## Model Experience

None, as the mic only appends recognized text to the composer draft; the composed session, prompts, and tools own every model-visible effect.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
