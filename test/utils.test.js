"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { escHtml, slugify } = require("../sidepanel.js");

test("escHtml: escapes &, <, and >", () => {
  assert.equal(escHtml("<a> & </a>"), "&lt;a&gt; &amp; &lt;/a&gt;");
});

test("escHtml: escapes & before < so entities are not double-encoded", () => {
  // The & must be replaced first; otherwise the &lt; from < would become &amp;lt;.
  assert.equal(escHtml("<"), "&lt;");
  assert.equal(escHtml("a & b"), "a &amp; b");
});

test("escHtml: nullish input becomes empty string, not 'null'/'undefined'", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
});

test("escHtml: non-string input is coerced", () => {
  assert.equal(escHtml(42), "42");
});

test("slugify: lowercases and hyphenates", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify: collapses runs of non-alphanumerics into a single hyphen", () => {
  assert.equal(slugify("a   b___c!!!d"), "a-b-c-d");
});

test("slugify: trims leading and trailing separators", () => {
  assert.equal(slugify("  !!Hello!!  "), "hello");
});

test("slugify: keeps digits", () => {
  assert.equal(slugify("Strawberry Eval v2"), "strawberry-eval-v2");
});
