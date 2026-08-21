# Meeting Agent example

This runnable composition adds the meeting prompt and materials lookup tool to the existing Agent spine. The materials tool reads `MEETING_INTERNAL_TOKEN` from the Runtime environment and never receives a credential from model arguments. The example is intentionally small: the business gateway, login, file service, ASR, and minutes storage remain deployment responsibilities.

Run through a configured DSH entry point after building host libraries. Set `MEETING_SERVICE_URL` when the materials service is not at `http://127.0.0.1:4010`. Set `MEETING_RUN_TIMEOUT_MS` to fail a hung agent run instead of polling forever (default 600000). The tiny `gateway.ts` is a local HTTP contract mock for UI and tool verification; its Agent task uses a mock Markdown function and is not the production Harness bridge.
