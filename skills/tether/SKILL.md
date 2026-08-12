---
name: tether
description: >
  Document a git repository with tether — collocated doctrine comments and
  `.tether` sidecars, facts-only freshness, no homeless markdown.
---

# Tether

Load this when adding or updating project doctrine, architecture notes, decision records, or agent-facing explanations of code.

## Problem (short)

Homeless markdown (`docs/`, architecture dumps, project-specific `AGENTS.md` novels) goes stale. Agents read it first. Stale prose is poison. Updating it is a tax. Tether makes unattested drift a fact by collocating text with its host and comparing AST fingerprints to git.

## Do

- Put doctrine in a `@tether` comment on the symbol, or in `foo.ts.tether` / `src.tether` / `root.tether`.
- Use `@ref src/foo.ts#Name` (repo-root path) when the prose names another host. No `./` relative paths.
- `@symbol Name` only on an inline comment or `foo.ts.tether`, and only if that file actually has `Name`. Gone → `symbol_missing`. Two of them in the file → `symbol_ambiguous`. Never use `@symbol` on `root.tether` / folder tethers.
- Mark `@public` only for tethers that should appear in the public tree and the generated README region.
- Put illustrations in `example ts { ... }`. That code is not a symbol and is not a Quartz node.
- After changing a host, update or delete the tether in the same commit.
- Prefer deleting a tether you will not maintain. Cull is in-bounds.
- Point `AGENTS.md` at tether. Do not put project architecture in `AGENTS.md`.
- Leave authored README prose outside `<!-- tether:public -->` … `<!-- /tether:public -->`. Compile owns the inside.

## Do not

- Do not add tracked `.md` / `.txt` except the allowlist (README, LICENSE, SECURITY, …) or honorary `AGENTS.md` / `CLAUDE.md`.
- Do not write JSDoc as a substitute for doctrine (or doctrine as a substitute for types).
- Do not keep a `docs/` tree “for agents.”
- Do not invent severity, owners, or dates-as-fields in the language.
- Do not store the private wiki in the repo. Do not hand-edit the generated README span.
- Do not `@ref` names that exist only inside an `example` block.

## Expect

JSON-first CLI (`tether` 0.1.0). No `--json` flag. One positional `<input>`: inline JSON, `@file`, or `-` (stdin). Framework flags only: `--help`, `--version`, `--log-level`, `--wizard`, `--completions`.

Success → stdout `{ ok: true, command, data }`. Failure → stderr `{ ok: false, command, error }` and exit 1. Git is required. Extract walks **tracked** files only.

```
tether doctor
tether doctor '{"root":"."}'
tether capabilities
tether schema list
tether schema show <id|command>
tether examples list
tether examples show <id|command>
tether extract '{"root":"."}'
tether lint '{"root":"."}'
tether compile '{"root":"."}'
tether search '{"query":"auth refresh"}'
```

| command | JSON | result |
|---|---|---|
| `doctor` | `{ root? }` optional | git / wasm / `$TETHER_HOME` / discovery checks; exit 1 if a check fails |
| `extract` | `{ root }` required | `{ root, git_key, files, tethers, facts }` — parse-time facts only (mostly `ill_formed`) |
| `lint` | `{ root }` required | `{ root, facts, fail_on, failed }` — full closed set; exit 1 if any `fact.kind` is in `fail_on` |
| `compile` | `{ root }` required | writes `$TETHER_HOME/projects/<git-key>/{wiki,public}`; rewrites the README public span when the markers exist |
| `search` | `{ query, root?, limit?, mode?, tethers? }` | FTS5 over extract. `limit` 1–100, default 10. `mode`: `lexical` \| `fusion` (default, lexical stub). `semantic` → `SearchModeUnavailableError` |

`fail_on` is not a lint JSON field. It lives in repo-root `.tether.json` as an array of kinds or a kind→boolean map. Default: every closed kind. `.tether.json` may also add `allowlist` names (extends the default markdown allowlist).

Search corpus, in order: `tethers` in the payload, else `extract.json` in the project cache, else existing `search.sqlite`. Extract and compile do **not** write `extract.json`. No corpus → `SearchCorpusEmptyError`. Search indexes extract prose, symbols, refs, and example bodies as text — never the wiki.

