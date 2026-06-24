"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeEvalScript } = require("../sidepanel.js");

test("normalizeEvalScript: accepts lightweight samples format", () => {
  const script = normalizeEvalScript({
    schema_version: "strawbery.eval.v1",
    id: "letter-count",
    name: "Letter Count",
    tags: ["reasoning"],
    metadata: { author: "test" },
    samples: [
      {
        id: "basic",
        input: [
          { role: "user", content: "How many r's are in strawbery?" },
          { role: "user", content: "Double check." },
        ],
        metadata: { category: "counting" },
      },
    ],
  });

  assert.equal(script.id, "letter-count");
  assert.equal(script.samples[0].id, "basic");
  assert.equal(script.samples[0].input[0].role, "user");
  assert.equal(script.samples[0].input[0].content, "How many r's are in strawbery?");
  assert.deepEqual(script.tags, ["reasoning"]);
  assert.deepEqual(script.metadata, { author: "test" });
});

test("normalizeEvalScript: accepts single string input", () => {
  const script = normalizeEvalScript({
    samples: [{ input: "Hello" }],
  });

  assert.deepEqual(script.samples[0].input, [{ role: "user", content: "Hello" }]);
});

test("normalizeEvalScript: converts legacy turns format", () => {
  const script = normalizeEvalScript({
    id: "legacy",
    name: "Legacy",
    turns: [{ prompt: "First" }, { prompt: "Second" }],
  });

  assert.equal(script.schema_version, "strawbery.eval.v1");
  assert.equal(script.samples[0].id, "default");
  assert.deepEqual(script.samples[0].input, [
    { role: "user", content: "First" },
    { role: "user", content: "Second" },
  ]);
});

test("normalizeEvalScript: rejects samples without user messages", () => {
  assert.throws(
    () =>
      normalizeEvalScript({
        samples: [{ input: [{ role: "assistant", content: "Hello" }] }],
      }),
    /at least one user input/,
  );
});

test("normalizeEvalScript: rejects unknown roles", () => {
  assert.throws(
    () =>
      normalizeEvalScript({
        samples: [{ input: [{ role: "critic", content: "Hello" }] }],
      }),
    /Unsupported message role/,
  );
});
