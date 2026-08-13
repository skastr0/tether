export interface TsKindCase {
  readonly kind: string
  readonly name: string
  readonly file: string
  readonly inline: string
  readonly bare: string
}

export const TS_SKIPPED: readonly { readonly kind: string; readonly reason: string }[] = [
  {
    kind: "import_alias",
    reason: "import_alias has no name field; extract cannot name it",
  },
]

export const TS_KINDS: readonly TsKindCase[] = [
  {
    kind: "function_declaration",
    name: "tsFn",
    file: "src/tsFn.ts",
    inline: `// @tether
// @symbol tsFn
function tsFn() {
  return 1
}
`,
    bare: `function tsFn() {
  return 1
}
`,
  },
  {
    kind: "generator_function_declaration",
    name: "tsGen",
    file: "src/tsGen.ts",
    inline: `// @tether
// @symbol tsGen
function* tsGen() {
  yield 1
}
`,
    bare: `function* tsGen() {
  yield 1
}
`,
  },
  {
    kind: "class_declaration",
    name: "tsClass",
    file: "src/tsClass.ts",
    inline: `// @tether
// @symbol tsClass
class tsClass {}
`,
    bare: `class tsClass {}
`,
  },
  {
    kind: "lexical_declaration",
    name: "tsLex",
    file: "src/tsLex.ts",
    inline: `// @tether
// @symbol tsLex
export const tsLex = 1
`,
    bare: `export const tsLex = 1
`,
  },
  {
    kind: "variable_declaration",
    name: "tsVar",
    file: "src/tsVar.ts",
    inline: `// @tether
// @symbol tsVar
var tsVar = 1
`,
    bare: `var tsVar = 1
`,
  },
  {
    kind: "method_definition",
    name: "tsMethod",
    file: "src/tsMethod.ts",
    inline: `class tsMethodHost {
  // @tether
  // @symbol tsMethod
  tsMethod() {
    return 1
  }
}
`,
    bare: `class tsMethodHost {
  tsMethod() {
    return 1
  }
}
`,
  },
  {
    kind: "public_field_definition",
    name: "tsField",
    file: "src/tsField.ts",
    inline: `class tsFieldHost {
  // @tether
  // @symbol tsField
  tsField = 1
}
`,
    bare: `class tsFieldHost {
  tsField = 1
}
`,
  },
  {
    kind: "abstract_class_declaration",
    name: "tsAbsClass",
    file: "src/tsAbsClass.ts",
    inline: `// @tether
// @symbol tsAbsClass
abstract class tsAbsClass {}
`,
    bare: `abstract class tsAbsClass {}
`,
  },
  {
    kind: "abstract_method_signature",
    name: "tsAbsMeth",
    file: "src/tsAbsMeth.ts",
    inline: `abstract class tsAbsMethHost {
  // @tether
  // @symbol tsAbsMeth
  abstract tsAbsMeth(): void
}
`,
    bare: `abstract class tsAbsMethHost {
  abstract tsAbsMeth(): void
}
`,
  },
  {
    kind: "enum_declaration",
    name: "tsEnum",
    file: "src/tsEnum.ts",
    inline: `// @tether
// @symbol tsEnum
enum tsEnum {
  A,
}
`,
    bare: `enum tsEnum {
  A,
}
`,
  },
  {
    kind: "enum_assignment",
    name: "tsEnumMem",
    file: "src/tsEnumMem.ts",
    inline: `enum tsEnumMemHost {
  // @tether
  // @symbol tsEnumMem
  tsEnumMem = 1,
}
`,
    bare: `enum tsEnumMemHost {
  tsEnumMem = 1,
}
`,
  },
  {
    kind: "function_signature",
    name: "tsFnSig",
    file: "src/tsFnSig.d.ts",
    inline: `// @tether
// @symbol tsFnSig
export function tsFnSig(): void;
`,
    bare: `export function tsFnSig(): void;
`,
  },
  {
    kind: "interface_declaration",
    name: "tsIface",
    file: "src/tsIface.ts",
    inline: `// @tether
// @symbol tsIface
interface tsIface {}
`,
    bare: `interface tsIface {}
`,
  },
  {
    kind: "internal_module",
    name: "tsNs",
    file: "src/tsNs.ts",
    inline: `// @tether
// @symbol tsNs
namespace tsNs {}
`,
    bare: `namespace tsNs {}
`,
  },
  {
    kind: "method_signature",
    name: "tsMethSig",
    file: "src/tsMethSig.ts",
    inline: `interface tsMethSigHost {
  // @tether
  // @symbol tsMethSig
  tsMethSig(): void
}
`,
    bare: `interface tsMethSigHost {
  tsMethSig(): void
}
`,
  },
  {
    kind: "module",
    name: "tsMod",
    file: "src/tsMod.ts",
    inline: `// @tether
// @symbol tsMod
module tsMod {}
`,
    bare: `module tsMod {}
`,
  },
  {
    kind: "property_signature",
    name: "tsProp",
    file: "src/tsProp.ts",
    inline: `interface tsPropHost {
  // @tether
  // @symbol tsProp
  tsProp: string
}
`,
    bare: `interface tsPropHost {
  tsProp: string
}
`,
  },
  {
    kind: "type_alias_declaration",
    name: "tsType",
    file: "src/tsType.ts",
    inline: `// @tether
// @symbol tsType
type tsType = string
`,
    bare: `type tsType = string
`,
  },
]
