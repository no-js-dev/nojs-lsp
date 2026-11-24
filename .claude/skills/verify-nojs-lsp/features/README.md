# nojs-lsp verification map

This directory is the maintained source for verifying what a developer sees in their editor when the No.JS language server runs. Read this index before driving, then use the matching feature file as the recipe. Each feature has an executable scenario in `../scenarios/<feature>.json` (packaging uses the `package` command).

## Baseline preconditions

- `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs launch` printed `READY` after the last source change.
- `doctor` exits 0.
- Scenarios use `../scenarios/sample.html` unless they declare their own documents.

## Driving conventions

- Every drive starts a fresh server over stdio with a fresh workspace folder; nothing carries over between drives.
- Positions are anchors into the document text, not line/column numbers. Use the `{ "text", "occurrence", "delta" }` form when the plain anchor is ambiguous.
- Treat every step as literal: keep anchors, labels and messages unchanged.
- Send complete settings objects in `configure`, with `devtools.enabled: false`.

## Proof and skip reporting

- Keep the transcript: each claim cites the request and response in `transcript.jsonl` and the `NN-<verb>.json` file of its step.
- A diagnostics claim after a change cites the new `publishDiagnostics`, not an earlier one.
- Report the evidence directory (`.verify/evidence/<stamp>-<name>/`) and the scenario with every claim.
- A failing scenario is reported as failing with its reason in `Gotchas`; never weaken it to pass.
- Do not report the VS Code client as verified from a stdio run: the stdio runs prove the server; only a VS Code run proves activation.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, followed by exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify.mjs` (starts with `Preconditions:`, then labeled bullets pairing each user action with an exact step and its observable result), and `Gotchas`.

## Features

- [Completion](./completion.md): directive names in attribute position, filters after `|`, `$` context variables, store names after `$store.`.
- [Hover documentation](./hover.md): markdown docs for directives, filters and events.
- [Diagnostics and quick fixes](./diagnostics.md): warnings for unknown filters, HTTP directives without `as`, undefined templates; the `Add as="data"` quick fix; `nojs.validation.enabled`; clearing after an edit.
- [Navigation](./navigation.md): go to the `<template>` behind `use`, document outline of stores, state, requests and templates.
- [VS Code extension package](./extension-package.md): the `.vsix` contents, manifest and the packaged server.

Not yet mapped (providers exist in `server/src/providers/`): references, document links, semantic tokens, inlay hints, the DevTools bridge (`nojs.devtools.*`), custom filters and validators from settings, cross-file workspace scanning.
