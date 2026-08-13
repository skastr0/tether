# Language battery contract

Each language owns `test/battery/<id>/` only. Import helpers from `../harness.ts`.
Do not edit `src/**`, `package.json`, or another language's folder.

## Files to create

| file | contents |
|---|---|
| `symbols.inline.test.ts` | one `it()` per `declaration_kinds` entry: marked `@tether` + `@symbol Name` immediately above that construct; extract binds `host.name === Name` |
| `symbols.sidecar.test.ts` | same kinds, but doctrine in `foo.<ext>.tether` with `@symbol Name` (no inline comment); extract file-host + symbol claim |
| `facts.test.ts` | one `it()` per fact below, using this language's source |
| `scale.test.ts` | (1) one file ≥80 declarations, each with inline tether; (2) one sidecar `doc` ≥200 lines; extract stays correct, search/get still find a middle symbol |

## Facts (in `facts.test.ts`, this language)

Must cover, with a temp git repo via `harness`:

- `ill_formed` — `@symbol` name disagrees with the adjacent declaration
- `ill_formed` — `@symbol` on a folder/root tether (bare name)
- `symbol_missing` — `foo.<ext>.tether` `@symbol Gone` and Gone is not in the file
- `symbol_ambiguous` — two same-name decls in one file + sidecar `@symbol` that name
- `host_missing` — `gone.<ext>.tether` and no sibling file
- `host_fingerprint_changed` — commit tether, then change the host body (not a reformat) without touching the tether
- `ref_missing` — `@ref #Missing` on a file sidecar
- `ref_fingerprint_changed` — `@ref #Name` then change that symbol's body
- `duplicate_id` — two file sidecars in the repo both `@symbol Shared`

Skip (owned by `test/battery/shared/`): `rogue_document`, `public_surface_stale`.

## Rules

- Unique names (`jsFn`, `tsClass`, …). Never `@symbol greet`.
- Inner-body `@tether` is illegal (ill_formed). Do not plant those in fixtures.
- No skipped tests. If a node cannot be a named host, it does not belong in `declaration_kinds`.
- `bun test test/battery/<id>` must pass.
- Commit only `test/battery/<id>/**`.
