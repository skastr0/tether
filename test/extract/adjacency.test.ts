import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Language, Parser, type Tree } from "web-tree-sitter"
import { beforeAll, describe, expect, it } from "vitest"

import {
  collectAdjacentBinds,
  declarationName,
  isMarkedComment,
} from "../../src/extract/adjacency"
import { golang } from "../../src/extract/languages/golang"
import { javascript } from "../../src/extract/languages/javascript"
import type { LanguageProfile } from "../../src/extract/languages/index"
import { python } from "../../src/extract/languages/python"
import { ruby } from "../../src/extract/languages/ruby"
import { rust } from "../../src/extract/languages/rust"
import { swift } from "../../src/extract/languages/swift"
import { typescript } from "../../src/extract/languages/typescript"

const require = createRequire(import.meta.url)
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures")

const languageCache = new Map<string, Language>()

const hasGrammar = (profile: LanguageProfile): boolean => {
  try {
    require.resolve(profile.grammar)
    return true
  } catch {
    return false
  }
}

const parseWith = async (profile: LanguageProfile, source: string): Promise<Tree> => {
  let language = languageCache.get(profile.grammar)
  if (language === undefined) {
    language = await Language.load(require.resolve(profile.grammar))
    languageCache.set(profile.grammar, language)
  }
  const parser = new Parser()
  try {
    parser.setLanguage(language)
    const tree = parser.parse(source)
    if (tree === null) {
      throw new Error(`tree-sitter failed to parse ${profile.id}`)
    }
    return tree
  } finally {
    parser.delete()
  }
}

const bindNames = (tree: Tree, source: string, profile: LanguageProfile): readonly string[] =>
  collectAdjacentBinds(tree.rootNode, source, profile).map((bind) => bind.name ?? bind.declaration.type)

const fixtureCases = [
  { profile: typescript, file: "typescript/adjacency.ts", name: "greetTs" },
  { profile: javascript, file: "javascript/adjacency.js", name: "greetJs" },
  { profile: python, file: "python/bind.py", name: "greetPy" },
  { profile: rust, file: "rust/sample.rs", name: "greetRs" },
  { profile: golang, file: "golang/sample.go", name: "greetGo" },
  { profile: ruby, file: "ruby/adjacency.rb", name: "greetRb" },
  { profile: swift, file: "swift/adjacency.swift", name: "refreshSession" },
] as const

beforeAll(async () => {
  await Parser.init({
    locateFile: (scriptName: string) =>
      scriptName === "tree-sitter.wasm"
        ? require.resolve("web-tree-sitter/tree-sitter.wasm")
        : scriptName,
  })
})

describe("isMarkedComment", () => {
  it("accepts the first token after the comment marker", () => {
    expect(isMarkedComment("// @tether")).toBe(true)
    expect(isMarkedComment("// @tether\n// @symbol greet")).toBe(true)
    expect(isMarkedComment("/* @tether */")).toBe(true)
    expect(isMarkedComment("/** @tether\n * @symbol bar\n */")).toBe(true)
    expect(isMarkedComment("# @tether")).toBe(true)
    expect(isMarkedComment("<!-- @tether -->")).toBe(true)
    expect(isMarkedComment("// not a tether")).toBe(false)
    expect(isMarkedComment("// @tethered")).toBe(false)
  })
})

describe("inner-comment-does-not-bind", () => {
  it.each(fixtureCases.filter((entry) => hasGrammar(entry.profile)))(
    "$profile.id fixture",
    async ({ profile, file, name }) => {
      const source = readFileSync(join(fixtures, file), "utf8")
      const tree = await parseWith(profile, source)
      const binds = collectAdjacentBinds(tree.rootNode, source, profile)

      expect(binds).toHaveLength(1)
      expect(binds[0]?.name).toBe(name)
    },
  )
})

