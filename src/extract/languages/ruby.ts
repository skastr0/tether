import type { LanguageProfile } from "./index"

export const ruby = {
  id: "ruby",
  extensions: ["rb"],
  grammar: "tree-sitter-ruby/tree-sitter-ruby.wasm",
  comment_kinds: ["comment"],
  skip_kinds: [],
  declaration_kinds: [
    "method",
    "singleton_method",
    "class",
    "module",
    "singleton_class",
    "alias",
  ],
  unwrap_kinds: [],
  // `value` names `class << obj`; every other decl uses `name`.
  name_fields: ["name", "value"],
} as const satisfies LanguageProfile
