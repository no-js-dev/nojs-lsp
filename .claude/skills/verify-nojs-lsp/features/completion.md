# Completion

While typing NoJS HTML the developer gets completion lists for directive names on an element, filter names after a pipe, `$` context variables inside expressions, and the stores declared in the document after `$store.`.

## Sub-features

- `completion-directives` lists directives, `bind-*` and `on:*` events in attribute position.
- `completion-skip-present` leaves out directives the element already has.
- `completion-filters` lists the 32 built-in filters after `|` in an expression.
- `completion-context` lists `$store`, `$route`, `$refs`, `$i18n`, `$form` and the other context variables after `$`.
- `completion-stores` lists `$store.<name>` for every `store` declared in the document.
- `completion-unique` lists every attribute once; `on:error` is the lifecycle hook, not a second DOM-event item.

## How to get to it (user POV)

- Type a space inside an opening tag (`<div |`) or press the editor's completion key there.
- Type `|` inside a `bind` (or other expression) value; `|` is a trigger character.
- Type `$` or `$store.` inside an expression value.

## Driving it with verify.mjs

Preconditions:

- `doctor` exits 0.
- `scenarios/sample.html` declares `store="cart"` and contains the empty `<div ></div>`.

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs drive --scenario .claude/skills/verify-nojs-lsp/scenarios/completion.json`.

- **Open the file.** Step `["open", "index.html"]`.
- **Attribute position.** Step `["completion", "index.html", { "text": "<div ></div>", "delta": -7 }, { "includes": ["state", "store", "bind", "model", "foreach", "get", "on:click", "on:error"], "min": 40, "unique": true }]`. The list has more than 40 items including those labels, none of them twice.
- **Already present.** Step `["completion", "index.html", "<div ", ...]` puts the cursor in `<div store="cart" state="...">`. The list includes `computed` and `bind` and excludes `store` and `state`.
- **Filters.** Step `["completion", "index.html", "price | ", { "includes": ["uppercase", "currency", "truncate", "date"], "count": 32 }]`. Exactly the 32 built-in filters.
- **Context variables.** Step `["completion", "index.html", "bind=\"$", { "includes": ["$store", "$route", "$refs", "$i18n", "$form"] }]`.
- **Store names.** Step `["completion", "index.html", "bind=\"$store.", { "includes": ["$store.cart"] }]`.
- **Proof.** `02-completion.json` to `06-completion.json` hold each full list; `transcript.jsonl` holds each request with its position.

## Gotchas

- The plain anchor `<div ` matches the first `<div` in the file (the store element), not the empty one; that is why the attribute-position step uses the `delta` form.
- Store items are labelled `$store.cart`, not `cart`. Labels are compared exactly.
- Up to 42bf629 `on:error` appeared twice in the attribute list (once as a DOM event, once as the lifecycle hook); core only runs it as the lifecycle hook.
- `nojs.completion.filters: false` hides filter completion; `nojs.customFilters` adds names. Neither is in the scenario yet.
