import type { LanguageProfile } from "./index"

export const rust = {
  id: "rust",
  extensions: ["rs"],
  grammar: "tree-sitter-rust/tree-sitter-rust.wasm",
  comment_kinds: ["line_comment", "block_comment"],
  skip_kinds: ["attribute_item", "inner_attribute_item"],
  declaration_kinds: [
    "associated_type",
    "const_item",
    "enum_item",
    "function_item",
    "function_signature_item",
    "macro_definition",
    "mod_item",
    "static_item",
    "struct_item",
    "trait_item",
    "type_item",
    "union_item",
  ],
  // pub is a child of the item, not a wrapper. impl is a declaration, not unwrap.
  unwrap_kinds: [],
  // `type` names `impl Foo`; every other decl uses `name`.
  name_fields: ["name", "type"],
} as const satisfies LanguageProfile
