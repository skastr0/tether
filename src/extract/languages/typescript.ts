import type { LanguageProfile } from "./index"

// JS/TS share comment and declaration shapes; tsx is the same table on the tsx wasm.
const table = {
  comment_kinds: ["comment", "html_comment"],
  skip_kinds: ["decorator"],
  declaration_kinds: [
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
    "method_definition",
    "public_field_definition",
    "abstract_class_declaration",
    "abstract_method_signature",
    "enum_assignment",
    "enum_declaration",
    "function_signature",
    "import_alias",
    "interface_declaration",
    "internal_module",
    "method_signature",
    "module",
    "property_signature",
    "type_alias_declaration",
  ],
  unwrap_kinds: ["export_statement", "ambient_declaration"],
  name_fields: ["name"],
} as const

export const typescript = {
  id: "typescript",
  extensions: ["ts"],
  grammar: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  ...table,
} as const satisfies LanguageProfile

export const tsx = {
  id: "tsx",
  extensions: ["tsx"],
  grammar: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  ...table,
} as const satisfies LanguageProfile
