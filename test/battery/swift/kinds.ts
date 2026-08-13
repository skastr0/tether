import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export const SWIFT_WASM_SKIP = (() => {
  try {
    require.resolve("tree-sitter-swift/tree-sitter-swift.wasm")
    return undefined
  } catch {
    return "tree-sitter-swift wasm cannot require.resolve"
  }
})()

export interface SwiftKindCase {
  readonly kind: string
  readonly name: string
  readonly file: string
  readonly inline: string
  readonly bare: string
}

export interface SwiftSkippedKind {
  readonly kind: string
  readonly reason: string
}

export const SWIFT_SKIPPED: readonly SwiftSkippedKind[] = [
  { kind: "deinit_declaration", reason: "deinit_declaration has no name field" },
  { kind: "macro_declaration", reason: "macro_declaration has no name field" },
  { kind: "operator_declaration", reason: "operator_declaration has no name field" },
  {
    kind: "protocol_property_declaration",
    reason: "name_field is a pattern including 'var'; @symbol cannot match",
  },
]

const marked = (name: string, body: string): string => `// @tether
// @symbol ${name}
${body}
`

export const SWIFT_KINDS: readonly SwiftKindCase[] = [
  {
    kind: "associatedtype_declaration",
    name: "SwAssoc",
    file: "SwAssoc.swift",
    inline: `protocol SwAssocHost {
${marked("SwAssoc", "    associatedtype SwAssoc")}
}
`,
    bare: `protocol SwAssocHost {
    associatedtype SwAssoc
}
`,
  },
  {
    kind: "class_declaration",
    name: "SwClass",
    file: "SwClass.swift",
    inline: marked("SwClass", "class SwClass {}"),
    bare: "class SwClass {}\n",
  },
  {
    kind: "enum_entry",
    name: "SwCase",
    file: "SwCase.swift",
    inline: `enum SwEnumHost {
${marked("SwCase", "    case SwCase")}
}
`,
    bare: `enum SwEnumHost {
    case SwCase
}
`,
  },
  {
    kind: "function_declaration",
    name: "swFn",
    file: "swFn.swift",
    inline: marked("swFn", "func swFn() {}"),
    bare: "func swFn() {}\n",
  },
  {
    kind: "init_declaration",
    name: "init",
    file: "swInit.swift",
    inline: `class SwInitHost {
${marked("init", "    init() {}")}
}
`,
    bare: `class SwInitHost {
    init() {}
}
`,
  },
  {
    kind: "property_declaration",
    name: "SwProp",
    file: "SwProp.swift",
    inline: marked("SwProp", "let SwProp = 1"),
    bare: "let SwProp = 1\n",
  },
  {
    kind: "protocol_declaration",
    name: "SwProto",
    file: "SwProto.swift",
    inline: marked("SwProto", "protocol SwProto {}"),
    bare: "protocol SwProto {}\n",
  },
  {
    kind: "protocol_function_declaration",
    name: "swProtoFn",
    file: "swProtoFn.swift",
    inline: `protocol SwProtoFnHost {
${marked("swProtoFn", "    func swProtoFn()")}
}
`,
    bare: `protocol SwProtoFnHost {
    func swProtoFn()
}
`,
  },
  {
    kind: "subscript_declaration",
    name: "SwSub",
    file: "SwSub.swift",
    inline: `class SwSubHost {
${marked("SwSub", "    subscript(i: Int) -> SwSub { get { fatalError() } }")}
}
`,
    bare: `class SwSubHost {
    subscript(i: Int) -> SwSub { get { fatalError() } }
}
`,
  },
  {
    kind: "typealias_declaration",
    name: "SwAlias",
    file: "SwAlias.swift",
    inline: marked("SwAlias", "typealias SwAlias = Int"),
    bare: "typealias SwAlias = Int\n",
  },
]
