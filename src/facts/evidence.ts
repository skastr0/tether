import type { Host } from "../extract/types"

export interface ExtractionCoverage {
  readonly status: "complete" | "partial"
  readonly unchecked: ReadonlyArray<{ readonly path: string; readonly reason: string }>
  readonly excluded: readonly string[]
}

/** Structural observations, never approval, truth, or behavioral compliance. */
export interface AnalysisCoverage {
  readonly input: "tracked-working-tree"
  readonly atomic: false
  readonly fact_scope: "source-path"
  readonly extraction: ExtractionCoverage
  readonly history: "not_performed" | "attempted"
  readonly public_surface: "not_performed" | "readme_span"
  readonly public_surface_unchecked?: { readonly path: "README.md"; readonly reason: string }
}

export interface Baseline {
  readonly commit: string
  readonly method: "last_source_commit" | "inline_blame"
}

interface ComparisonSubject {
  readonly path: string
  readonly host: Host
  readonly check: "host_fingerprint" | "ref_fingerprint" | "symbol_resolution"
  readonly target: { readonly path: string; readonly name?: string }
}

export type Comparison = ComparisonSubject &
  (
    | {
        readonly status: "compared"
        readonly baseline: Baseline
        readonly before: string
        readonly after: string
      }
    | { readonly status: "unchecked"; readonly reason: string; readonly baseline?: Baseline }
  )

export interface Evidence {
  readonly coverage: AnalysisCoverage
  readonly comparisons: readonly Comparison[]
}

export const extractionCoverage = (extraction: ExtractionCoverage): AnalysisCoverage => ({
  input: "tracked-working-tree",
  atomic: false,
  fact_scope: "source-path",
  extraction,
  history: "not_performed",
  public_surface: "not_performed",
})
