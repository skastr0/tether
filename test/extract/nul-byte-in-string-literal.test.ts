import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"
import { extractRepo } from "../../src/extract/walk"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/nul-byte-in-string-literal")
const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const fixtureRepo = {
  "src/cache.ts": readFixture("src/cache.ts.txt"),
  "src/hash.ts": readFixture("src/hash.ts.txt"),
  "src/template.ts": readFixture("src/template.ts.txt"),
  "src/join.ts": readFixture("src/join.ts.txt"),
}

describe("U+0000 inside string and template literals", () => {
  it("parses a double-quoted string whose only contents are a raw NUL", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/cache.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["SEP"]))
  })

  it("parses hash.update with a raw-NUL string argument", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/hash.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["digest"]))
  })

  it("parses a template literal with a raw NUL between interpolations", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/template.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["keyFor"]))
  })

  it("parses tokens.join with a raw-NUL separator", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/join.ts"], "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["joinTokens"]))
  })

  it("parses the same double-quoted NUL string as javascript", async () => {
    const result = await snapLanguageSource('const SEP = "\0";\n', "javascript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["SEP"]))
  })

  it("still reports a real syntax error", async () => {
    const result = await snapLanguageSource("export function broken( {\n", "typescript")
    expect(result?.status).toBe("syntax_error")
  })

  it("still reports a syntax error when NUL is not inside a literal", async () => {
    const result = await snapLanguageSource("const fo\0o = 1\n", "typescript")
    expect(result?.status).toBe("syntax_error")
  })

  it("extracts a fixture repository without syntax_error coverage", async () => {
    await withTempDir("tether-nul-byte-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("complete")
      expect(extracted.coverage.extraction.unchecked).toEqual([])
      expect(extracted.facts).toEqual([])
      const names = extracted.tethers.flatMap((tether) =>
        tether.host.kind === "symbol" ? [tether.host.name] : [],
      )
      expect(names).toEqual(expect.arrayContaining(["SEP", "digest", "keyFor", "joinTokens"]))
    })
  })
})
