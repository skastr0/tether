import { createRequire } from "node:module"
import { Language, Parser, type Node, type Tree } from "web-tree-sitter"
import { beforeAll, describe, expect, it } from "vitest"

import { fingerprint, shapeFingerprint } from "../../src/extract/fingerprint"
import { typescript } from "../../src/extract/languages/typescript"

const require = createRequire(import.meta.url)

let parser: Parser

const parse = (source: string): Tree => {
  const tree = parser.parse(source)
  if (tree === null) {
    throw new Error("tree-sitter failed to parse source")
  }
  return tree
}

const firstOfType = (tree: Tree, type: string): Node => {
  const node = tree.rootNode.descendantsOfType(type)[0]
  if (node === null || node === undefined) {
    throw new Error(`missing ${type}`)
  }
  return node
}

beforeAll(async () => {
  await Parser.init({
    locateFile: (scriptName: string) =>
      scriptName === "tree-sitter.wasm"
        ? require.resolve("web-tree-sitter/tree-sitter.wasm")
        : scriptName,
  })
  const language = await Language.load(require.resolve(typescript.grammar))
  parser = new Parser()
  parser.setLanguage(language)
})

describe("fingerprint", () => {
  it("is stable across reformat and comment extras", () => {
    const pretty = firstOfType(
      parse(`export function greet(name: string) {
  return name
}`),
      "function_declaration",
    )
    const compact = firstOfType(
      parse("export function greet(name: string){return name}"),
      "function_declaration",
    )
    const commented = firstOfType(
      parse(`export function greet(name: string) {
  // inner extra
  return name
}`),
      "function_declaration",
    )

    const fp = fingerprint(pretty, typescript)
    expect(fp).toBe(fingerprint(compact, typescript))
    expect(fp).toBe(fingerprint(commented, typescript))
    expect(fp.startsWith(`typescript@${pretty.tree.language.abiVersion}:`)).toBe(true)
  })

  it("changes when the declaration name is renamed", () => {
    const greet = firstOfType(
      parse("export function greet(name: string) { return name }"),
      "function_declaration",
    )
    const hello = firstOfType(
      parse("export function hello(name: string) { return name }"),
      "function_declaration",
    )

    expect(fingerprint(greet, typescript)).not.toBe(fingerprint(hello, typescript))
  })

  it("matches shape across a declaration rename", () => {
    const greet = firstOfType(
      parse("export function greet(name: string) { return name }"),
      "function_declaration",
    )
    const hello = firstOfType(
      parse("export function hello(name: string) { return name }"),
      "function_declaration",
    )
    const constFoo = firstOfType(parse("const foo = 1"), "lexical_declaration")
    const constBar = firstOfType(parse("const bar = 1"), "lexical_declaration")

    expect(shapeFingerprint(greet, typescript)).toBe(shapeFingerprint(hello, typescript))
    expect(shapeFingerprint(greet, typescript)).not.toBe(fingerprint(greet, typescript))
    expect(shapeFingerprint(constFoo, typescript)).toBe(shapeFingerprint(constBar, typescript))
    expect(fingerprint(constFoo, typescript)).not.toBe(fingerprint(constBar, typescript))
  })
})
