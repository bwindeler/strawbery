"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderMarkdown } = require("../sidepanel.js");

test("renderMarkdown: empty / nullish input returns empty string", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(null), "");
  assert.equal(renderMarkdown(undefined), "");
});

test("renderMarkdown: plain text is HTML-escaped", () => {
  assert.equal(renderMarkdown("a < b & c"), "a &lt; b &amp; c");
});

test("renderMarkdown: does not leave leading/trailing <br>", () => {
  // A single line of text should not be wrapped in stray <br> tags.
  assert.equal(renderMarkdown("hello"), "hello");
});

test("renderMarkdown: blank lines become <br> between paragraphs", () => {
  assert.equal(renderMarkdown("a\n\nb"), "a<br><br>b");
});

test("renderMarkdown: inline bold, italic, and code", () => {
  assert.equal(renderMarkdown("**bold**"), "<strong>bold</strong>");
  assert.equal(renderMarkdown("*it*"), "<em>it</em>");
  assert.equal(renderMarkdown("_it_"), "<em>it</em>");
  assert.equal(renderMarkdown("`x`"), "<code>x</code>");
});

test("renderMarkdown: inline code contents are still escaped", () => {
  assert.equal(renderMarkdown("`<b>`"), "<code>&lt;b&gt;</code>");
});

test("renderMarkdown: headings map # -> h4 and clamp at h6", () => {
  assert.equal(renderMarkdown("# Title"), "<h4>Title</h4>");
  assert.equal(renderMarkdown("## Sub"), "<h5>Sub</h5>");
  assert.equal(renderMarkdown("### Sub"), "<h6>Sub</h6>");
  // #### would be level 7 -> clamped to 6
  assert.equal(renderMarkdown("#### Deep"), "<h6>Deep</h6>");
});

test("renderMarkdown: ordered list", () => {
  assert.equal(
    renderMarkdown("1. one\n2. two"),
    "<ol><li>one</li><li>two</li></ol>",
  );
});

test("renderMarkdown: unordered list accepts -, *, and •", () => {
  assert.equal(renderMarkdown("- a\n* b\n• c"), "<ul><li>a</li><li>b</li><li>c</li></ul>");
});

test("renderMarkdown: switching from ordered to unordered closes the first list", () => {
  assert.equal(
    renderMarkdown("1. one\n- two"),
    "<ol><li>one</li></ol><ul><li>two</li></ul>",
  );
});

test("renderMarkdown: fenced code block is escaped and wrapped in pre/code", () => {
  const out = renderMarkdown("```\nconst x = a < b;\n```");
  assert.equal(out, "<pre><code>const x = a &lt; b;</code></pre>");
});

test("renderMarkdown: unterminated code fence still flushes the buffer", () => {
  const out = renderMarkdown("```\nline1\nline2");
  assert.equal(out, "<pre><code>line1\nline2</code></pre>");
});

test("renderMarkdown: inline markdown is not applied inside code blocks", () => {
  const out = renderMarkdown("```\n**not bold**\n```");
  assert.equal(out, "<pre><code>**not bold**</code></pre>");
});
