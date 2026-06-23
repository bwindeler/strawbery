"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BUILTIN_TARGETS } = require("../targets.js");

const byId = (id) => BUILTIN_TARGETS.find((t) => t.id === id);

test("BUILTIN_TARGETS: every target has id, name, url and required selectors", () => {
  for (const t of BUILTIN_TARGETS) {
    assert.ok(t.id, `missing id on ${JSON.stringify(t)}`);
    assert.ok(t.name, `missing name on ${t.id}`);
    assert.match(t.url, /^https:\/\//, `${t.id} url should be https`);
    assert.ok(t.inputSelector, `${t.id} missing inputSelector`);
    assert.ok(t.sendSelector, `${t.id} missing sendSelector`);
    assert.ok(t.responseSelector, `${t.id} missing responseSelector`);
  }
});

test("BUILTIN_TARGETS: ids are unique", () => {
  const ids = BUILTIN_TARGETS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("BUILTIN_TARGETS: every target declares a known tier", () => {
  for (const t of BUILTIN_TARGETS) {
    assert.ok(["free", "all"].includes(t.tier), `${t.id} has invalid tier: ${t.tier}`);
  }
});

test("BUILTIN_TARGETS: Claude is an 'all'-tier (login-required) target", () => {
  const claude = byId("claude");
  assert.ok(claude, "claude target missing");
  assert.equal(claude.tier, "all");
  assert.match(claude.url, /claude\.ai/);
});

// ── Gemini responseClean ──────────────────────────────────────────────────────

const clean = byId("gemini").responseClean;

test("gemini.responseClean is a function", () => {
  assert.equal(typeof clean, "function");
});

test("gemini.responseClean strips the 'Gemini said' prefix (case-insensitive)", () => {
  assert.equal(clean("Gemini said\n\nHello there"), "Hello there");
  assert.equal(clean("GEMINI SAID Hello"), "Hello");
});

test("gemini.responseClean strips 'Show code' affordance text", () => {
  assert.equal(clean("Show code print(1)"), "print(1)");
});

test("gemini.responseClean strips the analysis/query-successful boilerplate", () => {
  assert.equal(clean("Analysis\nAnalysis\nQuery successful\nResult"), "Result");
});

test("gemini.responseClean reshapes a code-output pair into a structured block", () => {
  const input = "Python\nprint('hi')\nCode output\nhi";
  const expected =
    "<Code block: Python>\nprint('hi')\nCode output:\nhi\n<Code block end>";
  assert.equal(clean(input), expected);
});

test("gemini.responseClean leaves prose without a code-output pair untouched", () => {
  assert.equal(clean("Just a normal answer."), "Just a normal answer.");
});

test("gemini.responseClean trims surrounding whitespace", () => {
  assert.equal(clean("   spaced out   "), "spaced out");
});
