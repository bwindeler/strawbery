// Built-in evaluation targets. Selectors are tuned for each site's current DOM
// and will need updating as sites change their markup.
//
// `tier` flags whether a target needs an account:
//   "free" — usable without an account (checked by default)
//   "all"  — requires a logged-in account (marked with a "*" and off by default)
//
// Notes on login requirements:
//   ChatGPT — works without login (free tier available)
//   Gemini   — works without login when already on /app; redirects to Google auth if not signed in
//   Mistral  — works without login; anonymous access confirmed on chat.mistral.ai
//   Claude   — requires a signed-in claude.ai session; gated behind "All models"
const BUILTIN_TARGETS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    tier: "free",
    url: "https://chatgpt.com/",
    inputSelector: "#prompt-textarea",
    sendSelector: 'button[data-testid="send-button"]',
    // .markdown uses innerText-hostile CSS in dark mode; textContent works fine
    responseSelector: '[data-message-author-role="assistant"] .markdown',
    // Logged-out UI shows no model name; fall back to a static label.
    modelDefault: "default",
  },
  {
    id: "gemini",
    name: "Gemini",
    tier: "free",
    url: "https://gemini.google.com/app",
    // Gemini uses a Quill editor; .ql-clipboard is a hidden div — exclude it
    inputSelector: ".ql-editor:not(.ql-clipboard)",
    sendSelector: 'button[aria-label="Send message"]',
    // Capture the full container so tool-call output isn't missed.
    // The "Gemini said" visually-hidden H2 is stripped by responseClean below.
    responseSelector: "model-response",
    // Present while streaming (including during tool calls); disappears when done.
    // Prevents the debounce from resolving mid-generation.
    stopSelector: 'button[aria-label="Stop response"]',
    modelSelector: 'button[aria-label*="mode picker"]',
    modelExtractPattern: 'currently (.+)$',
    responseClean: (text) => {
      const langs = "Python|JavaScript|TypeScript|Java|C\\+\\+|C#|Bash|Shell|Go|Rust|SQL|HTML|CSS|Ruby|Swift|Kotlin|PHP|C";
      return text
        .replace(/Show code\s*/g, "")
        .replace(/Gemini said\s*/gi, "")
        .replace(/Analysis\s*Analysis\s*Query successful\s*/g, "")
        // "Python<code>\n\nCode output<output>" → structured block
        .replace(
          new RegExp(`(${langs})(.*?)\\n+Code output(.*?)(?=\\n\\n|$)`, "gs"),
          (_, lang, code, output) =>
            `<Code block: ${lang}>\n${code.trim()}\nCode output:\n${output.trim()}\n<Code block end>`
        )
        .trim();
    },
  },
  {
    id: "mistral",
    name: "Mistral",
    tier: "free",
    url: "https://chat.mistral.ai/chat",
    // ProseMirror contenteditable editor
    inputSelector: ".ProseMirror",
    sendSelector: 'button[aria-label="Send"]',
    // Target the inner text container — the outer assistant div has empty textContent
    // during the initial render (avatar only), so the debounce never fires on it.
    responseSelector: '[data-message-author-role="assistant"] [data-testid="text-message-part"]',
  },
  {
    id: "claude",
    name: "Claude",
    tier: "all",
    // /new starts a fresh chat; redirects to login if no session exists.
    url: "https://claude.ai/new",
    // ProseMirror contenteditable editor (the visible composer, not the hidden clipboard).
    inputSelector: 'div[contenteditable="true"].ProseMirror',
    sendSelector: 'button[aria-label="Send message"]',
    // font-claude-response wraps the rendered answer and excludes sr-only prefix text.
    responseSelector: ".font-claude-response",
    // Present while streaming; disappears when generation completes, so the
    // debounce doesn't resolve mid-answer.
    stopSelector: 'button[aria-label="Stop response"]',
    // Model picker button shows e.g. "Claude Sonnet 4.5".
    modelSelector: 'button[data-testid="model-selector-dropdown"]',
    modelDefault: "default",
  },
];

// Expose for unit testing under Node. No-op in the browser, where `module`
// is undefined and BUILTIN_TARGETS is consumed as a global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { BUILTIN_TARGETS };
}
