import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { python } from "../../../src/extract/languages/python"

const require = createRequire(import.meta.url)

interface GrammarNodeType {
  readonly type: string
  readonly named?: boolean
  readonly fields?: Readonly<Record<string, unknown>>
}

const nodeTypes = JSON.parse(
  readFileSync(require.resolve("tree-sitter-python/src/node-types.json"), "utf8"),
) as readonly GrammarNodeType[]

const namedTypes = new Set(
  nodeTypes.filter((node) => node.named === true).map((node) => node.type),
)

const fieldsOf = (type: string): readonly string[] => {
  const entry = nodeTypes.find((node) => node.type === type && node.named === true)
  return entry?.fields === undefined ? [] : Object.keys(entry.fields)
}

const TABLE_KEYS = [
  "id",
  "extensions",
  "grammar",
  "comment_kinds",
  "skip_kinds",
  "declaration_kinds",
  "unwrap_kinds",
  "name_fields",
] as const satisfies readonly (keyof LanguageProfile)[]

test("python language profile table is complete", () => {
  for (const key of TABLE_KEYS) {
    expect(python[key], key).toBeDefined()
  }

  expect(python.id).toBe("python")
  expect(python.extensions).toEqual(["py"])
  expect(python.grammar).toBe("tree-sitter-python/tree-sitter-python.wasm")
  expect(python.comment_kinds.length).toBeGreaterThan(0)
  expect(python.declaration_kinds.length).toBeGreaterThan(0)
  expect(python.name_fields.length).toBeGreaterThan(0)
  expect(Array.isArray(python.skip_kinds)).toBe(true)
  expect(Array.isArray(python.unwrap_kinds)).toBe(true)

  for (const kind of [
    ...python.comment_kinds,
    ...python.skip_kinds,
    ...python.declaration_kinds,
    ...python.unwrap_kinds,
  ]) {
    expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
  }

  for (const kind of python.declaration_kinds) {
    const fields = fieldsOf(kind)
    expect(
      python.name_fields.some((field) => fields.includes(field)),
      `${kind} has no name field in ${python.name_fields.join(",")}`,
    ).toBe(true)
  }

  expect(existsSync(require.resolve(python.grammar))).toBe(true)
})

test("python fixture has one adjacency bind and one inner negative", () => {
  const fixture = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "bind.py"),
    "utf8",
  )
  expect(fixture).toMatch(/^# @tether\n[\s\S]*\ndef greetPy\(/)
  expect(fixture).toMatch(/def greetPy\([\s\S]*# @tether/)
  expect(fixture).toMatch(/# @tether\n[\s\S]*\n\s+x = 1/)
})
