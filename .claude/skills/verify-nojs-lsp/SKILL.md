---
name: verify-nojs-lsp
description: Build and drive the No.JS language server (nojs-lsp) over LSP stdio the way an editor does (initialize, open an HTML document, request completion, hover, definition, symbols, code actions, read published diagnostics) and package the VS Code extension into a .vsix whose server is smoke-tested from the package itself, keeping JSON-RPC transcripts as proof. Use when you need to prove an LSP change works for an editor user, not just that Jest passes.
---

# verify-nojs-lsp

The user of this repo is a developer editing NoJS HTML in VS Code (through the extension in `client/`) or in any LSP editor (through `bin/nojs-language-server.js --stdio`). Both run the same bundled server, `out/server/src/server.js`. This skill drives that server exactly as an editor does, over stdio JSON-RPC, and packages the extension.

Everything runs through `scripts/verify.mjs` from the repo root. Recipes live in [`features/`](features/README.md); executable scenarios and the shared sample document live in `scenarios/`.

## Launch

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs launch
```

There is no long-running server to keep alive: the language server lives as long as one editor session. `launch` runs `npm ci` when `node_modules` is missing, then `npm run compile` (esbuild bundles `server/src` and `client/src` into `out/`, which is gitignored), and prints `READY server=bin/nojs-language-server.js -> out/server/src/server.js nojs-lsp=<version> sha=<git sha>`. A missing bundle or a non-zero build exits 1. Rerun `launch` after every source change; every `drive` then starts its own server process.

## Doctor

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs doctor
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs doctor --server <path to another server entry>
```

Read-only (it only creates and removes a scratch workspace under `.verify/run/`). One `OK`/`WARN`/`FAIL` line per check, exit 1 on any `FAIL`:

- `out/server/src/server.js` exists, and `out/` is newer than every file in `server/src` and `client/src` (`WARN`: run `launch`);
- a fresh `node bin/nojs-language-server.js --stdio` answers `initialize` with the 9 expected capabilities (completion, hover, definition, references, document symbols, document links, semantic tokens, code actions, inlay hints) and the completion trigger characters;
- the server exits 0 after `shutdown` + `exit`.

On a failure the transcript and server stderr stay in `.verify/run/doctor-transcript-*/`.

## Drive

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/completion.json
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario my-scenario.json --server <entry.js>
```

Each drive creates a scratch workspace `.verify/run/<name>-XXXXXX/`, writes the scenario's documents there as real files, spawns `node bin/nojs-language-server.js --stdio` (or `--server`), sends `initialize` with that folder as `rootUri` and workspace folder, runs the steps in order, stops at the first failure, sends `shutdown` + `exit`, and requires exit code 0. The client does not advertise `workspace/configuration`, so the server takes settings from `workspace/didChangeConfiguration` (the `configure` step). Server-to-client requests are answered with `null` and recorded.

A scenario is JSON:

```json
{ "name": "completion",
  "documents": { "index.html": { "file": "sample.html" } },
  "steps": [["open", "index.html"], ["completion", "index.html", "price | ", { "includes": ["currency"] }]] }
```

`documents` maps a workspace-relative file name to inline text or `{ "file": "<path relative to the scenario>" }`. A position (`at`) is an anchor string: the cursor goes right after its first occurrence, or `{ "text": "...", "occurrence": n, "delta": k }` for the n-th occurrence (0-based) shifted by k characters. Anchors avoid hand-counted line/column numbers.

| Verb | Args | Effect |
| --- | --- | --- |
| `open` | file | `textDocument/didOpen` with the file's text. |
| `change` | file, text | `textDocument/didChange` replacing the whole text (new version). |
| `configure` | settings | `workspace/didChangeConfiguration` with `{ nojs: settings }`. The server merges the keys you send over its defaults, as editors other than VS Code send only what the user set. |
| `expect-diagnostics` | file, expect | Wait for a `publishDiagnostics` for the file that arrived after its last `open`/`change`/`configure` and matches. |
| `completion` | file, at, expect | `textDocument/completion`; checks item labels (exact match). |
| `hover` | file, at, expect | `textDocument/hover`; checks the markdown text (substring). |
| `definition` | file, at, `{target}` or `{line}` | `textDocument/definition`; the location must start on the line of the `target` anchor (or the 0-based `line`). |
| `symbols` | file, expect | `textDocument/documentSymbol`; checks symbol names, nested included (substring). |
| `code-actions` | file, at, expect | `textDocument/codeAction` at the position with the diagnostics published for that line; checks titles (substring). |

`expect` takes `includes` (all must appear), `excludes` (none may appear), `count` (exact), `min` and `unique` (no label, message or name twice). Steps time out after 5 s (`VERIFY_STEP_TIMEOUT=<ms>`); diagnostics are debounced 200 ms by the server.

## Package (VS Code extension)

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs package
```

