# VS Code extension package

The developer installs the extension in VS Code (Marketplace or `nojs-lsp-<version>.vsix`); the package carries the bundled client and server, HTML custom data and snippets, the manifest that activates on HTML files, and nothing from the development tree.

## Sub-features

- `pkg-build` produces the `.vsix` with `vsce package` (running `vscode:prepublish`).
- `pkg-contents` ships both bundles, `bin/nojs-language-server.js`, `data/nojs-custom-data.json`, `snippets/nojs.json`, logo, readme, changelog and license.
- `pkg-exclusions` ships no `node_modules`, TypeScript sources, tests, source maps, `.claude/` or `.verify/` files.
- `pkg-manifest` carries the repo version, `main: ./out/client/src/extension.js`, `activationEvents: ["onLanguage:html"]`.
- `pkg-server-runs` runs the server from the extracted package and answers `initialize`.
- `pkg-vscode-activation` activates the client inside VS Code (not automated).

## How to get to it (user POV)

- Install `No.JS LSP` from the VS Code Marketplace (`.github/workflows/publish.yml` runs `vsce package` and `vsce publish` on version tags), or build the `.vsix` with `npx vsce package` and use `Extensions: Install from VSIX...`.
- Non-VS Code editors run `nojs-language-server --stdio` from the same package.

## Driving it with verify.mjs

Preconditions:

- `npm ci` done; `.vscodeignore` lists `.verify/**` (otherwise every evidence file from earlier runs is packaged).

Run `node .claude/skills/verify-nojs-lsp/scripts/verify.mjs package`.

- **Build.** `PASS vsce package -> .verify/evidence/<stamp>-package/nojs-lsp-<version>.vsix (<bytes> bytes)`.
- **Contents.** `PASS vsix contains the 10 required entries (12 files total)`.
- **Exclusions.** `PASS vsix ships no node_modules, sources, tests, source maps, .claude or .verify files`.
- **Manifest.** `PASS packaged manifest version <version>, main ./out/client/src/extension.js, activationEvents ["onLanguage:html"]`.
- **Packaged server.** `PASS packaged server (extension/bin/nojs-language-server.js from the vsix, outside node_modules) answers initialize and exits 0`.
- **Proof.** The `.vsix`, `vsix-contents.txt`, `vsce.log` and `packaged-server/transcript.jsonl` in the evidence directory.
- **VS Code activation (manual).** `code --user-data-dir <tmp> --extensions-dir <tmp> --install-extension <vsix>`, open an `.html` file, check the `No.JS` output channel and a completion list. Not scripted here.

## Gotchas

- `vsce` lowercases `README.md` and `CHANGELOG.md` to `extension/readme.md` and `extension/changelog.md` inside the package.
- The bundles are not minified and the package is about 380 KB; a large jump in size usually means `.vscodeignore` stopped excluding something.
- `vsce package` writes into the repo root unless `--out` is given; `*.vsix` is gitignored, but delete stray ones before `npx vsce package` for a release (repo release notes).
