/**
 * Multi-tab orchestration for the eval harness.
 * Loaded by sidepanel.html alongside targets.js and sidepanel.js.
 * All chrome.* APIs are available in extension page context.
 *
 * Exported functions (globals, used by sidepanel.js):
 *   runScriptOnAllTargets(targets, turns, onProgress) → Promise<transcript[]>
 *   runScriptOnTarget(target, turns, onProgress)      → Promise<transcript>
 */

// Extra wait after tab status=complete — gives site JS time to initialize.
const TAB_SETTLE_MS = 2000;

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

function openTabAndWaitForLoad(url) {
  return new Promise((resolve, reject) => {
    let tabId = null;

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for ${url} to load (30s)`));
    }, 30000);

    const listener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      setTimeout(() => resolve(tabId), TAB_SETTLE_MS);
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.create({ url, active: true }, (tab) => {
      tabId = tab.id;
      // If the tab was already complete before our listener fired, check now.
      chrome.tabs.get(tabId, (t) => {
        if (t?.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          setTimeout(() => resolve(tabId), TAB_SETTLE_MS);
        }
      });
    });
  });
}

async function injectContentScript(tabId) {
  // The manifest injects core/content.js at document_idle for all URLs, but we
  // reinject here defensively — the IIFE guard in content.js prevents double-init.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["core/content.js"],
  });
}

// ── Per-turn execution ────────────────────────────────────────────────────────

async function runTurnInTab(tabId, prompt, selectorOpts, isFirstTurn = false) {
  // Wrap the injected function in try/catch and return a {ok, result, error}
  // envelope — Chrome's executeScript doesn't reliably surface async rejections
  // via result.error, so we handle error propagation ourselves.
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (prompt, opts) => {
      try {
        if (!window.__harnessRunner) {
          return { ok: false, error: "__harnessRunner not found — content script may not have loaded." };
        }
        const text = await window.__harnessRunner.runTurn(prompt, opts);
        return { ok: true, result: text };
      } catch (err) {
        return { ok: false, error: err.message ?? String(err) };
      }
    },
    args: [prompt, { ...selectorOpts, isFirstTurn }],
  });

  const envelope = results[0]?.result;
  // Also handle the case where Chrome itself puts an error on result.error.
  if (results[0]?.error) {
    throw new Error(results[0].error.message ?? String(results[0].error));
  }
  if (!envelope?.ok) {
    throw new Error(envelope?.error ?? "Empty or null response returned from page.");
  }
  return envelope.result;
}

// ── Target-level runner ───────────────────────────────────────────────────────

async function runScriptOnTarget(target, turns, onProgress, { closeTabs = false } = {}) {
  const selectorOpts = {
    inputSelector:    target.inputSelector    ?? null,
    sendSelector:     target.sendSelector     ?? null,
    responseSelector: target.responseSelector ?? null,
    stopSelector:     target.stopSelector     ?? null,
  };

  onProgress?.({ target, status: "opening", turnIndex: 0 });

  let tabId = null;
  try {
    tabId = await openTabAndWaitForLoad(target.url);
    await injectContentScript(tabId);

    const completedTurns = [];

    for (let i = 0; i < turns.length; i++) {
      onProgress?.({ target, status: "running", turnIndex: i });
      let response = await runTurnInTab(tabId, turns[i].prompt, selectorOpts, i === 0);
      // Apply per-target post-processing (e.g. stripping timestamps).
      // responseClean is a plain function in targets.js, not serialisable to JSON,
      // so we apply it here in the orchestrator after the script returns.
      if (typeof target.responseClean === "function" && response) {
        response = target.responseClean(response);
      }
      completedTurns.push({ prompt: turns[i].prompt, response });
    }

    return { target, turns: completedTurns };
  } finally {
    if (tabId != null && closeTabs) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── All-targets runner ────────────────────────────────────────────────────────

async function runScriptOnAllTargets(targets, turns, onProgress, opts = {}) {
  const { onTargetDone, ...runOpts } = opts;
  const results = [];

  for (const target of targets) {
    try {
      const result = await runScriptOnTarget(target, turns, onProgress, runOpts);
      onProgress?.({ target, status: "done", turnIndex: turns.length - 1 });
      results.push(result);
      onTargetDone?.(result);
    } catch (err) {
      onProgress?.({ target, status: "error", turnIndex: 0, error: err.message });
      const result = { target, turns: [], error: err.message };
      results.push(result);
      onTargetDone?.(result);
    }
  }

  return results;
}
