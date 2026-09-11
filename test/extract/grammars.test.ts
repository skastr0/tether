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
const IMPORT_TYPE_ARRAY = 'type Entries = import("node:fs").Dirent[];'
const EXPORT_TYPE_STAR = 'export type * from "./model.js";'
const EXPORT_TYPE_STAR_AS = 'export type * as SlotValues from "./calibration-slot-values.js";'
const JSX_BARE_AMPERSAND = "export const a = <div>me & you</div>\n"
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
        "1a7122f5eb647b2a55e3998ab29ed3b3271a3c2571494ed86294a9c76a830be5",
      )
    }
    if (existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-tsx.wasm"))) {
      expect(tsx.source).toBe("vendored")
      expect(tsx.sha256).toBe("90693307da3bdd7fbd4eacf666c3b2967a04dff6f389072681412aa800fc0c4e")
    }
    expect(inspectGrammarAsset("javascript").source).toBe("npm")
  })

  it("loads rust from the vendored slot when present", () => {
    const rust = inspectGrammarAsset("rust")
    if (existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-rust.wasm"))) {
      expect(rust.source).toBe("vendored")
      expect(rust.sha256).toBe("7b9eece48a00b201ce55179d8ba9d2c703069ef2b6eb46b042c98c54ffffa794")
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

  it.skipIf(!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-typescript.wasm")))(
    "parses a type-only star re-export",
    async () => {
      const resolved = inspectGrammarAsset("typescript")
      expect(resolved.source).toBe("vendored")
      await initParser()
      const language = await Language.load(resolved.path)
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const tree = parser.parse(`${EXPORT_TYPE_STAR}\n${EXPORT_TYPE_STAR_AS}\n`)
        expect(tree).not.toBeNull()
        expect(tree!.rootNode.hasError).toBe(false)
        expect(tree!.rootNode.descendantsOfType("export_statement")).toHaveLength(2)
        expect(tree!.rootNode.descendantsOfType("namespace_export")[0]?.text).toContain("SlotValues")
      } finally {
        parser.delete()
      }
    },
  )

  it.skipIf(!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-typescript.wasm")))(
    "parses an import() type with an array suffix",
    async () => {
      const resolved = inspectGrammarAsset("typescript")
      expect(resolved.source).toBe("vendored")
      await initParser()
      const language = await Language.load(resolved.path)
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const tree = parser.parse(IMPORT_TYPE_ARRAY)
        expect(tree).not.toBeNull()
        expect(tree!.rootNode.hasError).toBe(false)
        expect(tree!.rootNode.descendantsOfType("array_type")[0]).toBeDefined()
      } finally {
        parser.delete()
      }
    },
  )

  it.skipIf(!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-tsx.wasm")))(
    "parses a literal ampersand in JSX text",
    async () => {
      const resolved = inspectGrammarAsset("tsx")
      expect(resolved.source).toBe("vendored")
      await initParser()
      const language = await Language.load(resolved.path)
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const tree = parser.parse(JSX_BARE_AMPERSAND)
        expect(tree).not.toBeNull()
        expect(tree!.rootNode.hasError).toBe(false)
        expect(tree!.rootNode.text).toContain("me & you")
      } finally {
        parser.delete()
      }
    },
  )

  it.skipIf(!existsSync(join(defaultVendoredGrammarDir(), "tree-sitter-rust.wasm")))(
    "parses a borrow of an identifier named raw with the vendored grammar",
    async () => {
      const resolved = inspectGrammarAsset("rust")
      expect(resolved.source).toBe("vendored")
      await initParser()
      const language = await Language.load(resolved.path)
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const tree = parser.parse("fn g(){ let raw = 1i32; let _ = &raw; }")
        expect(tree).not.toBeNull()
        expect(tree!.rootNode.hasError).toBe(false)
        const refs = tree!.rootNode.descendantsOfType("reference_expression")
        expect(refs).toHaveLength(1)
        expect(refs[0]?.childForFieldName("value")?.text).toBe("raw")
      } finally {
        parser.delete()
      }
    },
  )
})
