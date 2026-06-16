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
const runBtn = $("run-btn");
const progressSection = $("progress-section");
const progressText = $("progress-text");
const resultsSection = $("results-section");
const saveBtn = $("save-btn");
const errorMsg = $("error-msg");
const statusMsg = $("status-msg");

// ── State ─────────────────────────────────────────────────────────────────────

let currentScript = null; // parsed eval script object
let transcripts = []; // [{target, turns:[{prompt,response}], error?}]

// ── Bootstrap ─────────────────────────────────────────────────────────────────

function init() {
  renderTargets();

  // File picker trigger
  loadScriptBtn.addEventListener("click", () => scriptFileInput.click());
  scriptFileInput.addEventListener("change", onFileSelected);

  runBtn.addEventListener("click", onRunClick);
  saveBtn.addEventListener("click", saveTranscript);

  initEditor();
  loadDefaultScript();
}

async function loadDefaultScript() {
  try {
    const url = chrome.runtime.getURL("sample-evals/strawbery.json");
    const res = await fetch(url);
    const parsed = await res.json();
    if (!parsed.turns || !Array.isArray(parsed.turns)) return;
    currentScript = parsed;
    scriptNameEl.textContent = parsed.name || "strawbery.json";
    scriptNameEl.className = "script-name loaded";
    runBtn.disabled = false;
  } catch (_) {
    // Non-fatal — user can still load a script manually.
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
      if (!parsed.turns || !Array.isArray(parsed.turns)) {
        throw new Error('Script must have a "turns" array.');
      }
      currentScript = parsed;
      scriptNameEl.textContent = parsed.name || file.name;
      scriptNameEl.className = "script-name loaded";
      runBtn.disabled = false;
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

function renderTargets() {
  const container = $("targets-list");
  container.innerHTML = "";
  BUILTIN_TARGETS.forEach((t) => {
    const label = document.createElement("label");
    label.className = "target-row";
    label.innerHTML = `
      <input type="checkbox" name="target" value="${t.id}" checked />
      ${t.name}
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
      currentScript.turns,
      onProgress,
      { closeTabs, onTargetDone: (r) => fillTargetCard(r) },
    );
    transcripts = results;
  } catch (err) {
    showError(err.message);
  } finally {
    progressSection.classList.add("hidden");
    runBtn.disabled = false;
  }

  saveBtn.classList.remove("hidden");
}

// ── Progress callback ─────────────────────────────────────────────────────────

function onProgress({ target, status, turnIndex }) {
  const total = currentScript?.turns.length ?? "?";
  switch (status) {
    case "opening":
      progressText.textContent = `Opening ${target.name}…`;
      break;
    case "running":
      progressText.textContent = `${target.name} — Turn ${
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

  if (result.error) {
    statusEl.className = "target-status error";
    statusEl.textContent = "Error";
    turnsEl.innerHTML = `<div class="error-text">${escHtml(
      result.error,
    )}</div>`;
    return;
  }

  statusEl.className = "target-status done";
  statusEl.textContent = result.model ? `✓ ${result.model}` : "✓ Done";
  turnsEl.innerHTML = "";
  result.turns.forEach((turn, i) =>
    turnsEl.appendChild(buildTurnBlock(target, turn, i)),
  );
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
  const data = {
    script_id: currentScript?.id ?? null,
    script_name: currentScript?.name ?? null,
    run_timestamp: new Date().toISOString(),
    targets: transcripts.map((r) => ({
      id: r.target.id,
      name: r.target.name,
      model_version: r.model ?? null,
      error: r.error ?? null,
      turns: r.turns.map((t) => ({
        timestamp: new Date().toISOString(),
        prompt: t.prompt,
        response: t.response,
      })),
    })),
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

  const script = { id, name, turns: prompts.map((p) => ({ prompt: p })) };
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
  currentScript = script;
  scriptNameEl.textContent = name;
  scriptNameEl.className = "script-name loaded";
  runBtn.disabled = false;
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
  module.exports = { renderMarkdown, escHtml, slugify };
}
