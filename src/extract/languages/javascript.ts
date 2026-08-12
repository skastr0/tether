import type { LanguageProfile } from "./index"

export const javascript = {
  id: "javascript",
  extensions: ["js", "mjs", "cjs"],
  grammar: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  comment_kinds: ["comment", "html_comment"],
  skip_kinds: ["decorator"],
  declaration_kinds: [
    "function_declaration",
    "generator_function_declaration",
    "class_declaration",
    "lexical_declaration",
    "variable_declaration",
    "method_definition",
    "field_definition",
  ],
  unwrap_kinds: ["export_statement"],
  // field_definition uses `property`; lexical/var names live on child variable_declarator.name
  name_fields: ["name", "property"],
} as const satisfies LanguageProfile
