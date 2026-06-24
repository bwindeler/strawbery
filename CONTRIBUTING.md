# Contributing to strawbery

Thanks for your interest in contributing! There are two main ways to help, and
the first one needs no JavaScript at all:

1. **Contribute an eval** — share a test you've written so others can run it.
2. **Contribute code** — add a target chatbot, improve the harness, or fix a bug.

All contributions go through the standard fork → branch → pull request flow.
Pull requests run CI automatically (`npm test`), which validates the whole eval
corpus and the unit tests.

---

## Contributing an eval

An eval is a JSON file describing a set of conversations to replay against each
target. Adding one is a **data-only change** — no code required.

### Steps

1. **Fork** this repo and create a branch: `git checkout -b add-my-eval`.
2. **Create** `sample-evals/<your-id>.json` following the
   [Eval Script Format](README.md#eval-script-format). The canonical, enforced
   spec lives in [`schemas/strawbery.eval.v1.schema.json`](schemas/strawbery.eval.v1.schema.json).
3. **Register** it by adding an entry to
   [`sample-evals/index.json`](sample-evals/index.json):

   ```json
   {
     "id": "my-eval",
     "name": "My Eval",
     "description": "One line on what it checks.",
     "tags": ["reasoning"],
     "file": "my-eval.json"
   }
   ```

   The `id` must match the `id` inside your eval file, and the first entry in
   the registry is the one loaded by default in the sidepanel.
4. **Validate** locally with `npm install` then `npm test`. The suite checks
   your file against the JSON Schema, runs it through the runtime loader, and
   verifies the registry stays in sync (no missing files, unique ids, no
   orphans).
5. **Open a PR.** CI re-runs the same checks.

### Minimal example

```json
{
  "schema_version": "strawbery.eval.v1",
  "id": "my-eval",
  "name": "My Eval",
  "description": "Checks the model can do X.",
  "tags": ["reasoning"],
  "samples": [
    {
      "id": "case-1",
      "input": [
        { "role": "user", "content": "First prompt" },
        { "role": "user", "content": "Follow-up" }
      ],
      "target": "What a correct answer looks like."
    }
  ]
}
```

Each sample runs as its own conversation; multi-turn samples keep context within
that sample. `input` may also be a plain string for a single-turn prompt.

---

## Contributing code

### Dev setup

```sh
npm install        # installs the dev dependency (ajv) used by the eval tests
npm test           # run the full suite
```

To run the extension itself, load it unpacked — see
[Installation](README.md#installation).

### Adding a target

Targets live in [`targets.js`](targets.js); see
[Adding Targets](README.md#adding-targets) for the field reference. A couple of
notes specific to contributions:

- Set `tier: "free"` for chatbots usable without an account, or `tier: "all"`
  for ones that require a logged-in session (these render with a `*` and are
  off by default in the UI).
- CSS selectors are brittle and break when sites change their markup. If you add
  a target, please note in the PR how you verified the selectors (which
  account/state you tested in), since reviewers may not be able to reproduce a
  logged-in target.

### Coding conventions

- Match the style of the surrounding code; keep changes focused.
- Add or update tests under [`test/`](test) for any behavior change. The suite
  uses Node's built-in test runner plus `ajv` for schema validation.
- Keep PRs scoped to one concern so they're easy to review.

---

## Reporting issues

Open a GitHub issue with steps to reproduce. For a broken target, include the
chatbot, what you observed, and the selector(s) that appear to have changed —
that makes the fix much faster.
