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

  // Button texts that indicate acceptance (case-insensitive, exact match or prefix).
  // Keep this list specific to avoid accidentally clicking unrelated buttons.
  const ACCEPT_TEXTS = [
    "accept and continue",
    "accept all cookies",
    "accept all",
    "i agree to the",
    "i agree",
    "agree and continue",
    "agree",
    "accept",
    "got it",
  ];

  async function dismissDialogs() {
    // Give any lazy-rendered modals a moment to appear.
    await new Promise((r) => setTimeout(r, 600));

    // First look for buttons inside a visible modal/dialog overlay.
    // Fall back to scanning all buttons if no modal wrapper is detected.
    const modalRoot =
      document.querySelector('[role="dialog"], [role="alertdialog"], dialog') ||
      [...document.querySelectorAll("*")].find((el) => {
        const s = window.getComputedStyle(el);
        return (
          (s.position === "fixed" || s.position === "absolute") &&
          parseInt(s.zIndex, 10) > 50 &&
          el.offsetWidth > 200 &&
          el.offsetHeight > 80
        );
      }) ||
      document.body;

    const candidates = [...modalRoot.querySelectorAll("button, [role='button']")];
    for (const btn of candidates) {
      const text = (btn.innerText ?? btn.textContent ?? "").trim().toLowerCase();
      if (ACCEPT_TEXTS.some((t) => text === t || text.startsWith(t))) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          btn.click();
          await new Promise((r) => setTimeout(r, 600));
          return true;
        }
      }
    }
    return false;
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  // Polls up to 3s for the send button to be present and enabled.
  // Gemini (and some other sites) briefly remove or disable the button after
  // a response completes while the UI resets, so a single synchronous check
  // fails on turn 2+.
  async function clickSend(sendSelector) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const btn = findSendButton(sendSelector);
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("__harnessRunner: no send button found");
  }

  // ── Response detection ────────────────────────────────────────────────────

  function waitForResponse(opts = {}) {
    const { responseSelector, stopSelector, timeoutMs = 90000 } = opts;
    return new Promise((resolve, reject) => {
      const textBefore = document.body.textContent;
      // Snapshot the current last-response text so turn 2+ doesn't treat the
      // already-rendered previous response as a new one starting the debounce.
      const responseBefore = responseSelector ? (getLastResponseText(responseSelector) ?? "") : null;
      let lastText = "";
      let debounceTimer = null;
      let hasStarted = false;
      let finished = false;
      let stopSeen = false; // true once we've observed the stopSelector element in the DOM

      const finish = () => {
        if (finished) return;
        // Only gate on the stop element if we've actually seen it — a wrong
        // selector would otherwise make this check always pass and block forever.
        if (stopSelector && stopSeen && document.querySelector(stopSelector)) return;
        finished = true;
        clearTimeout(debounceTimer);
        clearTimeout(overallTimer);
        observer.disconnect();
        if (responseSelector) {
          resolve(getLastResponseText(responseSelector) ?? null);
        } else {
          const newContent = document.body.textContent.replace(textBefore, "").trim();
          resolve(newContent || document.body.textContent.trim());
        }
      };

      const onMutation = () => {
        if (stopSelector) {
          const stopPresent = !!document.querySelector(stopSelector);
          if (stopPresent) stopSeen = true;
          // Stop element disappeared after being seen → generation is complete.
          if (stopSeen && !stopPresent && hasStarted) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(finish, 200);
            return;
          }
        }

        const targeted = responseSelector
          ? getLastResponseText(responseSelector)
          : null;
        const current = targeted ?? (responseSelector ? null : document.body.textContent);

        if (current === null || current === lastText) return;

        if (!hasStarted && current !== (responseSelector ? responseBefore : textBefore)) {
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

      onMutation();
    });
  }

  // ── High-level runner ─────────────────────────────────────────────────────

  async function runTurn(prompt, opts = {}) {
    const { inputSelector, sendSelector, responseSelector, stopSelector, isFirstTurn } = opts;
    if (isFirstTurn) await dismissDialogs();
    injectText(prompt, inputSelector);
    await new Promise((r) => setTimeout(r, 250)); // Let React/Vue digest the input event.
    await clickSend(sendSelector);
    return waitForResponse({ responseSelector, stopSelector });
  }

  // ── Model capture ─────────────────────────────────────────────────────────

  function captureModel(selector, extractPattern) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el) return null;
    // Prefer visible text content; fall back to aria-label for elements where
    // the model name is encoded there (e.g. Gemini's "currently Flash").
    const text = (el.textContent.trim() || el.getAttribute("aria-label") || "").trim();
    if (!text) return null;
    if (extractPattern) {
      const match = text.match(new RegExp(extractPattern));
      return match ? match[1].trim() : null;
    }
    return text;
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
    captureModel,
  };
})();
