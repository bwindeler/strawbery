# strawbery

A Chrome extension for running structured, multi-turn evaluations against multiple AI chatbots in batch. Designed for research use — prepare a prompt script, run it across targets, export the full transcript.

![strawbery demo](./strawbery%20demo.gif)

---

## Terms of Use and Ethics Notice

This project is intended for personal research, evaluation, and educational use. It automates browser interactions with third-party chatbot websites, including services operated by OpenAI, Google, and Mistral AI. Those services have their own terms, policies, rate limits, acceptable-use rules, and technical protections.

Before using this tool, you are responsible for reviewing and complying with the terms and policies of each service you target. Automated data entry, automated collection of model outputs, scraping, high-volume testing, bypassing access controls, or use of multiple accounts may violate those terms or result in rate limiting, account suspension, loss of access, or other consequences.

Do not use this project to:

- bypass paywalls, login requirements, rate limits, CAPTCHAs, safety systems, or other access controls;
- collect, store, or redistribute third-party content unless you have the right to do so;
- submit personal, confidential, sensitive, proprietary, or regulated data unless you have permission and an appropriate legal basis;
- misrepresent automated outputs as human-generated;
- run evaluations at a scale or frequency that could burden or disrupt third-party services.

The maintainers are not affiliated with OpenAI, Google, Mistral AI, or the chatbot services supported by this project. This software is provided as-is, without any warranty. You use it at your own risk and are solely responsible for your use of the tool, the prompts you submit, the outputs you collect, and your compliance with applicable laws and third-party terms.

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

`model_version` is detected automatically from each target's UI when available. It falls back to a static label where the model name is not exposed (e.g. logged-out ChatGPT reports `"default"`), and is `null` if detection fails.

---

## Targets

All three targets work without login, with one caveat for Gemini.

| Name            | URL                   | Login                                                |
| --------------- | --------------------- | ---------------------------------------------------- |
| ChatGPT         | chatgpt.com           | Not required (free tier)                             |
| Gemini          | gemini.google.com/app | Not required when already on `/app`; otherwise redirects to Google auth |
| Mistral Le Chat | chat.mistral.ai       | Not required (anonymous access)                      |

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

MIT — see [LICENSE](LICENSE).
