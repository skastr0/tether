# tether — brief

updated: 2026-09-24 · version: 0.2.1 · maturity: usable-with-gaps

Maturity, argued: it installs from npm and passes smoke on four platforms, it passes its own lint, and one other repo of mine gates CI on it, but nobody outside my projects has used it and the README is out of date.

## One line
tether keeps each code explanation on the code it explains.

## The pain
I ask an agent how session refresh works. It opens `docs/architecture.md`, written weeks and many commits ago, and answers from it with confidence, but the code stopped doing that a while back. I type "ignore the docs, look at the code" (I typed close to that sentence in a vellum session: quasar `prime:22f32c5045fdb8475b3acd2e4c995ad5`). Then the agent spends the session rebuilding what the file claimed to save. My only choices were to stop and rewrite notes I already knew, or delete them and start every session from zero (README.md "The problem").

## What changes
Explanations live on the code: a `@tether` comment above a declaration, `foo.ts.tether` beside a file, `src.tether` beside a folder, `root.tether` at the repo root. No bind table maps prose to code; the host is wherever the text sits (root.tether:13–14). `tether lint` compares each host's syntax-tree fingerprint with the commit where its explanation last changed. When the code has changed and the prose has not, lint reports `host_fingerprint_changed`, and that fact stays after the code change is committed. A standalone `docs/architecture.md` is a `rogue_document` and fails lint. Before an agent edits, `tether get` with `context:true` returns the symbol, folder, and root explanations as separate layers with those facts attached.

## Where it fits
When several agents share a codebase, tether holds the notes one agent leaves on the code for the next, and reports when the code has moved under a note. Any agent in any harness reads the same notes through one JSON CLI (root.tether:115–123). It has no code integration with the sibling projects. It covers the current code, and quasar covers past sessions; session memory is out of scope (README.md "Not this"). Quartz-backed refs are future work (root.tether:68, 159).

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

**Does committing the code change hide the drift?** It does not. The fact stays until someone edits the explanation:

```text
$ git commit -qam "patch session in place"; tether lint '{"root":"."}'
host_fingerprint_changed src.tether
host_fingerprint_changed src/session.ts

$ # edit the @tether comment to describe the new behavior, commit
$ tether lint '{"root":"."}'
host_fingerprint_changed src.tether
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
`extract` walks git-tracked files (`src/extract/walk.ts`), parses them with `web-tree-sitter` and per-language grammar wasm (`src/extract/parser.ts`, `grammars/`), and binds each marked comment to the declaration immediately below it (`src/extract/adjacency.ts`). Each host gets a fingerprint (`src/extract/fingerprint.ts`): a hash of AST node types and token text with no positions, so reformatting does not change it and renaming does. A folder host's fingerprint is a hash of the tracked paths and blob hashes under it (root.tether:85–87). `lint` (`src/facts/lint.ts`) runs git through `src/core/git.ts#runGit`, finds the baseline commit where the explanation last changed (blame for inline comments, last source commit for sidecars), and compares fingerprints. It then emits a closed set of ten fact kinds with coverage and before/after evidence (root.tether:90–103). `get` returns explanations in layers from symbol out to root. `compile` writes a private `wiki/` and an `@public`-only `public/` tree under `~/.config/tether/projects/<git-key>/` (`src/compile/wiki.ts`), and rewrites only the marked span in `README.md` (`src/compile/public-span.ts`). `search` indexes the extract in SQLite FTS5, with optional embeddings (`src/search/`).

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
- API reference or type docs; types and signatures stay in the type system (README.md "Not this")
- session memory or chat history
- checking whether prose is true; tether reports structural drift, not correctness, and editing a tether clears its fact without anyone reading it (root.tether:19–20)
- Windows, Linux musl/Alpine, Swift, Elixir, C++

## Install
```sh
npm install -g @skastr0/tether
tether --version        # 0.2.1
tether doctor '{"root":"."}'
```
Needs Node 22.14+ and Git on macOS or Linux glibc, arm64 or x64. The npm package pulls a platform binary with Bun embedded, so Bun is not required. Windows and Linux musl are unsupported (README.md install section). I checked the install today on darwin-arm64 only; CI smoke covers the other three platforms.

