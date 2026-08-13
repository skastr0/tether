# Production battery

We test tether on code people actually write. Not tree-sitter node catalogs.

Each language owns `test/battery/<id>/`. Import `../harness.ts`.

## What to prove

1. **Inline function** — `@tether` + `@symbol` on a function, extract binds that name.
2. **Inline type** — class / struct / interface (whatever that language uses as a type).
3. **Inline method** — `@tether` on a method inside a type.
4. **File sidecar** — `foo.<ext>.tether` with `@symbol` for a type in that file, plus a `doc` about the file.
5. **Facts** — `facts.test.ts`: the lint facts that fire on real mistakes (wrong `@symbol`, missing host, missing ref, fingerprint after a real edit, duplicate `@symbol`).
6. **One production file** — a small module with a few functions/types/methods and a sidecar. Not 80 generated decls.

## Do not

- Do not add a test per AST `declaration_kinds` entry.
- Do not test import aliases, impl-identity, union items, `.d.ts` signatures, etc.
- Do not skip tests. If we do not support a construct as a host, it is not in the suite.
- Shared facts `rogue_document` and `public_surface_stale` live in `test/battery/shared/`.
