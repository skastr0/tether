import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"
import { extractRepo } from "../../src/extract/walk"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/ts-export-type-star")
const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const fixtureRepo = {
  "src/reexport.ts": readFixture("src/reexport.ts.txt"),
  "src/index.ts": readFixture("src/index.ts.txt"),
}

describe("export type * re-exports", () => {
  it("parses type-only star and namespace re-exports", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/reexport.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["Model", "createAnalyzer"]),
    )
  })

  it("parses export type * mixed with value exports", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/index.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["QuartzAnalyzer"]),
    )
  })

  it("still reports a real syntax error", async () => {
    const result = await snapLanguageSource("export function broken( {\n", "typescript")
    expect(result?.status).toBe("syntax_error")
  })

  it("extracts a fixture repository without syntax_error coverage", async () => {
    await withTempDir("tether-export-type-star-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("complete")
      expect(extracted.coverage.extraction.unchecked).toEqual([])
      expect(extracted.facts).toEqual([])
      const names = extracted.tethers.flatMap((tether) =>
        tether.host.kind === "symbol" ? [tether.host.name] : [],
      )
      expect(names).toEqual(expect.arrayContaining(["Model", "createAnalyzer", "QuartzAnalyzer"]))
    })
  })
})
