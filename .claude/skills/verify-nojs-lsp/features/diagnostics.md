# Diagnostics and quick fixes

As the developer edits, the server publishes warnings for NoJS mistakes (unknown filter, HTTP directive without `as`, reference to a template that does not exist), offers a quick fix where one exists, clears the warnings once the code is fixed, and stops reporting when validation is disabled in settings.

## Sub-features

- `diag-unknown-filter` warns `Unknown filter "<name>"` and lists the available filters.
- `diag-http-as` warns that `get` is missing the `as` companion attribute.
- `diag-template-ref` warns `Template "<id>" is referenced but not defined in this document`.
- `diag-quickfix-as` offers the code action `No.JS: Add as="data" companion attribute`.
- `diag-setting` publishes an empty list when `nojs.validation.enabled` is `false` and the warnings again when it is `true`.
- `diag-clear-on-fix` publishes an empty list after an edit fixes every problem.
- `diag-link-href` informs (severity 3, never a warning) about `<a route>` / `<a bind-route>` without `href` / `bind-href`, suggesting the matching attribute; `<button route>` is not checked.

## How to get to it (user POV)

- Open an HTML file with mistakes; warnings appear in the Problems panel and as squiggles.
- Put the cursor on a warned line and open the quick-fix menu.
- Toggle `No.JS › Validation: Enabled` in settings.

## Driving it with verify.mjs

Preconditions:

- `doctor` exits 0.
- `scenarios/sample.html` contains `name | uppercasee`, `<section get="/api/users">` and `use="missing-card"`.

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/diagnostics.json`.

- **Open.** Step `["open", "index.html"]`, then `["expect-diagnostics", "index.html", { "count": 3, "includes": [...] }]`. Exactly three warnings (severity 2): the unknown filter `uppercasee`, `get` without `as`, and `missing-card`.
- **Quick fix.** Step `["code-actions", "index.html", "<section get", { "includes": ["Add as=\"data\" companion attribute"] }]`.
- **Disable validation.** Step `["configure", { "validation": { "enabled": false }, ... }]`. A new `publishDiagnostics` arrives with zero items.
- **Re-enable.** Step `["configure", { "validation": { "enabled": true }, ... }]`. The three warnings come back.
- **Fix the file.** Step `["change", "index.html", "<fixed text>"]` (filter corrected to `lowercase`, `as="users"` added, the `missing-card` line removed). A new `publishDiagnostics` arrives with zero items.
- **Route link without href.** Run `drive --scenario .claude/skills/verify-nojs-lsp/scenarios/link-href.json`. Opening `links.html` publishes exactly two diagnostics, both severity 3: `<a route> has no href. Add href="/about" (href="#/about" in hash mode) ...` and `<a bind-route> has no href. Add bind-href ...`; the `<a>` that has `href` and the `<button route>` get none. After the `change` that adds `href` / `bind-href`, the list is empty.
- **Proof.** `02-diagnostics.json` (three warnings), `03-code-actions.json`, the empty lists in `05-diagnostics.json` and `09-diagnostics.json`, the restored warnings in `07-diagnostics.json`, and `documents/index.html.v2` with the fixed text.

## Gotchas

- The scenario sends the full settings object; partial objects are covered by the [Editor settings](./settings.md) feature.
- Diagnostics are debounced 200 ms. `expect-diagnostics` only accepts a notification that arrived after the last `open`/`change`/`configure`, so it cannot pass on a stale list.
- The unknown-filter warning has no quick fix; only directive typos, missing `as`, `if` wrapping and `else` siblings do.
