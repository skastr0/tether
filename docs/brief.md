# Tether — brief

updated: 2026-09-24 · version: 0.2.1 · maturity: usable-with-gaps

Why usable-with-gaps: it installs and runs on four platforms and gates CI in one other repo, but nobody outside my repos has used it yet.

## One line
Tether keeps each code explanation on the code it explains.

## The pain
You ask an agent how session refresh works. It reads `docs/architecture.md`, written weeks and many commits ago, and answers from it with confidence. The code stopped working that way a while back. You type "ignore the docs, look at the code", and the agent spends the session rebuilding what the doc was supposed to save. (Receipt: I sent almost exactly that message in Quasar session `prime:22f32c5045fdb8475b3acd2e4c995ad5`.)

## What changes
Explanations sit on the code they explain, and lint reports when the code has changed under them.

| where the explanation sits | what it explains |
|---|---|
| `@tether` comment above a declaration | that function, type, or method |
| `foo.ts.tether` beside `foo.ts` | that file |
| `src.tether` beside `src/` | that folder |
| `root.tether` | the repo |

`tether lint` reports `host_fingerprint_changed` when the code changed and the prose did not, and a commit does not clear it. A standalone `docs/architecture.md` fails lint as a `rogue_document`. Before an agent edits, `tether get` gives it every explanation that applies, with those facts attached (root.tether:12–31).

## Where it fits
When several agents work on one codebase, Tether holds the notes one agent leaves on the code for the next, and says when a note has gone stale. Every agent reads them through the same JSON CLI. It pairs with Quasar, which searches past agent sessions. The two share no code.

## See it run
All runs are from today (2026-09-24) with `@skastr0/tether@0.2.1` installed from npm on darwin-arm64, in a scratch repo with one tethered function:

```ts
/** @tether
 * Refresh renames the session row. Never patch it in place:
 * the old token must stay valid until the new one is written.
 */
export function refreshSession(id: string, token: string) { ... }
```

**Does lint stay quiet when the code matches the notes?** It does on a clean commit, and a whitespace-only reformat leaves the symbol fingerprint unchanged:

```text
$ tether lint '{"root":"."}'
{ "ok": true, "command": "lint",
  "data": { "facts": [], "failed": false,
    "comparisons": [ { "path": "src/session.ts", "check": "host_fingerprint",
        "baseline": { "commit": "4cd8626…", "method": "inline_blame" },
        "before": "typescript@14:…17545af42bad",
        "after":  "typescript@14:…17545af42bad" }, … ] } }
exit 0
```

**What happens when an agent patches the function in place and adds `docs/architecture.md`?**

```text
$ tether lint '{"root":"."}'
{ "facts": [
    { "kind": "rogue_document",           "path": "docs/architecture.md" },
    { "kind": "host_fingerprint_changed", "path": "src.tether" },
    { "kind": "host_fingerprint_changed", "path": "src/session.ts" } ],
  "failed": true }
exit 1
```

**Does committing the code change clear the report?** It does not. Updating the explanation does:

```text
$ git commit -qam "patch session in place"; tether lint '{"root":"."}'
host_fingerprint_changed src.tether
host_fingerprint_changed src/session.ts

$ # edit the @tether comment to describe the new behavior, commit
$ tether lint '{"root":"."}'
host_fingerprint_changed src.tether   # the folder's note still needs its own update
failed False
```

**What does an agent read before it edits?**

```text
$ tether get '{"root":".","path":"src/session.ts","symbol":"refreshSession","context":true}'
{ "layers": [
    { "host": { "kind": "symbol", "path": "src/session.ts", "name": "refreshSession" },
      "tethers": [ { "doc": "Refresh renames the session row. Never patch it in place: …" } ] },
    { "host": { "kind": "folder", "path": "src" },
      "tethers": [ { "path": "src.tether", "doc": "Sessions live in src/session.ts. …" } ] } ],
  "facts": [ { "kind": "host_fingerprint_changed", "path": "src/session.ts" }, … ],
  "comparisons": [ { "path": "src/session.ts",
      "before": "typescript@14:…17545af42bad", "after": "typescript@14:…6ff8a89" }, … ] }
exit 0
```

## How it works
`tether extract` parses git-tracked files with `web-tree-sitter` and binds each marked comment to the declaration directly below it (`src/extract/adjacency.ts`). Each host gets a fingerprint of its syntax tree, so a reformat leaves it unchanged and a rename or logic change changes it (`src/extract/fingerprint.ts`). `tether lint` finds the commit where each explanation last changed and compares the fingerprint then with the fingerprint now (`src/facts/lint.ts`). It reports a closed set of ten fact kinds with before/after evidence (root.tether:90–103). `get`, `compile`, and `search` read the same extract. Everything they write goes under `~/.config/tether/projects/<git-key>/`, never into the repo.

