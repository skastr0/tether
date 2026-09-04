import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { resolveRuntimeWasm, resolveWasmAsset } from "../../src/extract/assets"
import { LANGUAGE_IDS } from "../../src/extract/languages"
import { profileForLanguage } from "../../src/extract/parser"

describe("source WASM assets", () => {
  it("resolves the runtime and every grammar from installed dependencies", () => {
    expect(existsSync(resolveRuntimeWasm())).toBe(true)
    for (const id of LANGUAGE_IDS) {
      expect(existsSync(resolveWasmAsset(profileForLanguage(id).grammar))).toBe(true)
    }
  })
})
