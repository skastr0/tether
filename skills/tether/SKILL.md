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
- Use `@ref path#Symbol` when the prose names another host.
- After changing a host, update or delete the tether in the same commit.
- Prefer deleting a tether you will not maintain. Cull is in-bounds.
- Point `AGENTS.md` at tether. Do not put project architecture in `AGENTS.md`.

## Do not

- Do not add tracked `.md` / `.txt` except the allowlist (README, LICENSE, SECURITY, …) or honorary `AGENTS.md` / `CLAUDE.md`.
- Do not write JSDoc as a substitute for doctrine (or doctrine as a substitute for types).
- Do not keep a `docs/` tree “for agents.”
- Do not invent severity, owners, or dates-as-fields in the language.
- Do not store compiled wiki output in the repo.

## Expect

```
tether extract '{"root":"."}'
tether lint '{"root":"."}'
```

Lint lists facts (`host_fingerprint_changed`, `ref_missing`, `rogue_document`, …). Fix the tether or delete it. Config `fail_on` decides the exit code.

Compiled reading surface (derived, outside the repo):

```
tether compile '{"root":"."}'
```

Wiki lives under `~/.config/tether/projects/<git-key>/wiki/`.

## Vs rogue markdown

| rogue `.md` | tether |
|---|---|
| host is implied | host is the file location |
| freshness is a vibe | freshness is a recomputed fact |
| agents open it first | agents query extract / wiki with facts on the page |
| cheap to write, expensive forever | cost is visible; cull or keep |

## Language

See `root.tether` in a tether repo (this one: `/Users/guilhermecastro/Projects/tether/root.tether`). Closed directives: `@symbol`, `@ref`, `doc { }`. Inline: comment starting `@tether` immediately above a declaration.

## Multi-agent

Other agents may be writing in the same folder. Own a path. Commit only that path. Never trash work you did not create.
