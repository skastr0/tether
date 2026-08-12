import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { swift } from "../../../src/extract/languages/swift"

const require = createRequire(import.meta.url)

interface GrammarNodeType {
  readonly type: string
  readonly named?: boolean
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-swift/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

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

const requiredDeclarations = [
  "associatedtype_declaration",
  "class_declaration",
  "deinit_declaration",
  "enum_entry",
  "function_declaration",
  "init_declaration",
  "macro_declaration",
  "operator_declaration",
  "property_declaration",
  "protocol_declaration",
  "protocol_function_declaration",
  "protocol_property_declaration",
  "subscript_declaration",
  "typealias_declaration",
] as const

describe("swift language profile", () => {
  it("has a complete table", () => {
    for (const key of requiredKeys) {
      expect(swift[key], key).toBeDefined()
    }

    expect(swift.id).toBe("swift")
    expect(swift.extensions).toEqual(["swift"])
    expect(swift.grammar).toBe("tree-sitter-swift/tree-sitter-swift.wasm")
    expect(swift.comment_kinds).toEqual(["comment", "multiline_comment"])
    expect(swift.skip_kinds).toEqual(["attribute", "modifiers"])
    expect(swift.declaration_kinds).toEqual([...requiredDeclarations])
    expect(swift.unwrap_kinds).toEqual([])
    expect(swift.name_fields).toEqual(["name"])

    for (const kind of [
      ...swift.comment_kinds,
      ...swift.skip_kinds,
      ...swift.declaration_kinds,
      ...swift.unwrap_kinds,
    ]) {
      expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
    }
  })

  it("ships an adjacency fixture with one bind and one inner negative", () => {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "adjacency.swift"),
      "utf8",
    )
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), "adjacency.swift"))).toBe(
      true,
    )
    expect(fixture).toMatch(/^\/\/ @tether\n[\s\S]*\nfunc refreshSession\(/)
    expect(fixture).toMatch(/func ignoreInner\(\) \{[\s\S]*\/\/ @tether/)
  })
})
