import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { javascript } from "../../../src/extract/languages/javascript"

const require = createRequire(import.meta.url)
const fixtureDir = dirname(fileURLToPath(import.meta.url))

const requiredKeys = [
  "id",
  "extensions",
  "grammar",
  "comment_kinds",
  "skip_kinds",
  "declaration_kinds",
  "unwrap_kinds",
  "name_fields",
] as const satisfies readonly (keyof LanguageProfile)[]

interface GrammarNodeType {
  readonly type: string
  readonly named?: boolean
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-javascript/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

describe("javascript language profile", () => {
  it("has a complete table", () => {
    for (const key of requiredKeys) {
      expect(javascript[key], key).toBeDefined()
    }

    expect(javascript.id).toBe("javascript")
    expect(javascript.extensions).toEqual(["js", "mjs", "cjs"])
    expect(javascript.grammar).toBe("tree-sitter-javascript/tree-sitter-javascript.wasm")
    expect(javascript.comment_kinds).toEqual(["comment", "html_comment"])
    expect(javascript.skip_kinds).toEqual(["decorator"])
    expect(javascript.declaration_kinds).toEqual(
      expect.arrayContaining([
        "function_declaration",
        "generator_function_declaration",
        "class_declaration",
        "lexical_declaration",
        "variable_declaration",
        "method_definition",
        "field_definition",
      ]),
    )
    expect(javascript.unwrap_kinds).toEqual(["export_statement"])
    expect(javascript.name_fields).toEqual(["name", "property"])

    for (const kind of [
      ...javascript.comment_kinds,
      ...javascript.skip_kinds,
      ...javascript.declaration_kinds,
      ...javascript.unwrap_kinds,
    ]) {
      expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
    }

    expect(existsSync(require.resolve(javascript.grammar))).toBe(true)
  })

  it("ships an adjacency fixture with one bind and one inner negative", () => {
    const fixture = readFileSync(join(fixtureDir, "adjacency.js"), "utf8")
    expect(fixture).toMatch(/^\/\/ @tether\n[\s\S]*\nexport function greetJs\(/)
    expect(fixture).toMatch(/export function greetJs\([\s\S]*\/\/ @tether/)
    expect(fixture).toMatch(/\/\/ @tether\n[\s\S]*\n\s+const x = 1/)
  })
})
