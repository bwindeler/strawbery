# chatbot-eval-batch

A Chrome extension for running structured, multi-turn evaluations against multiple AI chatbots in batch. Designed for research use — prepare a prompt script, run it across targets, export the transcript.

---

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. The extension icon appears in the toolbar. Click it to open the sidepanel.

---

## Usage

1. **Prepare an eval script** — a JSON file following the format below.
2. **Load the script** — click "📂 Load JSON" in the sidepanel and select your file.
3. **Select targets** — check the chatbots you want to evaluate.
4. **Click "▶ Run All Targets"** — the extension opens a tab for each target, injects your prompts in order, waits for responses, and closes the tab.
5. **Save the transcript** — click "💾 Save transcript" to download the full results as JSON.

> **Note:** Targets open as active tabs during the run. Do not close them — they are closed automatically when each target finishes.

---

## Eval Script Format

```json
{
  "id": "my-eval-id",
  "name": "My Eval Name",
  "turns": [
    { "prompt": "First prompt text" },
    { "prompt": "Second prompt text" }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Short identifier used in the exported filename |
| `name` | Yes | Human-readable name shown in the sidepanel |
| `turns` | Yes | Array of turns, each with a `prompt` string |

---

## Transcript Format

Exported as JSON matching this schema:

```json
{
  "script_id": "string",
  "script_name": "string",
  "run_timestamp": "ISO8601",
  "targets": [
    {
      "id": "string",
      "name": "string",
      "model_version": "string or null",
      "error": "string or null",
      "turns": [
        {
          "timestamp": "ISO8601",
          "prompt": "string",
          "response": "string"
        }
      ]
    }
  ]
}
```

---

## Targets

All targets are public-facing and work without login.

| Name | URL |
|---|---|
| ChatGPT | chatgpt.com |
| Gemini | gemini.google.com/app |
| Mistral Le Chat | chat.mistral.ai |


---

## Repository Structure

```
chatbot-eval-batch/
├── manifest.json       Chrome extension manifest (MV3)
├── background.js       Service worker — opens the sidepanel
├── sidepanel.html      Extension sidepanel UI
├── sidepanel.js        Sidepanel logic (script loading, run orchestration, transcript export)
├── targets.js          Built-in chatbot target definitions (selectors, URLs)
├── orchestrator.js     Multi-tab run orchestrator
└── core/
    └── content.js      Injectable content script — prompt injection & response capture
                        (shared library; will be extracted to chatbot-eval-core)
```

---

## Adding Targets

Edit `targets.js`. Each target needs:

```js
{
  id:               "unique-id",
  name:             "Display Name",
  url:              "https://...",
  inputSelector:    "CSS selector for the text input",
  sendSelector:     "CSS selector for the send button",
  responseSelector: "CSS selector for assistant message text",
  // Optional: strip unwanted text (e.g. timestamps) from captured responses
  responseClean:    (text) => text.replace(/pattern/, "").trim(),
}
```

---

## License

MIT