describe("adjacency", () => {
  it("binds a pending marked comment to the next declaration", async () => {
    const source = `// @tether
function greet() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["greet"])
  })

  it("allows a whitespace-only gap", async () => {
    const source = `// @tether

export function greet() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["greet"])
  })

  it("skips decorator nodes between the comment and the declaration", async () => {
    const source = `// @tether
@dec
export function foo() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["foo"])
  })

  it("skips rust attribute nodes in the gap", async () => {
    const source = `// @tether
#[derive(Debug)]
pub struct Foo;
`
    const tree = await parseWith(rust, source)
    expect(bindNames(tree, source, rust)).toEqual(["Foo"])
  })

  it("unwraps python decorated_definition", async () => {
    const source = `# @tether
@dec
def foo():
    pass
`
    const tree = await parseWith(python, source)
    expect(bindNames(tree, source, python)).toEqual(["foo"])
  })

  it("unwraps export wrappers onto the inner declaration", async () => {
    const source = `// @tether
export function greet() {}
`
    const tree = await parseWith(typescript, source)
    const binds = collectAdjacentBinds(tree.rootNode, source, typescript)
    const bind = binds[0]
    expect(binds).toHaveLength(1)
    expect(bind?.declaration.type).toBe("function_declaration")
    expect(bind?.name).toBe("greet")
    expect(bind ? declarationName(bind.declaration, typescript) : undefined).toBe("greet")
  })

  it("unwraps go type_declaration onto the type_spec", async () => {
    const source = `package p
// @tether
type Foo struct{}
`
    const tree = await parseWith(golang, source)
    const binds = collectAdjacentBinds(tree.rootNode, source, golang)
    expect(binds).toHaveLength(1)
    expect(binds[0]?.declaration.type).toBe("type_spec")
    expect(binds[0]?.name).toBe("Foo")
  })

  it("is not nearest-enclosing", async () => {
    const source = `function outer() {
  // @tether
  return 1
}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual([])
  })

  it("does not bind a declaration nested in a function body", async () => {
    const source = `function outer() {
  // @tether
  function inner() {}
}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual([])
  })

  it("does not bind a python nested def through the body block", async () => {
    const source = `def outer():
    # @tether
    def inner():
        pass
`
    const tree = await parseWith(python, source)
    expect(bindNames(tree, source, python)).toEqual([])
  })

  it("does not bind an inner lexical declaration", async () => {
    const source = `function greet() {
  // @tether
  const x = 1
}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual([])
  })

  it("does not bind an inner var declaration", async () => {
    const source = `function greet() {
  // @tether
  var x = 1
}
`
    const tree = await parseWith(javascript, source)
    expect(bindNames(tree, source, javascript)).toEqual([])
  })

  it("does not bind a lexical inside a single-parameter arrow body", async () => {
    const source = `const greet = x => {
  // @tether
  let y = 1
  return x
}
`
    const tree = await parseWith(javascript, source)
    expect(bindNames(tree, source, javascript)).toEqual([])
  })

  it("does not bind a python assignment inside a function", async () => {
    const source = `def greet():
    # @tether
    x = 1
`
    const tree = await parseWith(python, source)
    expect(bindNames(tree, source, python)).toEqual([])
  })

  it("still binds a module-scope exported const", async () => {
    const source = `// @tether
export const greet = 1
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["greet"])
  })

  it("still binds a python class attribute", async () => {
    const source = `class Foo:
    # @tether
    x = 1
`
    const tree = await parseWith(python, source)
    expect(bindNames(tree, source, python)).toEqual(["x"])
  })

  it("binds the intervening declaration, not a later one", async () => {
    const source = `// @tether
const x = 1
export function greet() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["x"])
  })

  it("does not bind across a non-whitespace non-skip gap", async () => {
    const source = `// @tether
x + 1
function greet() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual([])
  })

  it("binds a class and a following method separately", async () => {
    const source = `// @tether
export class Foo {
  // @tether
  bar() {}
}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["Foo", "bar"])
  })

  it("binds a block comment to the next declaration", async () => {
    const source = `/** @tether
 * @symbol bar
 */
export const bar = 1
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual(["bar"])
  })

  it("does not bind an unmarked comment", async () => {
    const source = `// just a note
function greet() {}
`
    const tree = await parseWith(typescript, source)
    expect(bindNames(tree, source, typescript)).toEqual([])
  })
})
