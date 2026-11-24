# Navigation

The developer jumps from a `use="card"` reference to the `<template id="card">` that defines it, and sees an outline of the document's stores, state blocks, HTTP requests and templates.

## Sub-features

- `nav-definition-template` resolves `use`, `then` and `else` template references to the `<template id>`.
- `nav-symbols` lists `store: <name>`, `state: <expression>`, `<VERB> <url>` and `template: <id>` symbols.
- `nav-definition-refs` resolves `$refs.<name>` and `$store.<name>` (not in the scenario yet).

## How to get to it (user POV)

- Ctrl/Cmd-click (Go to Definition) on the value of `use="card"`.
- Open the Outline view or Go to Symbol in File.

## Driving it with verify.mjs

Preconditions:

- `doctor` exits 0.

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/navigation.json`.

- **Go to definition.** Step `["definition", "index.html", { "text": "use=\"ca" }, { "target": "<template id=\"card\"" }]`. The returned location starts on the line of `<template id="card">` in the same file.
- **Outline.** Step `["symbols", "index.html", { "includes": ["store: cart", "state: { name: 'Ada'", "GET /api/users", "template: card"] }]`.
- **Proof.** `02-definition.json` (URI and range) and `03-symbols.json` (the full outline).

## Gotchas

- The definition URI points into the drive's scratch workspace (`.verify/run/navigation-*/index.html`), which is deleted after the drive; the evidence keeps the response and a copy of the document.
- Templates defined in other files are found through the workspace scanner over the `rootUri` folder; a scenario that tests that needs a second document in `documents`.
