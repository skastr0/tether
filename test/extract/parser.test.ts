import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from "web-tree-sitter"
import { LANGUAGE_IDS, type LanguageId } from "../../src/extract/languages"
import {
  initParser,
  languageForPath,
  loadLanguage,
  parseSource,
  profileForLanguage,
  resolveGrammarWasm,
} from "../../src/extract/parser"

const require = createRequire(import.meta.url)
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures")

const hasGrammarWasm = (id: LanguageId): boolean => {
  try {
    resolveGrammarWasm(id)
    return true
  } catch {
    return false
  }
}

const samples: Record<
  LanguageId,
  { readonly file?: string; readonly source: string; readonly root: string }
> = {
  javascript: {
    file: join(fixtures, "javascript/adjacency.js"),
    source: readFileSync(join(fixtures, "javascript/adjacency.js"), "utf8"),
    root: "program",
  },
  typescript: {
    file: join(fixtures, "typescript/adjacency.ts"),
    source: readFileSync(join(fixtures, "typescript/adjacency.ts"), "utf8"),
    root: "program",
  },
  tsx: {
    source: "export const Box = () => <div />\n",
    root: "program",
  },
  rust: {
    file: join(fixtures, "rust/sample.rs"),
    source: readFileSync(join(fixtures, "rust/sample.rs"), "utf8"),
    root: "source_file",
  },
  golang: {
    file: join(fixtures, "golang/sample.go"),
    source: readFileSync(join(fixtures, "golang/sample.go"), "utf8"),
    root: "source_file",
  },
  ruby: {
    file: join(fixtures, "ruby/adjacency.rb"),
    source: readFileSync(join(fixtures, "ruby/adjacency.rb"), "utf8"),
    root: "program",
  },
  python: {
    file: join(fixtures, "python/bind.py"),
    source: readFileSync(join(fixtures, "python/bind.py"), "utf8"),
    root: "module",
  },
}

describe("extract parser", () => {
  it("inits web-tree-sitter once and pins the 0.25.x runtime abi", async () => {
    await initParser()
    await initParser()

    const wasmPath = require.resolve("web-tree-sitter/tree-sitter.wasm")
    const pkg = JSON.parse(readFileSync(join(dirname(wasmPath), "package.json"), "utf8")) as {
      version: string
    }
    expect(pkg.version.startsWith("0.25.")).toBe(true)

    expect(LANGUAGE_VERSION).toBe(15)
    expect(MIN_COMPATIBLE_VERSION).toBe(13)
    expect(LANGUAGE_VERSION).toBeGreaterThanOrEqual(MIN_COMPATIBLE_VERSION)
  })

  it("loads each profile grammar wasm and parses a tree", async () => {
    for (const id of LANGUAGE_IDS) {
      if (!hasGrammarWasm(id)) {
        await expect(loadLanguage(id)).rejects.toMatchObject({
          _tag: "ExtractParserError",
          message: expect.stringContaining("grammar wasm not found"),
        })
        continue
      }

      const language = await loadLanguage(id)
      const again = await loadLanguage(id)
      expect(again).toBe(language)

      expect(language.abiVersion).toBeGreaterThanOrEqual(MIN_COMPATIBLE_VERSION)
      expect(language.abiVersion).toBeLessThanOrEqual(LANGUAGE_VERSION)

      const sample = samples[id]
      const tree = await parseSource(id, sample.source)
      expect(tree.rootNode.type).toBe(sample.root)
      expect(tree.rootNode.hasError).toBe(false)
    }
  })

  it("keeps marked comments as extra children on the typescript fixture", async () => {
    const tree = await parseSource("typescript", samples.typescript.source)
    const extras = tree.rootNode.children.filter(
      (node): node is NonNullable<typeof node> => node !== null && node.isExtra,
    )
    expect(extras.some((node) => node.type === "comment")).toBe(true)
    expect(
      tree.rootNode.descendantsOfType("function_declaration").some(
        (node) => node !== null && node.childForFieldName("name")?.text === "greetTs",
      ),
    ).toBe(true)
  })

  it("selects a language profile from the file extension", async () => {
    expect(languageForPath("src/session.ts")).toBe("typescript")
    expect(languageForPath("src/session.tsx")).toBe("tsx")
    expect(languageForPath("src/session.js")).toBe("javascript")
    expect(languageForPath("src/session.go")).toBe("golang")
    expect(languageForPath("README.md")).toBeUndefined()
    expect(profileForLanguage("tsx").grammar).toBe("tree-sitter-typescript/tree-sitter-tsx.wasm")

    const tree = await parseSource("typescript", samples.typescript.source)
    expect(tree.rootNode.type).toBe("program")
    expect(languageForPath("notes.md")).toBeUndefined()
  })
})
