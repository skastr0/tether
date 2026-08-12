import { describe, expect, it } from "vitest"

import { FACT_KINDS } from "../../src/extract/types"
import { defaultFailOn, isRogueDocument, normalizeFailOn } from "../../src/facts/lint"

describe("fail_on and allowlist", () => {
  it("defaults fail_on to every closed kind", () => {
    expect(normalizeFailOn(undefined)).toEqual([...FACT_KINDS])
    expect(defaultFailOn()).toEqual([...FACT_KINDS])
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
    expect(isRogueDocument("AGENTS.md", ["README.md"])).toBe(false)
    expect(isRogueDocument("src/auth.ts", ["README.md"])).toBe(false)
  })
})
