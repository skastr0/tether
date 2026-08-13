export interface JsKindCase {
  readonly kind: string
  readonly name: string
  readonly file: string
  readonly inline: string
  readonly bare: string
}

export const JS_KINDS: readonly JsKindCase[] = [
  {
    kind: "function_declaration",
    name: "jsFn",
    file: "src/jsFn.js",
    inline: `// @tether
// @symbol jsFn
function jsFn() {
  return 1
}
`,
    bare: `function jsFn() {
  return 1
}
`,
  },
  {
    kind: "generator_function_declaration",
    name: "jsGen",
    file: "src/jsGen.js",
    inline: `// @tether
// @symbol jsGen
function* jsGen() {
  yield 1
}
`,
    bare: `function* jsGen() {
  yield 1
}
`,
  },
  {
    kind: "class_declaration",
    name: "jsClass",
    file: "src/jsClass.js",
    inline: `// @tether
// @symbol jsClass
class jsClass {}
`,
    bare: `class jsClass {}
`,
  },
  {
    kind: "lexical_declaration",
    name: "jsLex",
    file: "src/jsLex.js",
    inline: `// @tether
// @symbol jsLex
export const jsLex = 1
`,
    bare: `export const jsLex = 1
`,
  },
  {
    kind: "variable_declaration",
    name: "jsVar",
    file: "src/jsVar.js",
    inline: `// @tether
// @symbol jsVar
var jsVar = 1
`,
    bare: `var jsVar = 1
`,
  },
  {
    kind: "method_definition",
    name: "jsMethod",
    file: "src/jsMethod.js",
    inline: `class jsMethodHost {
  // @tether
  // @symbol jsMethod
  jsMethod() {
    return 1
  }
}
`,
    bare: `class jsMethodHost {
  jsMethod() {
    return 1
  }
}
`,
  },
  {
    kind: "field_definition",
    name: "jsField",
    file: "src/jsField.js",
    inline: `class jsFieldHost {
  // @tether
  // @symbol jsField
  jsField = 1
}
`,
    bare: `class jsFieldHost {
  jsField = 1
}
`,
  },
]
