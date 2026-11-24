# Editor settings

A developer using an editor other than VS Code (Neovim, Helix, Sublime) configures only the `nojs` keys they care about; the server applies those keys, keeps the defaults for everything else, and keeps answering completion, hover and diagnostics.

## Sub-features

- `settings-partial-push` merges a partial `workspace/didChangeConfiguration` over the defaults.
- `settings-validation` clears diagnostics when only `validation.enabled: false` is sent.
- `settings-completion-filters` hides filter completion when only `completion.filters: false` is sent, and turns validation back on because that key is no longer set.
- `settings-null-pull` uses the defaults when the editor answers `workspace/configuration` with `null` (covered by `test/unit/server-stdio.test.ts`, not by a scenario: the harness client does not advertise `workspace/configuration`).

## How to get to it (user POV)

- In Neovim: `settings = { nojs = { validation = { enabled = false } } }` in the server setup.
- Any editor that pushes settings with `workspace/didChangeConfiguration`.

## Driving it with verify.mjs

Preconditions:

- `doctor` exits 0.

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/settings.json`.

- **Open.** Step `["open", "index.html"]`; three warnings are published.
- **Partial: validation off.** Step `["configure", {"validation": {"enabled": false}}]`. A new `publishDiagnostics` has zero items.
- **Completion still works.** Step `["completion", "index.html", "price | ", {"includes": ["uppercase", "currency"], "count": 32}]`.
- **Partial: filters off.** Step `["configure", {"completion": {"filters": false}}]`. Validation is back to its default, so the three warnings return, and filter completion after `price | ` no longer lists `uppercase` or `currency`.
- **Attributes.** Step `["completion", "index.html", {"text": "<div ></div>", "delta": -7}, {"includes": ["state", "on:click"], "unique": true}]`.
- **Proof.** `transcript.jsonl` holds each `didChangeConfiguration` payload and the responses; `05-completion.json` and `08-completion.json` hold the two filter lists.

## Gotchas

- Each `didChangeConfiguration` replaces the previous settings: keys missing from the new payload go back to their defaults, they are not kept from the earlier payload.
- Up to 42bf629 a partial payload replaced the whole settings object, and the next completion request failed with `-32603: ... Cannot read properties of undefined (reading 'filters')`.
- VS Code answers `workspace/configuration` with the full section, so it never hit this path.
