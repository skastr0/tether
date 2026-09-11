import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"
import { extractRepo } from "../../src/extract/walk"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/tsx-bare-ampersand-in-jsx-text")
const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const fixtureRepo = {
  "src/stats.tsx": readFixture("src/stats.tsx.txt"),
  "src/kind-surface.tsx": readFixture("src/kind-surface.tsx.txt"),
}

describe("bare & in JSX text", () => {
  it("parses a literal ampersand inside JSX text", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/stats.tsx"], "tsx")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["StatsTitle"]),
    )
  })

  it("parses an ampersand after an expression child and still accepts entities", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/kind-surface.tsx"], "tsx")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["KindSurface", "EntityLabel"]),
    )
  })

  it("still reports a real syntax error", async () => {
    const result = await snapLanguageSource("export function broken( {\n", "tsx")
    expect(result?.status).toBe("syntax_error")
  })

  it("extracts a fixture repository without syntax_error coverage", async () => {
    await withTempDir("tether-tsx-bare-ampersand-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("complete")
      expect(extracted.coverage.extraction.unchecked).toEqual([])
      expect(extracted.facts).toEqual([])
      const names = extracted.tethers.flatMap((tether) =>
        tether.host.kind === "symbol" ? [tether.host.name] : [],
      )
      expect(names).toEqual(expect.arrayContaining(["StatsTitle", "KindSurface", "EntityLabel"]))
    })
  })
})
