/**
 * Sidepanel logic — multi-target transcript collection.
 *
 * Flow:
 *   1. Researcher loads an eval script (.json) via the file picker.
 *   2. They select one or more targets and click "Run All Targets".
 *   3. runScriptOnAllTargets() (orchestrator.js) opens a tab per target,
 *      sequentially injects each prompt, captures responses, and closes the tab.
 *   4. "💾 Save transcript" downloads the full transcript as JSON.
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) =>
  typeof document !== "undefined" ? document.getElementById(id) : null;

const scriptNameEl = $("script-name");
const loadScriptBtn = $("load-script-btn");
const scriptFileInput = $("script-file-input");
const registrySelect = $("eval-registry-select");
const runBtn = $("run-btn");
const progressSection = $("progress-section");
const progressText = $("progress-text");
const resultsSection = $("results-section");
const saveBtn = $("save-btn");
const errorMsg = $("error-msg");
const statusMsg = $("status-msg");

// ── State ─────────────────────────────────────────────────────────────────────

let currentScript = null; // normalized eval script object
let transcripts = []; // [{target, samples:[{messages,turns}], error?}]
let currentRun = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function init() {
  renderTargets();

  // File picker trigger
  loadScriptBtn.addEventListener("click", () => scriptFileInput.click());
  scriptFileInput.addEventListener("change", onFileSelected);

  runBtn.addEventListener("click", onRunClick);
  saveBtn.addEventListener("click", saveTranscript);
  registrySelect.addEventListener("change", () =>
    loadRegistryEval(registrySelect.value),
  );

  initEditor();
  loadRegistry();
}

// Reads sample-evals/index.json, populates the dropdown, and loads the first
// bundled eval by default. Failing softly — the user can still Load/New a script.
async function loadRegistry() {
  try {
    const url = chrome.runtime.getURL("sample-evals/index.json");
    const res = await fetch(url);
    const index = await res.json();
    const evals = Array.isArray(index.evals) ? index.evals : [];
    if (!evals.length) return;

    registrySelect.innerHTML = "";
    evals.forEach((entry) => {
      const opt = document.createElement("option");
      opt.value = entry.file;
      opt.textContent = entry.name || entry.id || entry.file;
      registrySelect.appendChild(opt);
    });
    registrySelect.classList.remove("hidden");
    await loadRegistryEval(evals[0].file);
  } catch (_) {
    // Non-fatal — registry is optional; hide the dropdown if it can't load.
    registrySelect.classList.add("hidden");
  }
}

async function loadRegistryEval(file) {
  if (!file) return;
  try {
    const url = chrome.runtime.getURL(`sample-evals/${file}`);
    const res = await fetch(url);
    const parsed = await res.json();
    currentScript = normalizeEvalScript(parsed);
    scriptNameEl.textContent = currentScript.name || file;
    scriptNameEl.className = "script-name loaded";
    runBtn.disabled = false;
    clearError();
  } catch (err) {
    showError(`Could not load "${file}": ${err.message}`);
  }
}

// ── Script loading ────────────────────────────────────────────────────────────

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      currentScript = normalizeEvalScript(parsed);
      scriptNameEl.textContent = currentScript.name || file.name;
      scriptNameEl.className = "script-name loaded";
      runBtn.disabled = false;
      registrySelect.selectedIndex = -1; // loaded script isn't a registry entry
      clearError();
    } catch (err) {
      showError(`Invalid script: ${err.message}`);
      currentScript = null;
      scriptNameEl.textContent = "No script loaded";
      scriptNameEl.className = "script-name";
      runBtn.disabled = true;
    }
  };
  reader.readAsText(file);

  // Reset so the same file can be re-loaded if needed.
  e.target.value = "";
}

// ── Targets ───────────────────────────────────────────────────────────────────

// Renders every target. "all"-tier rows (login-required models) are marked with
// an asterisk — explained by the "*Requires login" note — and default to off.
function renderTargets() {
  const container = $("targets-list");
  container.innerHTML = "";
  BUILTIN_TARGETS.forEach((t) => {
    const requiresLogin = (t.tier ?? "free") === "all";
    const label = document.createElement("label");
    label.className = "target-row";
    label.innerHTML = `
      <input type="checkbox" name="target" value="${t.id}" ${requiresLogin ? "" : "checked"} />
      ${t.name}${requiresLogin ? "*" : ""}
    `;
    container.appendChild(label);
  });
}

function getSelectedTargets() {
  const boxes = document.querySelectorAll('input[name="target"]:checked');
  return [...boxes]
    .map((cb) => BUILTIN_TARGETS.find((t) => t.id === cb.value))
    .filter(Boolean);
}

// ── Run ───────────────────────────────────────────────────────────────────────

async function onRunClick() {
  clearError();
  hideStatus();

  if (!currentScript) return showError("Load a script first.");

  const targets = getSelectedTargets();
  if (!targets.length) return showError("Check at least one target.");

  transcripts = [];
  const runStartedAt = new Date();
  currentRun = {
    id: `run_${runStartedAt.toISOString().replace(/[:.]/g, "-")}`,
    eval_id: currentScript.id ?? null,
    eval_name: currentScript.name ?? null,
    started_at: runStartedAt.toISOString(),
    completed_at: null,
    duration_ms: null,
  };

  runBtn.disabled = true;
  saveBtn.classList.add("hidden");
  progressSection.classList.remove("hidden");
  progressText.textContent = "Starting…";

  resultsSection.innerHTML = "";
  targets.forEach((t) =>
    resultsSection.appendChild(buildTargetCard(t, "running")),
  );
  resultsSection.classList.remove("hidden");

  try {
    const closeTabs = document.getElementById("close-tabs-toggle").checked;
    const results = await runScriptOnAllTargets(
      targets,
      currentScript.samples,
      onProgress,
      { closeTabs, onTargetDone: (r) => fillTargetCard(r) },
    );
    transcripts = results;
  } catch (err) {
    showError(err.message);
  } finally {
    if (currentRun) {
      const completedAt = new Date();
      currentRun.completed_at = completedAt.toISOString();
      currentRun.duration_ms = completedAt.getTime() - runStartedAt.getTime();
    }
    progressSection.classList.add("hidden");
    runBtn.disabled = false;
  }

  saveBtn.classList.remove("hidden");
}

// ── Progress callback ─────────────────────────────────────────────────────────

function onProgress({ target, sample, status, turnIndex }) {
  const sampleLabel = sample?.id ? ` / ${sample.id}` : "";
  const total = sample?.input?.filter((message) => message.role === "user").length ?? "?";
  switch (status) {
    case "opening":
      progressText.textContent = `Opening ${target.name}${sampleLabel}…`;
      break;
    case "running":
      progressText.textContent = `${target.name}${sampleLabel} — Turn ${
        turnIndex + 1
      } / ${total}…`;
      break;
    case "done":
      progressText.textContent = `${target.name} complete.`;
      break;
    case "error":
      progressText.textContent = `${target.name} — error`;
      break;
  }
}

// ── Target card construction ──────────────────────────────────────────────────

function buildTargetCard(target, status) {
  const card = document.createElement("div");
  card.className = "card target-card";
  card.id = `target-card-${target.id}`;

  const statusHtml =
    status === "running"
      ? '<span class="spinner" style="width:10px;height:10px;"></span> Running…'
      : "";

  card.innerHTML = `
    <div class="target-header">
      <span class="target-name">${target.name}</span>
      <span class="target-status" id="target-status-${target.id}">${statusHtml}</span>
    </div>
    <div class="target-turns" id="target-turns-${target.id}">
      <div style="font-size:12px;color:#aaa;">Waiting…</div>
    </div>
  `;
  return card;
}

function fillTargetCard(result) {
  const target = result.target;
  const statusEl = $(`target-status-${target.id}`);
  const turnsEl = $(`target-turns-${target.id}`);
  if (!statusEl || !turnsEl) return;

  if (result.status === "error") {
    statusEl.className = "target-status error";
    statusEl.textContent = "Error";
    turnsEl.innerHTML = `<div class="error-text">${escHtml(
      result.error,
    )}</div>`;
    return;
  }

  statusEl.className = "target-status done";
  statusEl.textContent = result.error
    ? "✓ Partial"
    : result.model
      ? `✓ ${result.model}`
      : "✓ Done";
  turnsEl.innerHTML = "";
  const samples = result.samples?.length
    ? result.samples
    : [{ sample: { id: null }, turns: result.turns ?? [], error: result.error }];
  samples.forEach((sampleResult, sampleIndex) => {
    if (samples.length > 1 || sampleResult.sample?.id) {
      const label = document.createElement("div");
      label.className = "turn-number";
      label.textContent = `Sample ${sampleResult.sample?.id ?? sampleIndex + 1}`;
      turnsEl.appendChild(label);
    }
    if (sampleResult.error) {
      const error = document.createElement("div");
      error.className = "error-text";
      error.textContent = sampleResult.error;
      turnsEl.appendChild(error);
      return;
    }
    sampleResult.turns.forEach((turn, i) =>
      turnsEl.appendChild(buildTurnBlock(target, turn, i)),
    );
  });
}

function buildTurnBlock(target, turn, turnIndex) {
  const block = document.createElement("div");
  block.className = "turn-block";
  block.id = `turn-${target.id}-${turnIndex}`;

  block.innerHTML = `
    <div class="turn-number">Turn ${turnIndex + 1}</div>
    <div class="prompt-text">${escHtml(turn.prompt)}</div>
    <div class="response-text">${renderMarkdown(turn.response)}</div>
  `;
  return block;
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return "";

  const lines = text.split("\n");
  let html = "";
  let inOl = false,
    inUl = false,
    inCode = false,
    codeBuf = "";

  const closeList = () => {
    if (inOl) {
      html += "</ol>";
      inOl = false;
    }
    if (inUl) {
      html += "</ul>";
      inUl = false;
    }
  };

  const inline = (s) =>
    escHtml(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>");

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        closeList();
        html += `<pre><code>${escHtml(codeBuf)}</code></pre>`;
        codeBuf = "";
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf += (codeBuf ? "\n" : "") + line;
      continue;
    }

    const hMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (hMatch) {
      closeList();
      const lv = Math.min(hMatch[1].length + 3, 6);
      html += `<h${lv}>${inline(hMatch[2])}</h${lv}>`;
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (inUl) {
        html += "</ul>";
        inUl = false;
      }
      if (!inOl) {
        html += "<ol>";
        inOl = true;
      }
      html += `<li>${inline(olMatch[1])}</li>`;
      continue;
    }

    const ulMatch = line.match(/^[-*•]\s+(.*)/);
    if (ulMatch) {
      if (inOl) {
        html += "</ol>";
        inOl = false;
      }
      if (!inUl) {
        html += "<ul>";
        inUl = true;
      }
      html += `<li>${inline(ulMatch[1])}</li>`;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      html += "<br>";
      continue;
    }

    closeList();
    html += inline(line) + "<br>";
  }

  if (inCode) html += `<pre><code>${escHtml(codeBuf)}</code></pre>`;
  closeList();
  return html.replace(/^(<br>)+|(<br>)+$/g, "");
}

// ── Save transcript ───────────────────────────────────────────────────────────

function saveTranscript() {
  const manifest = chrome.runtime.getManifest?.() ?? {};
  const data = {
    schema_version: "strawbery.run.v1",
    run: currentRun ?? {
      id: `run_${new Date().toISOString().replace(/[:.]/g, "-")}`,
      eval_id: currentScript?.id ?? null,
      eval_name: currentScript?.name ?? null,
      started_at: null,
      completed_at: new Date().toISOString(),
      duration_ms: null,
    },
    eval: {
      schema_version: currentScript?.schema_version ?? null,
      id: currentScript?.id ?? null,
      name: currentScript?.name ?? null,
      description: currentScript?.description ?? null,
      tags: currentScript?.tags ?? [],
      metadata: currentScript?.metadata ?? {},
    },
    environment: {
      extension_version: manifest.version ?? null,
      user_agent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    },
    results: transcripts.flatMap((r) => {
      const sampleResults = r.samples?.length
        ? r.samples
        : [
            {
              sample: null,
              final_url: null,
              model: r.model ?? null,
              status: r.status ?? "error",
              started_at: r.started_at ?? null,
              completed_at: r.completed_at ?? null,
              duration_ms: r.duration_ms ?? null,
              messages: [],
              turns: r.turns ?? [],
              error: r.error ?? null,
            },
          ];

      return sampleResults.map((sampleResult) => ({
        sample_id: sampleResult.sample?.id ?? null,
        target: {
          id: r.target.id,
          name: r.target.name,
          url: r.target.url,
          final_url: sampleResult.final_url ?? null,
          model_version: sampleResult.model ?? r.model ?? null,
          metadata: r.target.metadata ?? {},
        },
        status: sampleResult.status ?? (sampleResult.error ? "error" : "completed"),
        started_at: sampleResult.started_at ?? null,
        completed_at: sampleResult.completed_at ?? null,
        duration_ms: sampleResult.duration_ms ?? null,
        messages: sampleResult.messages ?? [],
        turns: sampleResult.turns ?? [],
        target_output: (sampleResult.messages ?? [])
          .filter((message) => message.role === "assistant")
          .map((message) => message.content)
          .join("\n\n"),
        expected_output: sampleResult.sample?.target ?? null,
        metadata: sampleResult.sample?.metadata ?? {},
        error: sampleResult.error ?? null,
      }));
    }),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eval-${currentScript?.id ?? "transcript"}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Eval schema ──────────────────────────────────────────────────────────────

function normalizeEvalScript(script) {
  if (!script || typeof script !== "object" || Array.isArray(script)) {
    throw new Error("Script must be a JSON object.");
  }

  const samples = Array.isArray(script.samples)
    ? script.samples.map(normalizeSample)
    : legacyTurnsToSamples(script.turns);

  if (!samples.length) {
    throw new Error('Script must include a non-empty "samples" array or legacy "turns" array.');
  }

  return {
    schema_version: script.schema_version ?? "strawbery.eval.v1",
    id: script.id ?? null,
    name: script.name ?? null,
    description: script.description ?? null,
    tags: Array.isArray(script.tags) ? script.tags : [],
    metadata: script.metadata && typeof script.metadata === "object" ? script.metadata : {},
    samples,
  };
}

function legacyTurnsToSamples(turns) {
  if (!Array.isArray(turns)) {
    throw new Error('Script must include a "samples" array or legacy "turns" array.');
  }
  return [
    normalizeSample({
      id: "default",
      input: turns.map((turn) => ({
        role: "user",
        content: turn?.prompt ?? turn?.content ?? "",
      })),
    }),
  ];
}

function normalizeSample(sample, index = 0) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    throw new Error("Each sample must be an object.");
  }

  const input = normalizeInput(sample.input);
  const userMessages = input.filter((message) => message.role === "user");
  if (!userMessages.length) {
    throw new Error("Each sample must include at least one user input message.");
  }

  return {
    id: sample.id ?? `sample-${index + 1}`,
    input,
    target: sample.target ?? sample.expected_output ?? null,
    metadata: sample.metadata && typeof sample.metadata === "object" ? sample.metadata : {},
  };
}

function normalizeInput(input) {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (!Array.isArray(input)) {
    throw new Error('Each sample "input" must be a string or array of chat messages.');
  }

  return input.map((message) => {
    if (typeof message === "string") {
      return { role: "user", content: message };
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error("Each input message must be a string or object.");
    }
    const role = message.role ?? "user";
    if (!["system", "user", "assistant", "tool"].includes(role)) {
      throw new Error(`Unsupported message role: ${role}`);
    }
    if (typeof message.content !== "string") {
      throw new Error("Each input message must include string content.");
    }
    return {
      role,
      content: message.content,
      ...(message.name ? { name: message.name } : {}),
      ...(message.metadata && typeof message.metadata === "object"
        ? { metadata: message.metadata }
        : {}),
    };
  });
}

// ── Editor modal ─────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function initEditor() {
  $("new-script-btn").addEventListener("click", openEditor);
  $("editor-cancel").addEventListener("click", closeEditor);
  $("editor-add-turn").addEventListener("click", () => appendTurn(""));
  $("editor-save").addEventListener("click", commitEditor);
  $("editor-overlay").addEventListener("click", (e) => {
    if (e.target === $("editor-overlay")) closeEditor();
  });
  $("editor-name").addEventListener("input", () => {
    $("editor-id").value = slugify($("editor-name").value);
  });
}

function openEditor() {
  $("editor-name").value = "";
  $("editor-id").value = "";
  $("editor-err").textContent = "";
  $("editor-turns").innerHTML = "";
  appendTurn("");
  $("editor-overlay").classList.remove("hidden");
  $("editor-name").focus();
}

function closeEditor() {
  $("editor-overlay").classList.add("hidden");
}

function appendTurn(value) {
  const turns = $("editor-turns");
  const idx = turns.children.length;
  const row = document.createElement("div");
  row.className = "ed-turn";
  row.dataset.idx = idx;
  row.innerHTML = `
    <span class="ed-turn-num">${idx + 1}.</span>
    <textarea placeholder="Enter prompt…" rows="2">${escHtml(value)}</textarea>
    <button class="ed-turn-del" title="Remove">×</button>
  `;
  row.querySelector(".ed-turn-del").addEventListener("click", () => {
    row.remove();
    renumberTurns();
  });
  turns.appendChild(row);
}

function renumberTurns() {
  [...$("editor-turns").children].forEach((row, i) => {
    row.querySelector(".ed-turn-num").textContent = `${i + 1}.`;
    row.dataset.idx = i;
  });
}

async function commitEditor() {
  const name = $("editor-name").value.trim();
  const id = $("editor-id").value.trim() || slugify(name);
  const errEl = $("editor-err");
  errEl.textContent = "";

  if (!name) {
    errEl.textContent = "Name is required.";
    return;
  }

  const prompts = [...$("editor-turns").querySelectorAll("textarea")]
    .map((ta) => ta.value.trim())
    .filter(Boolean);

  if (!prompts.length) {
    errEl.textContent = "Add at least one turn.";
    return;
  }

  const script = {
    schema_version: "strawbery.eval.v1",
    id,
    name,
    samples: [
      {
        id: "default",
        input: prompts.map((p) => ({ role: "user", content: p })),
      },
    ],
  };
  const json = JSON.stringify(script, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  try {
    const fh = await window.showSaveFilePicker({
      suggestedName: `${id}.json`,
      startIn: "documents",
      types: [
        { description: "JSON", accept: { "application/json": [".json"] } },
      ],
    });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  } catch (err) {
    if (err.name === "AbortError") return;
    // Fallback: blob download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Load the new script directly into the sidebar.
  currentScript = normalizeEvalScript(script);
  scriptNameEl.textContent = name;
  scriptNameEl.className = "script-name loaded";
  runBtn.disabled = false;
  registrySelect.selectedIndex = -1; // new script isn't a registry entry
  closeEditor();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}
function clearError() {
  errorMsg.textContent = "";
  errorMsg.classList.add("hidden");
}
function showStatus(msg) {
  statusMsg.textContent = msg;
  statusMsg.classList.remove("hidden");
}
function hideStatus() {
  statusMsg.classList.add("hidden");
}

// ── Start ─────────────────────────────────────────────────────────────────────

// Only bootstrap in the browser; under Node (tests) there is no DOM.
if (typeof document !== "undefined") init();

// Expose pure helpers for unit testing under Node. No-op in the browser, where
// `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderMarkdown, escHtml, slugify, normalizeEvalScript };
}
