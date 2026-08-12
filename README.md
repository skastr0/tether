# tether

Collocated doctrine that cannot silently rot.

Git is required. Location is the bind. Lint emits facts. The compiled wiki is derived and never committed.

```
tether doctor
tether extract '{"root":"."}'
tether lint '{"root":"."}'
tether compile '{"root":"."}'
tether search '{"query":"auth refresh"}'
```

## The problem

Standalone markdown in a repo goes stale the moment the code moves. Architecture notes, `AGENTS.md` dumps, `docs/` trees — they look like a shortcut. Agents prefer one file that claims to explain fifty others over reading the fifty files. If that file is a month old, the first option is poison.

You then pay one of three permanent taxes:

1. **Poison** — agents trust stale prose.
2. **Attention** — you remember to say “ignore the docs, read the code.”
3. **Throughput** — you stop building and rewrite documents you already knew in the session.

Updating the docs only returns the context you already have. Not updating them holds the project hostage. Not writing them at all holds you hostage to session archaeology.

The failure is not “we need better writers.” The failure is **homeless prose**: text that is not structurally tied to the code it describes, so forgetting to refresh it cannot be detected.

## What tether does

A **tether** is doctrine sitting on its host:

- a marked comment immediately above a declaration (symbol host)
- `foo.ts.tether` beside `foo.ts` (file host)
- `src.tether` beside the `src/` directory (folder host)
- `root.tether` at the repo root (repo host)

There is no bind table. The host is derived from where the text sits. Optional `@ref` / `@symbol` name extra targets. They are never required for the host.

Git plus the AST prove a closed set of **facts** (host gone, fingerprint changed, ref missing, rogue `*.md`/`*.txt`, …). Lint prints facts. Config may map fact kinds to exit codes. The tool never says “mild,” “meaningful,” or “you should.”

`compile` writes a mirrored markdown wiki under `~/.config/tether/projects/<git-key>/wiki/` (or `$TETHER_HOME`). That wiki is a view. Search runs on the extract, not on the view.

Independent tracked markdown is illegal except an allowlist (README, LICENSE, SECURITY, …) and honorary `AGENTS.md` / `CLAUDE.md`, which are folder-scoped pre-steer files that should point at tether rather than describe the project.

## Not this

- Not JSDoc, rustdoc, or API reference. Types and signatures stay in the type system.
- Not session memory. That is a different corpus.
- Not a spec-keeper that asks you to manually bind `docs/auth.md` to files. Manual binds are optional extras. Forgetting them cannot hide a tether.

## This repo

Tether is built with tether. Project doctrine lives in `root.tether` (the language spec) and in collocated `.tether` files / comments. Honorary `AGENTS.md` only steers agents toward those surfaces.

See `root.tether` for the full language and fact taxonomy. See `skills/tether/SKILL.md` for how agents should document a project.
