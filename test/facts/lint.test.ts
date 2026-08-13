import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { FACT_KINDS } from "../../src/extract/types"
import { collectFacts, defaultFailOn, isRogueDocument, loadTetherJson, normalizeFailOn } from "../../src/facts/lint"
import { withTempDir } from "../helpers/cli"

const LIVABLE_FAIL_ON = [
  "rogue_document",
  "ill_formed",
  "host_missing",
  "ref_missing",
  "symbol_missing",
  "symbol_ambiguous",
  "public_surface_stale",
] as const

describe("fail_on and allowlist", () => {
  it("defaults fail_on to the livable gate, not fingerprint kinds", () => {
    expect(normalizeFailOn(undefined)).toEqual([...LIVABLE_FAIL_ON])
    expect(defaultFailOn()).toEqual([...LIVABLE_FAIL_ON])
    expect(defaultFailOn()).not.toContain("host_fingerprint_changed")
    expect(defaultFailOn()).not.toContain("ref_fingerprint_changed")
    expect(defaultFailOn()).not.toContain("duplicate_id")
    expect(FACT_KINDS).toEqual(expect.arrayContaining([...defaultFailOn()]))
  })

  it("accepts an array or a kind-to-boolean map", () => {
    expect(normalizeFailOn(["ill_formed", "rogue_document"])).toEqual([
      "ill_formed",
      "rogue_document",
    ])
    expect(normalizeFailOn({ ill_formed: true, rogue_document: false })).toEqual(["ill_formed"])
    expect(normalizeFailOn([])).toEqual([])
  })

  it("rejects unknown kinds", () => {
    expect(() => normalizeFailOn(["mild"])).toThrow(/unknown fact kind/)
    expect(() => normalizeFailOn({ warning: true })).toThrow(/unknown fact kind/)
  })

  it("treats extra allowlist paths as not rogue", () => {
    expect(isRogueDocument("NOTES.md", ["README.md"])).toBe(true)
    expect(isRogueDocument("NOTES.md", ["README.md", "NOTES.md"])).toBe(false)
    expect(isRogueDocument("docs/guide.md", ["README.md", "docs/guide.md"])).toBe(false)
    expect(isRogueDocument("docs/README.md", ["README.md"])).toBe(true)
    expect(isRogueDocument("skills/tether/SKILL.md", ["README.md"])).toBe(false)
    expect(isRogueDocument("AGENTS.md", ["README.md"])).toBe(false)
    expect(isRogueDocument("src/auth.ts", ["README.md"])).toBe(false)
  })

  it("exports loadTetherJson defaults and collectFacts", async () => {
    await withTempDir("tether-facts-", async (root) => {
      const config = await Effect.runPromise(loadTetherJson(root))
      expect(config.fail_on).toEqual([...defaultFailOn()])
      expect(config.allowlist).toContain("README.md")
      expect(typeof collectFacts).toBe("function")
    })
  })
})
