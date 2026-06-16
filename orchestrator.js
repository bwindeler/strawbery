/**
 * Multi-tab orchestration for the eval harness.
 * Loaded by sidepanel.html alongside targets.js and sidepanel.js.
 * All chrome.* APIs are available in extension page context.
 *
 * Exported functions (globals, used by sidepanel.js):
 *   runScriptOnAllTargets(targets, samples, onProgress) → Promise<transcript[]>
 *   runScriptOnTarget(target, samples, onProgress)      → Promise<transcript>
 */

// Extra wait after tab status=complete — gives site JS time to initialize.
const TAB_SETTLE_MS = 2000;

function isoNow() {
  return new Date().toISOString();
}

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

async function getTabUrl(tabId) {
  try {
    return (await chrome.tabs.get(tabId))?.url ?? null;
  } catch (_) {
    return null;
  }
}

async function runSampleOnTarget(target, sample, onProgress, { closeTabs = false } = {}) {
  const selectorOpts = {
    inputSelector:    target.inputSelector    ?? null,
    sendSelector:     target.sendSelector     ?? null,
    responseSelector: target.responseSelector ?? null,
    stopSelector:     target.stopSelector     ?? null,
  };

  onProgress?.({ target, sample, status: "opening", turnIndex: 0 });

  let tabId = null;
  const completedTurns = [];
  const messages = [];
  let finalUrl = null;
  let model = null;
  const startedAt = isoNow();
  const startedMs = Date.now();

  try {
    tabId = await openTabAndWaitForLoad(target.url);
    finalUrl = await getTabUrl(tabId);
    await injectContentScript(tabId);

    const modelResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector, extractPattern) => {
        try { return window.__harnessRunner?.captureModel(selector, extractPattern) ?? null; }
        catch (_) { return null; }
      },
      args: [target.modelSelector ?? null, target.modelExtractPattern ?? null],
    });
    model = modelResults[0]?.result ?? target.modelDefault ?? null;

    const userTurns = sample.input.filter((message) => message.role === "user");

    for (let i = 0; i < userTurns.length; i++) {
      const prompt = userTurns[i].content;
      onProgress?.({ target, sample, status: "running", turnIndex: i });
      const promptAt = isoNow();
      const responseStartedMs = Date.now();
      let response = await runTurnInTab(tabId, prompt, selectorOpts, i === 0);
      // Apply per-target post-processing (e.g. stripping timestamps).
      // responseClean is a plain function in targets.js, not serialisable to JSON,
      // so we apply it here in the orchestrator after the script returns.
      if (typeof target.responseClean === "function" && response) {
        response = target.responseClean(response);
      }
      const responseAt = isoNow();
      const durationMs = Date.now() - responseStartedMs;
      messages.push({ role: "user", content: prompt, timestamp: promptAt });
      messages.push({
        role: "assistant",
        content: response,
        timestamp: responseAt,
        duration_ms: durationMs,
      });
      completedTurns.push({
        prompt,
        response,
        prompt_timestamp: promptAt,
        response_timestamp: responseAt,
        duration_ms: durationMs,
      });
    }

    const completedAt = isoNow();
    return {
      sample,
      turns: completedTurns,
      messages,
      model,
      final_url: finalUrl,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: Date.now() - startedMs,
      error: null,
    };
  } catch (err) {
    const completedAt = isoNow();
    return {
      sample,
      turns: completedTurns ?? [],
      messages,
      model,
      final_url: finalUrl ?? (tabId == null ? null : await getTabUrl(tabId)),
      status: "error",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: Date.now() - startedMs,
      error: err.message,
    };
  } finally {
    if (tabId != null && closeTabs) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function runScriptOnTarget(target, samples, onProgress, opts = {}) {
  const targetStartedAt = isoNow();
  const targetStartedMs = Date.now();
  const sampleResults = [];

  for (const sample of samples) {
    const sampleResult = await runSampleOnTarget(target, sample, onProgress, opts);
    sampleResults.push(sampleResult);
  }

  const error = sampleResults.find((sample) => sample.error)?.error ?? null;
  const lastModel = [...sampleResults].reverse().find((sample) => sample.model)?.model ?? null;
  const turns = sampleResults.flatMap((sample) => sample.turns);

  return {
    target,
    samples: sampleResults,
    turns,
    model: lastModel,
    status: error ? "partial_error" : "completed",
    started_at: targetStartedAt,
    completed_at: isoNow(),
    duration_ms: Date.now() - targetStartedMs,
    error,
  };
}

// ── All-targets runner ────────────────────────────────────────────────────────

async function runScriptOnAllTargets(targets, samples, onProgress, opts = {}) {
  const { onTargetDone, ...runOpts } = opts;
  const results = [];

  for (const target of targets) {
    try {
      const result = await runScriptOnTarget(target, samples, onProgress, runOpts);
      onProgress?.({ target, status: "done", turnIndex: 0 });
      results.push(result);
      onTargetDone?.(result);
    } catch (err) {
      onProgress?.({ target, status: "error", turnIndex: 0, error: err.message });
      const result = {
        target,
        samples: [],
        turns: [],
        model: null,
        status: "error",
        error: err.message,
      };
      results.push(result);
      onTargetDone?.(result);
    }
  }

  return results;
}
