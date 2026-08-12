import { Schema } from "effect"

export const FACT_KINDS = [
  "rogue_document",
  "ill_formed",
  "duplicate_id",
  "host_missing",
  "host_fingerprint_changed",
  "ref_missing",
  "ref_fingerprint_changed",
  "public_surface_stale",
] as const

export const FactKindSchema = Schema.Literal(...FACT_KINDS)

export type FactKind = typeof FactKindSchema.Type

export type Host =
  | {
      readonly kind: "symbol"
      readonly path: string
      readonly name: string
    }
  | {
      readonly kind: "file"
      readonly path: string
    }
  | {
      readonly kind: "folder"
      readonly path: string
    }
  | {
      readonly kind: "repository"
      readonly path: "."
    }
  | {
      readonly kind: "honorary_folder"
      readonly path: string
      readonly file: "AGENTS.md" | "CLAUDE.md"
    }

export interface Ref {
  readonly raw: string
  readonly path: string
  readonly name?: string
}

export interface ExampleBlock {
  readonly lang: string
  readonly body: string
}

export interface Tether {
  readonly path: string
  readonly host: Host
  readonly symbols: readonly string[]
  readonly refs: readonly Ref[]
  readonly public: boolean
  readonly doc: string
  readonly examples: readonly ExampleBlock[]
}

export interface FactCandidate {
  readonly path: string
  readonly name: string
}

export interface Fact {
  readonly kind: FactKind
  readonly path: string
  readonly candidates?: readonly FactCandidate[]
}
