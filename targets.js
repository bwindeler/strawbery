// Built-in evaluation targets. Selectors are tuned for each site's current DOM
// and will need updating as sites change their markup.
//
// Notes on login requirements:
//   ChatGPT — works without login (free tier available)
//   Gemini   — works without login when already on /app; redirects to Google auth if not signed in
//   Mistral  — works without login; anonymous access confirmed on chat.mistral.ai
const BUILTIN_TARGETS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    inputSelector: "#prompt-textarea",
    sendSelector: 'button[data-testid="send-button"]',
    // .markdown uses innerText-hostile CSS in dark mode; textContent works fine
    responseSelector: '[data-message-author-role="assistant"] .markdown',
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    // Gemini uses a Quill editor; .ql-clipboard is a hidden div — exclude it
    inputSelector: ".ql-editor:not(.ql-clipboard)",
    sendSelector: 'button[aria-label="Send message"]',
    // model-response .model-response-text excludes the visually-hidden "Gemini said" H2
    responseSelector: "model-response .model-response-text",
  },
  {
    id: "mistral",
    name: "Mistral",
    url: "https://chat.mistral.ai/chat",
    // ProseMirror contenteditable editor
    inputSelector: ".ProseMirror",
    sendSelector: 'button[aria-label="Send"]',
    // Target the inner text container — the outer assistant div has empty textContent
    // during the initial render (avatar only), so the debounce never fires on it.
    responseSelector: '[data-message-author-role="assistant"] [data-testid="text-message-part"]',
  },
];