Diagram spec:
- nodes: `git ls-files` · `walk` · `parser` (web-tree-sitter + grammar wasm) · `adjacency` · `Tether` records (`src/extract/types.ts#Tether`) · `fingerprint` · git baseline (`runGit`: blame / last source commit) · `lint` facts · `get` layers · `compile` → `wiki/` + `public/` + README span · `search` → `search.sqlite`
- edges: `git ls-files` → `walk` → `parser` → `adjacency` → `Tether` records; `parser` → `fingerprint`; `Tether` records + `fingerprint` + git baseline → `lint` facts; `Tether` records + `lint` facts → `get` layers; `Tether` records → `compile`; `Tether` records → `search`
- external box: `~/.config/tether/projects/<git-key>/` holds everything derived, and nothing derived is committed to the repo.

## Who it is for / not for
For:
- a repo where agents edit code and read explanations of it, and those explanations keep going stale
- several agents working in one repo that want drift reported as a fact in CI, not noticed in review
- TypeScript/TSX, JavaScript, Rust, Go, Ruby, and Python codebases (`src/extract/languages/`)

Not for:
- API reference or type docs; types and signatures stay in the type system (README.md is / is-not table)
- session memory or chat history
- checking whether prose is true; Tether reports structural drift, not correctness, and editing an explanation clears its report, even if nobody checked it against the code (root.tether:19–20)
- Windows, Linux musl/Alpine, Swift, Elixir, C++

## Install
```sh
npm install -g @skastr0/tether
tether --version        # 0.2.1
tether doctor '{"root":"."}'
```
Needs Node 22.14+ and Git on macOS or Linux glibc, arm64 or x64. The npm package pulls a platform binary with Bun embedded, so Bun is not required. Windows and Linux musl are unsupported (README.md "Install and first run"). I checked the install today on darwin-arm64 only; CI smoke covers the other three platforms.

## Proof
- `bun run verify` today: typecheck green, 351 tests in 67 files pass, 2 release-script tests pass.
- CI run 35968983869 (2026-09-24, commit f618dc3): verify, pack, and smoke passed on macos-15, macos-15-intel, ubuntu-24.04, and ubuntu-24.04-arm (`gh run view 35968983869`).
- npm `@skastr0/tether`: 0.1.0 (2026-09-04), 0.2.0 (2026-09-08), 0.2.1 (2026-09-13), from `npm view @skastr0/tether time`.
- Tether is documented with itself: 20 tethers, and its own lint passes (`failed: false`, exit 0, commit 4e72c69).
- Used elsewhere: one private repo of mine (vouch) runs `tether lint` in push/PR CI (vouch commit 3ed5085, `.github/workflows/ci.yml:49–51`). It has 31 tethers, and lint passes there today (`failed: false`, 4 non-failing facts).
- GitHub `skastr0/tether` is public with 0 stars (`gh repo view`).

## Gaps
- `tether search` fails with `SearchCorpusEmptyError: no extract index is available` until `tether extract` has run. The README shows `extract` first, but the command doesn't build the index itself.
- Semantic search needs `SYNTHETIC_API_KEY` and sends text to that service. Without the key, `fusion` falls back to lexical FTS5 only (`search` capabilities output).
- A folder fingerprint changes on any byte change under the folder, so any edit in `src/` flags `src.tether`. This is noisy by design (root.tether:85).
- Code changing under an explanation is reported, not failed, unless `.tether.json` lists `host_fingerprint_changed` in `fail_on` (`src/facts/lint.ts:79–87`).
- Editing an explanation clears its report, even if nobody checked it against the code (root.tether:19).
- There is no `init` command, so you write your first explanation by hand (`tether capabilities` lists 14 commands, none of them `init`). There is no CHANGELOG yet.
- No users outside my own repos (unverified beyond what I can see: 0 stars, no issues checked).

## Demo moments
1. **Drift survives the commit** (terminal cast, ~25 s). Show the tethered `refreshSession`, then an in-place patch and a commit. `tether lint` still prints `host_fingerprint_changed src/session.ts` with before/after fingerprints. Edit the comment and lint clears it. It proves a commit does not hide drift.
2. **The stale doc fails CI** (terminal cast, ~15 s). `git add docs/architecture.md` → `tether lint` exits 1 with `rogue_document`. It proves a standalone doc can't enter the repo quietly.
3. **What the agent reads before editing** (terminal cast, ~15 s). `tether get … "context":true` prints the symbol and folder layers with the facts attached. It proves the agent gets the notes and the drift evidence in one call.

## Copy bank
- tagline: Code explanations that stay on the code.
- short description: Keeps code explanations on the code they describe, and reports when the code changes under them. A JSON CLI for agents and CI.
- page lede: Write the explanation where the code is, as a comment on a function or a file beside a file or folder. When the code changes and the explanation doesn't, Tether reports it, and committing the code doesn't clear the report.
- X post: An agent reads the architecture doc before the code, and the doc is three weeks stale. Tether keeps each explanation on its function, file, or folder, and lint reports when the code has changed under the prose. A commit doesn't clear the fact. Updating the prose does.