## Proof
- `bun run verify` today: typecheck green, 351 tests in 67 files pass, 2 release-script tests pass.
- CI run 35968983869 (2026-09-24, commit f618dc3): verify, pack, and smoke passed on macos-15, macos-15-intel, ubuntu-24.04, and ubuntu-24.04-arm (`gh run view 35968983869`).
- npm `@skastr0/tether`: 0.1.0 (2026-09-04), 0.2.0 (2026-09-08), 0.2.1 (2026-09-13), from `npm view @skastr0/tether time`. They are published through GitHub OIDC with the `release` environment gated on approval (root.tether:174–178).
- 79 commits since 2026-08-12 (`git log --oneline | wc -l`).
- Dogfood: tether's own repo carries 20 tethers across 182 tracked files (`tether extract`). Its own lint passes (`failed: false`, exit 0) after commit 4e72c69, with 4 non-failing `host_fingerprint_changed` facts left open on `root.tether`, `src/facts.tether`, `src/commands/get.ts.tether`, and `src/extract/types.ts`.
- Used elsewhere: one private repo of mine (vouch) runs `tether lint` in push/PR CI (vouch commit 3ed5085, `.github/workflows/ci.yml:49–51`). It has 31 tethers, and lint passes there today (`failed: false`, 4 non-failing facts).
- GitHub `skastr0/tether` is public with 0 stars (`gh repo view`).

## Gaps
- Four explanations in tether's own repo carry open `host_fingerprint_changed` facts: the code under them has changed and nobody has re-read the prose yet (`tether lint` on this repo).
- README is out of date. It is headed "Experimental 0.2.0" and says darwin and linux-arm64 smoke "still need CI runners" (README.md:7–12). npm latest is 0.2.1, and CI smoke has passed on all four runners.
- `tether search` alone fails with `SearchCorpusEmptyError: no extract index is available` until `tether extract` has run. The README command list (README.md:37) shows it as if it runs on its own.
- Semantic search needs `SYNTHETIC_API_KEY` and sends text to that service. Without the key, `fusion` falls back to lexical FTS5 only (`search` capabilities output).
- A folder fingerprint changes on any byte change under the folder, so any edit in `src/` flags `src.tether`. This is noisy by design (root.tether:85).
- `host_fingerprint_changed` does not fail lint by default. Drift is reported, not blocked, unless `.tether.json` sets `fail_on` (`src/facts/lint.ts:79–87`).
- Editing a tether's bytes resets its baseline, so an agent can clear a fact without rereading the prose (root.tether:19).
- It has no `init` or onboarding command (`tether capabilities` lists 14 commands, and init is not one). It has no CHANGELOG and no GitHub Release.
- No users outside my own repos (unverified beyond what I can see: 0 stars, no issues checked).

## Demo moments
1. **Drift survives the commit** (terminal cast, ~25 s). Show the tethered `refreshSession`, then an in-place patch and a commit. `tether lint` still prints `host_fingerprint_changed src/session.ts` with before/after fingerprints. Edit the comment and lint clears it. It proves a commit does not hide drift.
2. **The stale doc fails CI** (terminal cast, ~15 s). `git add docs/architecture.md` → `tether lint` exits 1 with `rogue_document`. It proves a standalone doc can't enter the repo quietly.
3. **What the agent reads before editing** (terminal cast, ~15 s). `tether get … "context":true` prints the symbol and folder layers with the facts attached. It proves the agent gets the notes and the drift evidence in one call.

## Copy bank
- tagline: Code explanations that stay on the code.
- short description: Keeps code explanations on the code they describe. Git and syntax-tree facts report when the code has changed under the prose.
- page lede: tether puts each explanation on the code it describes: a comment on a function, a file beside a file, a note beside a folder. When the code changes and the prose does not, `tether lint` reports it as a fact, and the fact stays after the commit.
- X post: An agent reads the architecture doc before the code, and the doc is three weeks stale. tether keeps each explanation on its function, file, or folder, and lint reports when the code has changed under the prose. A commit doesn't clear the fact. Updating the prose does.
