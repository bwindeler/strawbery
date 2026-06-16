# strawbery

A Chrome extension for running structured, multi-turn evaluations against multiple AI chatbots in batch. Designed for research use — prepare a prompt script, run it across targets, export the full transcript.

---

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. The extension icon appears in the toolbar. Click it to open the sidepanel.

> Tip: You can select "Details" for the extension and "Allow in Incognito" to easily use these chatbots while logged out.

---

## Usage

1. **Prepare an eval script** — a JSON file following the format below.
2. **Load the script** — click "📂 Load JSON" in the sidepanel and select your file.
3. **Select targets** — check the chatbots you want to evaluate.
4. **Click "▶ Run All Targets"** — the extension opens a tab for each target, injects your prompts in order, waits for responses, and closes the tab.
5. **Save the transcript** — click "💾 Save transcript" to download the full results as JSON.

> **Note:** Targets open as active (foreground) tabs during the run — chatbot sites do not stream responses in background tabs. Do not close them manually; they are closed automatically when each target finishes.

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

| Field   | Required | Description                                    |
| ------- | -------- | ---------------------------------------------- |
| `id`    | Yes      | Short identifier used in the exported filename |
| `name`  | Yes      | Human-readable name shown in the sidepanel     |
| `turns` | Yes      | Array of turns, each with a `prompt` string    |

Multi-turn scripts maintain conversation context — each prompt is sent into the same ongoing chat session for that target.

---

## Transcript Format

Exported as JSON:

```json
{
  "script_id": "string",
  "script_name": "string",
  "run_timestamp": "ISO8601",
  "targets": [
    {
      "id": "string",
      "name": "string",
      "model_version": null,
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

`model_version` is reserved for future use (automatic detection from the UI) and is always `null` in the current version.

---

## Targets

All three targets work without login.

| Name            | URL                   |
| --------------- | --------------------- |
| ChatGPT         | chatgpt.com           |
| Gemini          | gemini.google.com/app |
| Mistral Le Chat | chat.mistral.ai       |

---

## Repository Structure

```
strawbery/
├── manifest.json       Chrome extension manifest (MV3)
├── background.js       Service worker — opens the sidepanel on toolbar click
├── sidepanel.html      Extension sidepanel UI
├── sidepanel.js        Sidepanel logic: script loading, run orchestration,
│                       markdown rendering, transcript export
├── targets.js          Built-in target definitions (URLs, CSS selectors,
│                       response post-processing)
├── orchestrator.js     Multi-tab run orchestrator: opens tabs, injects
│                       content script, sequences turns, closes tabs
└── core/
    └── content.js      Injectable content script: prompt injection, send-button
                        detection, response capture (MutationObserver + debounce),
                        ToU/consent dialog dismissal
```

---

## Adding Targets

Edit `targets.js`. Each entry needs:

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

Selectors may need updating as chatbot UIs change. The `sendSelector` button is expected to be hidden until the input contains text — that is normal.

---

## Tests

Unit tests cover the pure helpers (markdown rendering, HTML escaping, slugify,
and the Gemini response cleaner). They use Node's built-in test runner — no
dependencies to install:

```sh
npm test
```

---

## License

MIT
