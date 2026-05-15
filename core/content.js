/**
 * chatbot-eval-core — injectable content script.
 *
 * This file is the shared core library. It lives here temporarily under
 * extension/core/ and will be extracted to its own GitHub repository
 * (chatbot-eval-core) before either extension is published. Both
 * chatbot-eval-batch (Tool 1) and chatbot-eval-consumer (Tool 2) will
 * declare it as a dependency and bundle it at build time.
 *
 * Exposes window.__harnessRunner so the orchestrator/sidepanel can call it via
 * chrome.scripting.executeScript. Runs in the ISOLATED world but has full DOM
 * access, so execCommand and MutationObserver work correctly.
 *
 * All finder functions accept an optional CSS selector override. Pass one from
 * the target definition (targets.js) for precision; omit to fall back to the
 * generic heuristics below.
 */
(function () {
  if (window.__harnessRunner) return;

  // How long to wait after the last DOM mutation before declaring streaming done.
  const STREAM_DONE_DEBOUNCE_MS = 1500;

  // ── Response selectors (generic fallback chain) ───────────────────────────

  const RESPONSE_SELECTORS = [
    // ChatGPT
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
    // Claude.ai (font-claude-response excludes sr-only prefix text)
    ".font-claude-response",
    '[data-testid="assistant-message"]',
    // Gemini
    "model-response .response-content",
    // Generic
    "article",
  ];

  // ── Element finders ───────────────────────────────────────────────────────

  function findInput(selector) {
    if (selector) return document.querySelector(selector);
    // Per-site: replace these heuristics with the exact selector for the target.
    return (
      document.querySelector('[contenteditable="true"]:not([aria-readonly="true"])') ||
      document.querySelector("textarea:not([disabled]):not([readonly])")
    );
  }

  function findSendButton(selector) {
    if (selector) return document.querySelector(selector);
    // Per-site: replace with the exact send-button selector.
    return (
      document.querySelector('button[data-testid*="send"]') ||
      document.querySelector('button[aria-label*="send" i]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[type="submit"]')
    );
  }

  // ── Response text extraction ──────────────────────────────────────────────

  function getLastResponseText(selector) {
    const trySelector = (sel) => {
      // Strip :last-of-type — querySelectorAll + last index is more reliable.
      const stripped = sel.replace(/:last-of-type/g, "");
      const els = document.querySelectorAll(stripped);
      if (!els.length) return null;
      // Use textContent instead of innerText — innerText requires full layout
      // and returns empty in background/inactive tabs on some sites.
      const text = els[els.length - 1].textContent.trim();
      return text || null;
    };

    if (selector) return trySelector(selector);

    for (const sel of RESPONSE_SELECTORS) {
      const text = trySelector(sel);
      if (text) return text;
    }
    return null;
  }

  // ── Text injection ────────────────────────────────────────────────────────

  function injectText(text, inputSelector) {
    const input = findInput(inputSelector);
    if (!input) throw new Error("__harnessRunner: no input element found");
    input.focus();
    // Select all existing text then replace with the prompt.
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, text);
    // Fire an input event so React/Vue state updates.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // ── Dialog / gate dismissal ───────────────────────────────────────────────
  // Called once after page load to click past ToU / cookie-consent dialogs.
  // Tries each selector in order; stops after the first successful click.
  // Returns true if something was dismissed, false if nothing needed clicking.

  const DISMISS_SELECTORS = [
    // Text-match buttons (most reliable across sites)
    // Evaluated via innerText so we catch any element, not just known classes.
    null, // placeholder — handled below via text scan
  ];

  // Button texts that indicate acceptance (case-insensitive).
  const ACCEPT_TEXTS = [
    "accept and continue",
    "accept all",
    "i agree",
    "agree and continue",
    "agree",
    "accept",
    "got it",
    "continue",
    "ok",
  ];

  async function dismissDialogs() {
    // Give any lazy-rendered modals a moment to appear.
    await new Promise((r) => setTimeout(r, 600));

    const buttons = [...document.querySelectorAll("button, [role='button'], a[href='#']")];
    for (const btn of buttons) {
      const text = (btn.innerText ?? btn.textContent ?? "").trim().toLowerCase();
      if (ACCEPT_TEXTS.some((t) => text === t || text.startsWith(t))) {
        // Only click if the button is actually visible.
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          btn.click();
          await new Promise((r) => setTimeout(r, 500));
          return true;
        }
      }
    }
    return false;
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  function clickSend(sendSelector) {
    const btn = findSendButton(sendSelector);
    if (!btn) throw new Error("__harnessRunner: no send button found");
    btn.click();
    return true;
  }

  // ── Response detection ────────────────────────────────────────────────────

  function waitForResponse(opts = {}) {
    const { responseSelector, timeoutMs = 90000 } = opts;
    return new Promise((resolve, reject) => {
      const textBefore = document.body.textContent;
      let lastText = "";
      let debounceTimer = null;
      let hasStarted = false;

      const finish = () => {
        clearTimeout(debounceTimer);
        clearTimeout(overallTimer);
        observer.disconnect();
        // When a specific selector is provided, ONLY accept text from that
        // selector. If it still returns nothing, resolve with null so the
        // caller gets a clean error instead of garbage page-JS content.
        if (responseSelector) {
          resolve(getLastResponseText(responseSelector) ?? null);
        } else {
          const newContent = document.body.textContent.replace(textBefore, "").trim();
          resolve(newContent || document.body.textContent.trim());
        }
      };

      const onMutation = () => {
        const targeted = responseSelector
          ? getLastResponseText(responseSelector)
          : null;
        // When a specific selector is given, only track that element's text.
        // Without a selector, track any body text change.
        const current = targeted ?? (responseSelector ? null : document.body.textContent);

        if (current === null || current === lastText) return;

        // Don't start the debounce until something actually changes from the
        // pre-send state — avoids triggering on pre-existing page activity.
        if (!hasStarted && current !== (responseSelector ? "" : textBefore)) {
          hasStarted = true;
        }
        if (!hasStarted) return;

        lastText = current;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(finish, STREAM_DONE_DEBOUNCE_MS);
      };

      const observer = new MutationObserver(onMutation);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const overallTimer = setTimeout(() => {
        observer.disconnect();
        clearTimeout(debounceTimer);
        reject(new Error(`__harnessRunner: response timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      // Check immediately in case the response is already rendered (cached page).
      onMutation();
    });
  }

  // ── High-level runner ─────────────────────────────────────────────────────

  async function runTurn(prompt, opts = {}) {
    const { inputSelector, sendSelector, responseSelector, isFirstTurn } = opts;
    // On the first turn, try to dismiss any ToU / cookie-consent gate.
    if (isFirstTurn) await dismissDialogs();
    injectText(prompt, inputSelector);
    await new Promise((r) => setTimeout(r, 250)); // Let React/Vue digest the input event.
    clickSend(sendSelector);
    return waitForResponse({ responseSelector });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.__harnessRunner = {
    findInput,
    findSendButton,
    dismissDialogs,
    injectText,
    clickSend,
    waitForResponse,
    runTurn,
  };
})();
