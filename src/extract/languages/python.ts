import type { LanguageProfile } from "./index"

export const python = {
  id: "python",
  extensions: ["py"],
  grammar: "tree-sitter-python/tree-sitter-python.wasm",
  comment_kinds: ["comment"],
  skip_kinds: ["decorator"],
  declaration_kinds: [
    "function_definition",
    "class_definition",
    "type_alias_statement",
    "assignment",
  ],
  // decorated_definition wraps def/class; expression_statement wraps assignment
  unwrap_kinds: ["decorated_definition", "expression_statement"],
  // function/class use `name`; assignment and type_alias_statement use `left`
  name_fields: ["name", "left"],
} as const satisfies LanguageProfile

