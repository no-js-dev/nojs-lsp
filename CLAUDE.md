# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Versioning & Releases

All NoJS repos share one version; never bump this repo alone and never edit a version string by hand. `.versionrc.json` is the source of truth for the version locations, `scripts/version.mjs` syncs and verifies them.

Version locations in this repo:

- `package.json` — `version` (source of truth)
- `package-lock.json` — root `version` and `packages[""].version`
- `docs/index.html`, `docs/404.html` — `version: '…'` in `<body state>` (header and footer badge)
- `docs/getting-started.md` — `nojs-lsp-X.Y.Z.vsix` install example

Three kinds of version mentions:

1. **Declarations of the current version** (list above, `files` in `.versionrc.json`) — always synced by `sync`, verified by `check` (exact count per entry; a missing location fails with `file:line`).
2. **Historical mentions** (`CHANGELOG.md`, "since v1.13.0", `.github/reviews/`) — never touched; `scanExclude` keeps them out of the stale scan.
3. **State claims** ("Counts on main at X.Y.Z") — never changed automatically; files in `reviewAllowlist` are reported as `REVIEW`, not as failures.

`check` also scans every tracked file for the previous release (highest `v*` tag below the current version) and fails on any other mention.

Release flow: update `CHANGELOG.md` → `git release X.Y.Z` on the release branch (sync + `chore: release vX.Y.Z` commit, no tag; fallback `npm run version:sync -- X.Y.Z`) → PR → merge → `git tag vX.Y.Z <merge-commit>` (the `reference-transaction` hook verifies the tagged commit) → `git push origin vX.Y.Z` (the `pre-push` hook verifies again). CI runs `npm run version:check` on every push and PR. Hooks and aliases: `npm install` (`prepare`) points `core.hooksPath` at `.githooks/` and adds the `git release` / `git release-check` aliases.
