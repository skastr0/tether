import type { LanguageProfile } from "./index"

export const swift = {
  id: "swift",
  extensions: ["swift"],
  grammar: "tree-sitter-swift/tree-sitter-swift.wasm",
  comment_kinds: ["comment", "multiline_comment"],
  skip_kinds: ["attribute", "modifiers"],
  declaration_kinds: [
    "associatedtype_declaration",
    "class_declaration",
    "deinit_declaration",
    "enum_entry",
    "function_declaration",
    "init_declaration",
    "macro_declaration",
    "operator_declaration",
    "property_declaration",
    "protocol_declaration",
    "protocol_function_declaration",
    "protocol_property_declaration",
    "subscript_declaration",
    "typealias_declaration",
  ],
  // No export/impl wrapper. Attributes sit on the declaration via modifiers.
  unwrap_kinds: [],
  name_fields: ["name"],
} as const satisfies LanguageProfile
