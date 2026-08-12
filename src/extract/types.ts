import { Schema } from "effect"

/** @tether
 * @symbol FACT_KINDS
 * Closed fact taxonomy. Lint emits only these kinds.
 */
export const FACT_KINDS = [
  "rogue_document",
  "ill_formed",
  "duplicate_id",
  "host_missing",
  "host_fingerprint_changed",
  "ref_missing",
  "ref_fingerprint_changed",
  "symbol_missing",
  "symbol_ambiguous",
  "public_surface_stale",
] as const

export const FactKindSchema = Schema.Literal(...FACT_KINDS)

/** @tether
 * @symbol FactKind
 * One of FACT_KINDS. Not a severity.
 */
export type FactKind = typeof FactKindSchema.Type

/** @tether
 * @symbol Host
 * Bind target derived from location. Never a lookup table.
 */
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

/** @tether
 * @symbol Ref
 * Optional extra target. Never the host.
 */
export interface Ref {
  readonly raw: string
  readonly path: string
  readonly name?: string
}

/** @tether
 * @symbol ExampleBlock
 * Opaque snippet. Not a host, ref, or declaration.
 */
export interface ExampleBlock {
  readonly lang: string
  readonly body: string
}

/** @tether
 * One collocated doctrine unit. Host is location; symbols/refs are extras.
 */
export interface Tether {
  readonly path: string
  readonly host: Host
  readonly symbols: readonly string[]
  readonly refs: readonly Ref[]
  readonly public: boolean
  readonly doc: string
  readonly examples: readonly ExampleBlock[]
}

/** @tether
 * @symbol FactCandidate
 * Unique same-shape rename hint. N≤4 or omit.
 */
export interface FactCandidate {
  readonly path: string
  readonly name: string
}

/** @tether
 * @symbol Fact
 * Proven drift. Recomputed; never stored as a ledger.
 */
export interface Fact {
  readonly kind: FactKind
  readonly path: string
  readonly candidates?: readonly FactCandidate[]
}
