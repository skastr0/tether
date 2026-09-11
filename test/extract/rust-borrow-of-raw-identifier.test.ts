import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"
import { extractRepo } from "../../src/extract/walk"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/rust-borrow-of-raw-identifier")
const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const fixtureRepo = {
  "src/borrow.rs": readFixture("src/borrow.rs.txt"),
  "src/raw_ref.rs": readFixture("src/raw_ref.rs.txt"),
}

describe("borrow of an identifier named raw", () => {
  it("parses &raw as a normal borrow in call and list position", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/borrow.rs"], "rust")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["truncate_chars", "from_raw_json", "parse_file", "seal", "listed"]),
    )
  })

  it("parses the isolated &raw borrow and still accepts &raw const|mut", async () => {
    const result = await snapLanguageSource(fixtureRepo["src/raw_ref.rs"], "rust")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(
      expect.arrayContaining(["g", "raw_refs"]),
    )
  })

  it("still reports a real syntax error", async () => {
    const result = await snapLanguageSource("fn broken( {\n", "rust")
    expect(result?.status).toBe("syntax_error")
  })

  it("extracts a fixture repository without syntax_error coverage", async () => {
    await withTempDir("tether-rust-raw-borrow-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("complete")
      expect(extracted.coverage.extraction.unchecked).toEqual([])
      expect(extracted.facts).toEqual([])
      const names = extracted.tethers.flatMap((tether) =>
        tether.host.kind === "symbol" ? [tether.host.name] : [],
      )
      expect(names).toEqual(
        expect.arrayContaining(["truncate_chars", "from_raw_json", "parse_file", "seal", "listed", "g", "raw_refs"]),
      )
    })
  })
})
