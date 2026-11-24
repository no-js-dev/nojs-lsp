# Hover documentation

Hovering a directive, filter or event name shows its documentation in markdown, with a description and an example, so the developer does not leave the editor.

## Sub-features

- `hover-directive` documents a directive (`bind`) with description, example and limitations.
- `hover-filter` documents a filter (`uppercase`) with description, example and category.
- `hover-event` documents an `on:*` event attribute (`on:click`).

## How to get to it (user POV)

- Rest the pointer on an attribute name such as `bind` or `on:click`, or on a filter name after `|`.

## Driving it with verify.mjs

Preconditions:

- `doctor` exits 0.

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/hover.json`.

- **Directive.** Step `["hover", "index.html", "<h1 bi", { "includes": ["`bind` directive", "Binds element's text content"] }]`. The markdown starts with the heading for `bind`.
- **Filter.** Step `["hover", "index.html", "name | upper", { "includes": ["`uppercase` filter", "UPPERCASE"] }]`.
- **Event.** Step `["hover", "index.html", "<button on:cl", { "includes": ["click"] }]`.
- **Proof.** `02-hover.json`, `03-hover.json`, `04-hover.json` hold the markdown; the transcript shows each position.

## Gotchas

- The anchor puts the cursor inside the name (`<h1 bi` lands between `bi` and `nd`); keep hover anchors inside the word under test.
- With `nojs.devtools.enabled` and a reachable Chrome, hover on expressions also shows live values; that path is not covered and needs a Chrome you started.
