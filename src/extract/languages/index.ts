export type LanguageId =
  | "javascript"
  | "typescript"
  | "tsx"
  | "rust"
  | "golang"
  | "ruby"
  | "swift"
  | "python"

export const LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "tsx",
  "rust",
  "golang",
  "ruby",
  "swift",
  "python",
] as const satisfies readonly LanguageId[]

export interface LanguageProfile {
  readonly id: LanguageId
  readonly extensions: readonly string[]
  readonly grammar: string
  readonly comment_kinds: readonly string[]
  readonly skip_kinds: readonly string[]
  readonly declaration_kinds: readonly string[]
  readonly unwrap_kinds: readonly string[]
  readonly name_fields: readonly string[]
}

export type LanguageRegistry = Partial<Record<LanguageId, LanguageProfile>>

export const languages: LanguageRegistry = {}
