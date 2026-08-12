import type { LanguageProfile } from "./index"

export const golang = {
  id: "golang",
  extensions: ["go"],
  grammar: "tree-sitter-go/tree-sitter-go.wasm",
  comment_kinds: ["comment"],
  // Go has no decorator/attribute nodes.
  skip_kinds: [],
  declaration_kinds: [
    "function_declaration",
    "method_declaration",
    "type_spec",
    "type_alias",
    "const_spec",
    "var_spec",
    "field_declaration",
    "method_elem",
  ],
  // type/const/var wrap the named spec; var groups wrap once more.
  unwrap_kinds: [
    "type_declaration",
    "const_declaration",
    "var_declaration",
    "var_spec_list",
  ],
  name_fields: ["name"],
} as const satisfies LanguageProfile