Runs `npx vsce package --out .verify/evidence/<stamp>-package/nojs-lsp-<version>.vsix` (which runs `vscode:prepublish` = `npm run compile`), then checks the package the way a user receives it:

- the `.vsix` lists the required entries: `extension/package.json`, both bundles in `extension/out/`, `extension/bin/nojs-language-server.js`, `extension/data/nojs-custom-data.json`, `extension/snippets/nojs.json`, `extension/logo.png`, `extension/readme.md`, `extension/changelog.md`, `extension/LICENSE.txt`;
- it ships no `node_modules`, TypeScript sources, tests, source maps, `.claude/` or `.verify/` files;
- the packaged manifest has the repo version, `main: ./out/client/src/extension.js` and `activationEvents: ["onLanguage:html"]`;
- the server extracted from the `.vsix` (outside the repo's `node_modules`) answers `initialize` with all expected capabilities and exits 0.

Loading the `.vsix` into VS Code and seeing the client activate is not covered: it needs a VS Code instance (and would touch the user's editor profile). Do it by hand with `code --install-extension <vsix>` in a disposable profile (`--user-data-dir`, `--extensions-dir`) when that matters.

## Evidence

Each `drive` writes `.verify/evidence/<YYYYMMDD-HHMMSS>-<scenario name>/`:

- `transcript.jsonl`: every JSON-RPC message in both directions with a timestamp (`dir: client->server | server->client`).
- `steps.log`: `PASS`/`FAIL` per step with arguments and duration; `result.json`: pass/fail, failed step, server entry, git sha, version, server exit status.
- `NN-<verb>.json`: the raw response of step NN (`00-initialize.json`, `02-completion.json`, `03-diagnostics.json`, ...).
- `documents/`: the exact text the server saw, plus `<file>.v<n>` after each `change`.
- `server-stderr.log` when the server wrote to stderr.

`package` writes `.verify/evidence/<stamp>-package/`: the `.vsix`, `vsce.log`, `vsix-contents.txt`, `steps.log`, `result.json`, and `packaged-server/transcript.jsonl` for the smoke test.

Proof standards:

- Drive the server through the protocol an editor uses (bin entry, stdio, `initialize` with a real folder). Do not import providers or call internal functions; Jest already does that.
- For every request keep the request and the response (the transcript), and assert on what an editor shows: completion labels, hover markdown, diagnostic messages and severities, code action titles, the target line of a definition.
- Prove state changes with a second observation: diagnostics after `change` or `configure` must be a new `publishDiagnostics`, not the earlier one.
- A failing step is a failure; report it with its evidence directory and record the reason in the feature's `Gotchas`. Never loosen a scenario until it passes.

## Cleanup

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs cleanup
```

Each drive already shuts its server down (`shutdown` + `exit`, `SIGKILL` only for the process it spawned if it has not exited after 3 s) and removes its scratch workspace. `cleanup` deletes whatever remains in `.verify/run/`, never `.verify/evidence/` (gitignored and excluded from the `.vsix` by `.vscodeignore`), and then looks for language-server processes started from this checkout (`pgrep -f <repo>/bin/nojs-language-server.js|<repo>/out/server/src/server.js`). It reports them and exits 1 instead of killing them: kill only a pid this run started, by pid. Never kill by process name; VS Code runs its own copy of the server from the installed extension.

## Helpers

`scripts/verify.mjs` (executable, `#!/usr/bin/env node`):

```bash
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs launch
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs doctor  [--server <entry.js>]
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive   --scenario <file.json> [--server <entry.js>] [--name <label>]
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs package
node .claude/skills/verify-nojs-lsp/scripts/verify.mjs cleanup
```

`scenarios/sample.html` is the shared document: a store, two `state` blocks, filters (one misspelled), a `get` without `as`, a defined and an undefined template reference, and an empty `<div >` for attribute completion. Changing it changes every scenario's expectations; keep `features/` and `scenarios/` in sync.

## Isolation

- Each drive has its own server process and its own workspace folder, so any number can run in parallel (no ports are involved).
- Run state and evidence live in this checkout's `.verify/`.
- `nojs.devtools.enabled` makes the server connect to Chrome over CDP (`localhost:9222` by default). Keep it `false` in `configure` steps unless a Chrome you started is listening; otherwise the server may attach to someone else's browser.
