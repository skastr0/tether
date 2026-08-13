import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { ruby } from "../../../src/extract/languages/ruby"

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

const requiredDeclarations = [
  "method",
  "singleton_method",
  "class",
  "module",
  "singleton_class",
  "alias",
] as const

interface GrammarNodeType {
  readonly type: string
  readonly named?: boolean
  readonly fields?: Readonly<Record<string, unknown>>
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-ruby/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

const fieldsOf = (type: string): readonly string[] => {
  const entry = nodeTypes.find((node) => node.type === type && node.named === true)
  return entry?.fields === undefined ? [] : Object.keys(entry.fields)
}

describe("ruby language profile", () => {
  it("has a complete table", () => {
    for (const key of requiredKeys) {
      expect(ruby[key], key).toBeDefined()
    }

    expect(ruby.id).toBe("ruby")
    expect(ruby.extensions).toEqual(["rb"])
    expect(ruby.grammar).toBe("tree-sitter-ruby/tree-sitter-ruby.wasm")
    expect(ruby.comment_kinds).toEqual(["comment"])
    expect(ruby.skip_kinds).toEqual([])
    expect(ruby.declaration_kinds).toEqual(expect.arrayContaining([...requiredDeclarations]))
    expect(ruby.unwrap_kinds).toEqual([])
    expect(ruby.name_fields).toEqual(["name", "value"])

    for (const kind of [
      ...ruby.comment_kinds,
      ...ruby.skip_kinds,
      ...ruby.declaration_kinds,
      ...ruby.unwrap_kinds,
    ]) {
      expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
    }

    for (const kind of ruby.declaration_kinds) {
      const fields = fieldsOf(kind)
      expect(
        ruby.name_fields.some((field) => fields.includes(field)),
        `${kind} has no name field in ${ruby.name_fields.join(",")}`,
      ).toBe(true)
    }

    expect(existsSync(require.resolve(ruby.grammar))).toBe(true)
  })

  it("ships adjacency and negative fixtures", () => {
    const source = readFileSync(join(fixtureDir, "adjacency.rb"), "utf8")
    expect(source).toMatch(/^# @tether[\s\S]*?^def greetRb\(/m)
    expect(source).toMatch(/def greetRb\([\s\S]*prefix = "hello"/)
  })
})
