import { describe, expect, it } from "@effect/vitest"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { rust } from "../../../src/extract/languages/rust"

const require = createRequire(import.meta.url)
const fixtureDir = dirname(fileURLToPath(import.meta.url))

interface GrammarNodeType {
  readonly type: string
  readonly named?: boolean
  readonly fields?: Readonly<Record<string, unknown>>
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-rust/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

const fieldsOf = (type: string): readonly string[] => {
  const entry = nodeTypes.find((node) => node.type === type && node.named === true)
  return entry?.fields === undefined ? [] : Object.keys(entry.fields)
}

describe("rust language profile", () => {
  it("has a complete table", () => {
    expect(rust.id).toBe("rust")
    expect(rust.extensions).toEqual(["rs"])
    expect(rust.grammar).toBe("tree-sitter-rust/tree-sitter-rust.wasm")
    expect(rust.comment_kinds.length).toBeGreaterThan(0)
    expect(rust.declaration_kinds.length).toBeGreaterThan(0)
    expect(rust.name_fields.length).toBeGreaterThan(0)
    expect(Array.isArray(rust.skip_kinds)).toBe(true)
    expect(Array.isArray(rust.unwrap_kinds)).toBe(true)

    expect(rust.comment_kinds).toEqual(
      expect.arrayContaining(["line_comment", "block_comment"]),
    )
    expect(rust.skip_kinds).toEqual(
      expect.arrayContaining(["attribute_item", "inner_attribute_item"]),
    )
    expect(rust.declaration_kinds).not.toContain("let_declaration")

    for (const kind of [
      ...rust.comment_kinds,
      ...rust.skip_kinds,
      ...rust.declaration_kinds,
      ...rust.unwrap_kinds,
    ]) {
      expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
    }

    for (const kind of rust.declaration_kinds) {
      const fields = fieldsOf(kind)
      expect(
        rust.name_fields.some((field) => fields.includes(field)),
        `${kind} has no name field in ${rust.name_fields.join(",")}`,
      ).toBe(true)
    }

    expect(existsSync(require.resolve(rust.grammar))).toBe(true)
  })

  it("ships an adjacency fixture with one bind and one inner negative", () => {
    const source = readFileSync(join(fixtureDir, "sample.rs"), "utf8")
    expect(source).toMatch(/^\/\/ @tether\n[\s\S]*\npub fn greetRs\(/)
    expect(source).toMatch(/pub fn skip_inner\([\s\S]*let _n = 1/)
  })
})