Compile wiki: `wiki/` every tether, stacked innermost first (symbol → file sidecar → enclosing folders → root). Page YAML frontmatter is extract facts. `public/` is `@public` only, plus `nav.md`.

## Facts

Lint emits only these kinds. No severity, age, or attest.

| kind | proven when |
|---|---|
| `rogue_document` | tracked `*.md` / `*.txt` not on the allowlist and not honorary |
| `ill_formed` | sidecar or `@tether` does not parse, `@symbol` disagrees with adjacency, or a marked comment is unbound |
| `duplicate_id` | two tethers share an explicit `@symbol` name |
| `host_missing` | derived host path, symbol, or directory is gone |
| `host_fingerprint_changed` | host fingerprint at HEAD ≠ fingerprint at the last commit that touched the tether |
| `ref_missing` | `@ref` target not found. May include `candidates` (N≤4) on a unique same-file shape match |
| `symbol_missing` | `@symbol` on a file host is not in that file |
| `symbol_ambiguous` | `@symbol` matches more than one declaration in that file |
| `ref_fingerprint_changed` | that target's fingerprint changed since the tether last changed |
| `public_surface_stale` | some `@public` tether exists and `README.md` has no non-empty `<!-- tether:public -->` span |

A rename is `host_fingerprint_changed` (comment moved with the decl) or `host_missing` (it did not). There is no rename kind. Reformat does not change the fingerprint.

## Files

In the repo (location is the bind):

| artifact | host |
|---|---|
| marked comment immediately above a declaration | that declaration (symbol) |
| `foo.ts.tether` beside `foo.ts` | file `foo.ts` |
| `src.tether` beside directory `src/` | folder `src/` |
| `root.tether` at repo root | repository |
| `AGENTS.md` / `CLAUDE.md` | honorary folder of their directory |
| `.tether.json` | lint config (`fail_on`, extra `allowlist`) — not doctrine |
| `README.md` markers | `<!-- tether:public -->` … `<!-- /tether:public -->` |

Do not use a `.tether` file *inside* the folder as a second folder convention. Do not create a repo-local `.tether/` cache.

State (`$TETHER_HOME` or `~/.config/tether/projects/<git-key>/`):

| path | who writes it |
|---|---|
| `wiki/` | `compile` |
| `public/` and `public/nav.md` | `compile` |
| `extract.json` | you, optional, for search |
| `search.sqlite` | `search`, when it indexes `tethers` or `extract.json` |

Git key = normalized origin URL with `/` and `:` → `__`, else sha256 of the repo root.

Default allowlist: `README.md`, `LICENSE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `CHANGELOG.md`, `AUTHORS.md`, `NOTICE.md`. Honorary: `AGENTS.md`, `CLAUDE.md`.

## Vs rogue markdown

| rogue `.md` | tether |
|---|---|
| host is implied | host is the file location |
| freshness is a vibe | freshness is a recomputed fact |
| agents open it first | agents query extract / wiki with facts on the page |
| cheap to write, expensive forever | cost is visible; cull or keep |

## Language

See `root.tether` in a tether repo (this one: `/Users/guilhermecastro/Projects/tether/root.tether`). Closed directives: `@symbol`, `@ref`, `@public`, `doc { }`, `example <lang> { }`. Inline: comment starting `@tether` immediately above a declaration.

Extract languages: `javascript`, `typescript`, `tsx`, `rust`, `golang`, `ruby`, `swift`, `python`.

## Not yet

- No `index` command. Indexing is a search side-effect.
- `capabilities` / `schema` / `examples` list only doctor + discovery. They do not yet describe `extract`, `lint`, `compile`, or `search`.
- Semantic embeddings. `mode: "fusion"` ranks lexical FTS5 only and says so in the payload.
- Extract / compile do not persist `extract.json`.
- Lint `public_surface_stale` does not yet compare the README span (or public tree hash) to a compile; it only flags a missing or empty span when `@public` tethers exist.
- Quartz-powered refs, `@quartz`, session search, an attest command, bind tables, a committed `docs/` wiki.
- Elixir and C++ extract.

## Multi-agent

Other agents may be writing in the same folder. Own a path. Commit only that path. Never trash work you did not create.
