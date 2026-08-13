import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import type { LanguageProfile } from "../../../src/extract/languages/index"
import { tsx, typescript } from "../../../src/extract/languages/typescript"

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
  readonly subtypes?: readonly { readonly type: string }[]
}

const loadNamedTypes = (spec: string) => {
  const nodeTypes = JSON.parse(readFileSync(require.resolve(spec), "utf8")) as readonly GrammarNodeType[]
  return {
    nodeTypes,
    namedTypes: new Set(nodeTypes.filter((node) => node.named === true).map((node) => node.type)),
  }
}

const typescriptGrammar = loadNamedTypes(
  "tree-sitter-typescript/typescript/src/node-types.json",
)
const tsxGrammar = loadNamedTypes("tree-sitter-typescript/tsx/src/node-types.json")

const expectComplete = (
  profile: LanguageProfile,
  namedTypes: ReadonlySet<string>,
  nodeTypes: readonly GrammarNodeType[],
) => {
  for (const key of requiredKeys) {
    expect(profile[key], key).toBeDefined()
  }

  expect(profile.comment_kinds).toEqual(["comment", "html_comment"])
  expect(profile.skip_kinds).toEqual(["decorator"])
  expect(profile.declaration_kinds).toEqual(
    expect.arrayContaining([
      "function_declaration",
      "generator_function_declaration",
      "class_declaration",
      "lexical_declaration",
      "variable_declaration",
      "method_definition",
      "public_field_definition",
      "interface_declaration",
      "type_alias_declaration",
      "enum_declaration",
    ]),
  )
  expect(profile.unwrap_kinds).toEqual(["export_statement", "ambient_declaration"])
  expect(profile.name_fields).toEqual(["name"])

  for (const kind of [
    ...profile.comment_kinds,
    ...profile.skip_kinds,
    ...profile.declaration_kinds,
    ...profile.unwrap_kinds,
  ]) {
    expect(namedTypes.has(kind), `missing grammar type: ${kind}`).toBe(true)
  }

  const declaration = nodeTypes.find((node) => node.type === "declaration")
  const classified = new Set([...profile.declaration_kinds, ...profile.unwrap_kinds])
  for (const sub of declaration?.subtypes ?? []) {
    expect(classified.has(sub.type), `unclassified declaration subtype: ${sub.type}`).toBe(true)
  }

  expect(existsSync(require.resolve(profile.grammar))).toBe(true)
}

describe("typescript language profile", () => {
  it("has a complete table", () => {
    expect(typescript.id).toBe("typescript")
    expect(typescript.extensions).toEqual(["ts"])
    expect(typescript.grammar).toBe("tree-sitter-typescript/tree-sitter-typescript.wasm")
    expectComplete(typescript, typescriptGrammar.namedTypes, typescriptGrammar.nodeTypes)
  })

  it("shares the table with tsx on the tsx wasm", () => {
    expect(tsx.id).toBe("tsx")
    expect(tsx.extensions).toEqual(["tsx"])
    expect(tsx.grammar).toBe("tree-sitter-typescript/tree-sitter-tsx.wasm")
    expect(tsx.comment_kinds).toEqual(typescript.comment_kinds)
    expect(tsx.skip_kinds).toEqual(typescript.skip_kinds)
    expect(tsx.declaration_kinds).toEqual(typescript.declaration_kinds)
    expect(tsx.unwrap_kinds).toEqual(typescript.unwrap_kinds)
    expect(tsx.name_fields).toEqual(typescript.name_fields)
    expectComplete(tsx, tsxGrammar.namedTypes, tsxGrammar.nodeTypes)
  })

  it("ships an adjacency fixture with one bind and one inner negative", () => {
    const fixture = readFileSync(join(fixtureDir, "adjacency.ts"), "utf8")
    expect(fixture).toMatch(/^\/\/ @tether\n[\s\S]*\nexport function greetTs\(/)
    expect(fixture).toMatch(/export function greetTs\([\s\S]*\/\/ @tether/)
    expect(fixture).toMatch(/\/\/ @tether\n[\s\S]*\n\s+const x = 1/)
  })
})
