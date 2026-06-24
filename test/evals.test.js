"use strict";

// Validates the bundled eval corpus: every registry entry resolves to a file
// that (a) conforms to the published JSON Schema and (b) is accepted by the
// runtime loader. Also checks the registry itself stays in sync with the files
// on disk, so a contributor's data-only PR is fully verified by CI.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Ajv = require("ajv");

const { normalizeEvalScript } = require("../sidepanel.js");

const ROOT = path.join(__dirname, "..");
const EVALS_DIR = path.join(ROOT, "sample-evals");
const SCHEMA_PATH = path.join(ROOT, "schemas", "strawbery.eval.v1.schema.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const schema = readJson(SCHEMA_PATH);
const registry = readJson(path.join(EVALS_DIR, "index.json"));
const validate = new Ajv({ allErrors: true }).compile(schema);

const entries = registry.evals;

test("registry: index.json declares a non-empty evals array", () => {
  assert.ok(Array.isArray(entries) && entries.length > 0);
});

test("registry: entry ids are unique", () => {
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("registry: every referenced file exists", () => {
  for (const entry of entries) {
    assert.ok(
      fs.existsSync(path.join(EVALS_DIR, entry.file)),
      `${entry.id} → missing file ${entry.file}`,
    );
  }
});

test("registry: every eval .json on disk is referenced (no orphans)", () => {
  const referenced = new Set(entries.map((e) => e.file));
  const onDisk = fs
    .readdirSync(EVALS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "index.json");
  for (const file of onDisk) {
    assert.ok(referenced.has(file), `${file} is not listed in index.json`);
  }
});

// Per-eval validation — one subtest each so failures pinpoint the offending file.
for (const entry of entries) {
  test(`eval "${entry.id}" conforms to the JSON Schema`, () => {
    const doc = readJson(path.join(EVALS_DIR, entry.file));
    const ok = validate(doc);
    assert.ok(ok, `${entry.file} schema errors: ${JSON.stringify(validate.errors, null, 2)}`);
  });

  test(`eval "${entry.id}" is accepted by normalizeEvalScript`, () => {
    const doc = readJson(path.join(EVALS_DIR, entry.file));
    assert.doesNotThrow(() => normalizeEvalScript(doc));
  });

  test(`eval "${entry.id}" id matches its registry entry`, () => {
    const doc = readJson(path.join(EVALS_DIR, entry.file));
    if (doc.id != null) assert.equal(doc.id, entry.id);
  });
}
