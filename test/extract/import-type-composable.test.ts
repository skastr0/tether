import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"
import { extractRepo } from "../../src/extract/walk"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/import-type-composable")
const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const fixtureRepo = {
  "src/composable.ts": readFixture("src/composable.ts.txt"),
  "src/vitest-mock.ts": readFixture("src/vitest-mock.ts.txt"),
}

describe("import() types in composable position", () => {
  it("parses array, readonly, generic, indexed, and return-position import types", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/composable.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["Entries", "Blocks", "Effect", "Binding", "Hook", "entries", "Obj"]),
    )
  })

  it("parses typeof import() as a generic type argument on a call", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/vitest-mock.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)).toBeDefined()
  })

  it("still reports a real syntax error", async () => {
    const result = await snapLanguageSource("export function broken( {\n", "typescript")
    expect(result?.status).toBe("syntax_error")
  })

  it("still reports a syntax error after a runtime import()", async () => {
    const result = await snapLanguageSource('const p = import("fs");\nexport function broken( {\n', "typescript")
    expect(result?.status).toBe("syntax_error")
  })

  it("extracts a fixture repository without syntax_error coverage", async () => {
    await withTempDir("tether-import-type-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("complete")
      expect(extracted.coverage.extraction.unchecked).toEqual([])
      expect(extracted.facts).toEqual([])
      const names = extracted.tethers.flatMap((tether) =>
        tether.host.kind === "symbol" ? [tether.host.name] : [],
      )
      expect(names).toEqual(expect.arrayContaining(["Entries", "Blocks", "Effect", "Binding", "Hook", "entries", "Obj"]))
    })
  })
})
