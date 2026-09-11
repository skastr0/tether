import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Language, Parser } from "web-tree-sitter"

import {
  defaultVendoredGrammarDir,
  resolveGrammarFile,
} from "../../src/extract/assets"
import { initParser, inspectGrammarAsset } from "../../src/extract/parser"

const require = createRequire(import.meta.url)
const TAGGED_OBJECT = "const rows = sql<{ a: string }>`SELECT 1`;"
const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("vendored grammar assets", () => {
  it("prefers a wasm file in the vendored directory over the npm package", () => {
    const dir = mkdtempSync(join(tmpdir(), "tether-vendored-grammar-"))
    scratch.push(dir)
    const specifier = "tree-sitter-typescript/tree-sitter-typescript.wasm"
    const stock = require.resolve(specifier)
    const vendored = join(dir, "tree-sitter-typescript.wasm")
    copyFileSync(stock, vendored)
    const resolved = resolveGrammarFile(specifier, dir)
    expect(resolved.source).toBe("vendored")
    expect(resolved.path).toBe(vendored)
    expect(resolved.sha256).toBe(createHash("sha256").update(readFileSync(vendored)).digest("hex"))
    expect(inspectGrammarAsset("javascript").source).toBe("npm")
  })

  it("loads typescript and tsx from the vendored slot when present", () => {
    const typescript = inspectGrammarAsset("typescript")
    const tsx = inspectGrammarAsset("tsx")
    if (existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-typescript.wasm"))) {
      expect(typescript.source).toBe("vendored")
      expect(typescript.sha256).toBe(
        "dbb05f13799d4f95ade1c8fef17ed3b009b04eadbabdf8c70fde07f8308683ca",
      )
    }
    if (existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-tsx.wasm"))) {
      expect(tsx.source).toBe("vendored")
      expect(tsx.sha256).toBe("2d98cb1f85f1a4a3e6c85fc0af9365d2f4829d78f54e46c13ea852633c1f067d")
    }
    expect(inspectGrammarAsset("javascript").source).toBe("npm")
  })

  it("reports npm when the vendored slot is empty", () => {
    const typescript = inspectGrammarAsset("typescript")
    const tsx = inspectGrammarAsset("tsx")
    if (!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-typescript.wasm"))) {
      expect(typescript.source).toBe("npm")
    }
    if (!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-tsx.wasm"))) {
      expect(tsx.source).toBe("npm")
    }
    expect(typescript.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(tsx.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it.skipIf(!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-typescript.wasm")))(
    "parses a tagged-template object type argument with the vendored grammar",
    async () => {
      const resolved = inspectGrammarAsset("typescript")
      expect(resolved.source).toBe("vendored")
      await initParser()
      const language = await Language.load(resolved.path)
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const tree = parser.parse(TAGGED_OBJECT)
        expect(tree).not.toBeNull()
        expect(tree!.rootNode.hasError).toBe(false)
        const call = tree!.rootNode.descendantsOfType("call_expression")[0]
        expect(call).toBeDefined()
        const fn = call?.childForFieldName("function")
        expect(fn?.type).toBe("instantiation_expression")
        expect(fn?.childForFieldName("type_arguments")?.type).toBe("type_arguments")
      } finally {
        parser.delete()
      }
    },
  )
})
