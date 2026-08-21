# @deepseek-ai/dsh-client-ui-meeting

Meeting-minutes workspace for the DSH Web GUI. The browser plugin contributes one sidebar action and one frame overlay through the existing slot system. It sends authenticated demo requests to the local meeting Gateway at `http://127.0.0.1:4010`, polls task status, supports cancellation, and displays the returned Obsidian Markdown.

## Model Experience

This package adds no model-visible prompt, tools, or messages. The separate meeting Gateway and Harness Runtime own model interaction.

## Known Limitations and Deferred Work

The MVP uses a fixed local Gateway URL and demo bearer value. Production deployment must replace these with same-origin host routing and application authentication. The result is displayed as source Markdown rather than a rendered preview.
