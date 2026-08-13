import { describe, expect, it } from "@effect/vitest"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { golang } from "../../../src/extract/languages/golang"

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
  readonly fields?: Readonly<Record<string, unknown>>
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-go/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

const fieldsOf = (type: string): readonly string[] => {
  const entry = nodeTypes.find((node) => node.type === type && node.named === true)
  return entry?.fields === undefined ? [] : Object.keys(entry.fields)
}

describe("golang language profile", () => {
  it("has a complete table", () => {
    for (const key of requiredKeys) {
      expect(golang[key], key).toBeDefined()
    }

    expect(golang.id).toBe("golang")
    expect(golang.extensions).toEqual(["go"])
    expect(golang.grammar).toBe("tree-sitter-go/tree-sitter-go.wasm")
    expect(golang.comment_kinds).toEqual(["comment"])
    expect(golang.skip_kinds).toEqual([])
    expect(golang.declaration_kinds.length).toBeGreaterThan(0)
    expect(golang.declaration_kinds).toEqual(
      expect.arrayContaining([
        "function_declaration",
        "method_declaration",
        "type_spec",
        "type_alias",
        "const_spec",
        "var_spec",
      ]),
    )
    expect(golang.unwrap_kinds).toEqual(
      expect.arrayContaining([
        "type_declaration",
        "const_declaration",
        "var_declaration",
        "var_spec_list",
      ]),
    )
    expect(golang.name_fields).toEqual(["name"])

    for (const kind of [
      ...golang.comment_kinds,
      ...golang.skip_kinds,
      ...golang.declaration_kinds,
      ...golang.unwrap_kinds,
    ]) {
      expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
    }

    for (const kind of golang.declaration_kinds) {
      const fields = fieldsOf(kind)
      expect(
        golang.name_fields.some((field) => fields.includes(field)),
        `${kind} has no name field in ${golang.name_fields.join(",")}`,
      ).toBe(true)
    }

    expect(existsSync(require.resolve(golang.grammar))).toBe(true)
  })

  it("ships adjacency and negative fixtures", () => {
    const source = readFileSync(join(fixtureDir, "sample.go"), "utf8")
    expect(source).toMatch(/\/\/ @tether[\s\S]*?^func greetGo\(/m)
    expect(source).toMatch(/func skipInner\(\) \{[\s\S]*_ = 0/)
  })
})
