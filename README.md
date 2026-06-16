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
  "schema_version": "strawbery.eval.v1",
  "id": "my-eval-id",
  "name": "My Eval Name",
  "description": "Optional description of what this eval measures.",
  "tags": ["reasoning", "multi-turn"],
  "metadata": {
    "author": "Researcher Name"
  },
  "samples": [
    {
      "id": "sample-1",
      "input": [
        {
          "role": "user",
          "content": "First prompt text"
        },
        {
          "role": "user",
          "content": "Second prompt text"
        }
      ],
      "target": "Optional expected answer or grading guidance.",
      "metadata": {
        "category": "optional-analysis-label"
      }
    }
  ]
}
```

| Field            | Required | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `schema_version` | No       | Format identifier. Current value is `strawbery.eval.v1`                     |
| `id`             | No       | Short identifier used in the exported filename                              |
| `name`           | No       | Human-readable name shown in the sidepanel                                  |
| `description`    | No       | Free-text description of the eval                                           |
| `tags`           | No       | Labels for filtering or analysis                                            |
| `metadata`       | No       | Eval-level metadata copied into exported transcripts                        |
| `samples`        | Yes      | Independent conversations to run against each selected target               |
| `samples[].id`   | No       | Stable sample identifier                                                    |
| `samples[].input`| Yes      | A string or an array of chat messages with `role` and `content`             |
| `samples[].target` | No     | Expected answer, rubric, or grading guidance                                |
| `samples[].metadata` | No   | Sample-level metadata copied into exported transcripts                      |

Each sample runs as a separate conversation for each selected target. Multi-turn samples maintain conversation context within that sample. The `input` and `target` names are intentionally close to Inspect AI's `Sample` format; `target` maps cleanly to DeepEval's `expected_output`, and `input` can be adapted into promptfoo `tests[].vars`.

Legacy scripts with a top-level `turns` array are still supported:

```json
{
  "id": "legacy-eval",
  "name": "Legacy Eval",
  "turns": [
    { "prompt": "First prompt text" },
    { "prompt": "Second prompt text" }
  ]
}
```

---

## Transcript Format

Exported as JSON:

```json
{
  "schema_version": "strawbery.run.v1",
  "run": {
    "id": "run_2026-06-16T19-30-00-000Z",
    "eval_id": "my-eval-id",
    "eval_name": "My Eval Name",
    "started_at": "ISO8601",
    "completed_at": "ISO8601",
    "duration_ms": 12345
  },
  "eval": {
    "schema_version": "strawbery.eval.v1",
    "id": "my-eval-id",
    "name": "My Eval Name",
    "description": "Optional description",
    "tags": ["reasoning"],
    "metadata": {}
  },
  "environment": {
    "extension_version": "0.1.0",
    "user_agent": "string",
    "timezone": "America/Toronto"
  },
  "results": [
    {
      "sample_id": "sample-1",
      "target": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://chatgpt.com",
        "final_url": "https://chatgpt.com/...",
        "model_version": "default",
        "metadata": {}
      },
      "status": "completed",
      "started_at": "ISO8601",
      "completed_at": "ISO8601",
      "duration_ms": 12345,
      "messages": [
        {
          "role": "user",
          "content": "First prompt text",
          "timestamp": "ISO8601"
        },
        {
          "role": "assistant",
          "content": "Assistant response",
          "timestamp": "ISO8601",
          "duration_ms": 12345
        }
      ],
      "turns": [
        {
          "prompt": "string",
          "response": "string",
          "prompt_timestamp": "ISO8601",
          "response_timestamp": "ISO8601",
          "duration_ms": 12345
        }
      ],
      "target_output": "Assistant response",
      "expected_output": "Optional expected answer or grading guidance.",
      "metadata": {},
      "error": null
    }
  ]
}
```

`model_version` is detected automatically from each target's UI when available. It falls back to a static label where the model name is not exposed (e.g. logged-out ChatGPT reports `"default"`), and is `null` if detection fails. Message timestamps are captured during the run, not when the transcript is saved.

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
