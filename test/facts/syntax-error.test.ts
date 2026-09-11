import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { extractRepo } from "../../src/extract/walk"
import { analyzeRepo, lintRepo } from "../../src/facts/lint"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const brokenSource = "const rows = sql<{ a: string }>`SELECT 1`;\n"

const fixture = {
  "src/broken.ts": brokenSource,
  "src/broken.ts.tether": `@symbol rows
doc {
  Query rows.
}
`,
  "src/later.ts": `// @tether
// @symbol greet
export function greet() {
  return 1
}
`,
  "src.tether": `doc {
  Folder doctrine.
}
`,
}

interface ExtractEnvelope {
  readonly ok: boolean
  readonly data?: {
    readonly tethers: ReadonlyArray<{ readonly path: string; readonly host: { readonly kind: string } }>
    readonly facts: ReadonlyArray<{ readonly kind: string; readonly path: string }>
    readonly coverage: {
      readonly extraction: {
        readonly status: string
        readonly unchecked: ReadonlyArray<{
          readonly path: string
          readonly reason: string
          readonly position?: { readonly line: number; readonly column: number; readonly kind: string }
        }>
      }
    }
  }
}

interface LintEnvelope {
  readonly ok: boolean
  readonly data?: {
    readonly facts: ReadonlyArray<{ readonly kind: string; readonly path: string }>
    readonly failed: boolean
    readonly coverage: ExtractEnvelope["data"] extends infer Data
      ? Data extends { readonly coverage: infer Coverage }
        ? Coverage
        : never
      : never
    readonly comparisons: ReadonlyArray<{
      readonly path: string
      readonly status: string
      readonly reason?: string
      readonly check: string
    }>
  }
}

interface GetEnvelope {
  readonly ok: boolean
  readonly error?: { readonly type: string }
  readonly data?: {
    readonly coverage?: {
      readonly extraction: {
        readonly unchecked: ReadonlyArray<{ readonly path: string; readonly reason: string }>
      }
    }
    readonly facts?: ReadonlyArray<{ readonly kind: string; readonly path: string }>
    readonly comparisons?: ReadonlyArray<{ readonly status: string; readonly reason?: string }>
  }
}

const syntaxErrorEntry = (path: string) =>
  expect.objectContaining({
    path,
    reason: "syntax_error",
    position: expect.objectContaining({
      line: expect.any(Number),
      column: expect.any(Number),
      kind: expect.stringMatching(/^(ERROR|MISSING)$/),
    }),
  })

describe("syntax error coverage", () => {
  it("extracts a repo that contains a tagged-template parse error", async () => {
    await withTempDir("tether-syntax-extract-", async (root) => {
      await initGitRepo(root, fixture)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.coverage.extraction.status).toBe("partial")
      expect(extracted.coverage.extraction.unchecked).toEqual([syntaxErrorEntry("src/broken.ts")])
      expect(extracted.tethers.map((tether) => tether.path).sort()).toEqual([
        "src.tether",
        "src/broken.ts.tether",
        "src/later.ts",
      ])
      expect(extracted.tethers.some((tether) => tether.path === "src/broken.ts")).toBe(false)
      expect(extracted.facts).toEqual([])

      const cli = await runCli(["extract", JSON.stringify({ root })], {})
      expect(cli.exitCode).toBe(0)
      const payload = expectJson<ExtractEnvelope>(cli.stdout)
      expect(payload.data?.coverage.extraction.unchecked).toEqual([syntaxErrorEntry("src/broken.ts")])
    })
  })

  it("lints fail_on only and keeps a syntax-error host unchecked", async () => {
    await withTempDir("tether-syntax-lint-", async (root) => {
      await initGitRepo(root, fixture)
      const report = await Effect.runPromise(lintRepo(root))
      expect(report.failed).toBe(false)
      expect(report.facts).toEqual([])
      expect(report.facts).not.toContainEqual({ kind: "symbol_missing", path: "src/broken.ts.tether" })
      expect(report.facts).not.toContainEqual({ kind: "host_missing", path: "src/broken.ts.tether" })
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({
          path: "src/broken.ts.tether",
          check: "symbol_resolution",
          status: "unchecked",
          reason: "syntax_error",
        }),
      )
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({
          path: "src.tether",
          check: "host_fingerprint",
          status: "compared",
        }),
      )

      const cli = await runCli(["lint", JSON.stringify({ root })], {})
      expect(cli.exitCode).toBe(0)
      const payload = expectJson<LintEnvelope>(cli.stdout)
      expect(payload.data?.failed).toBe(false)
      expect(payload.data?.facts).toEqual([])
      expect(payload.data?.coverage.extraction.unchecked).toEqual([syntaxErrorEntry("src/broken.ts")])
    })
  })

  it("returns unchecked coverage for get context on a symbol in a syntax-error file", async () => {
    await withTempDir("tether-syntax-get-", async (root) => {
      await initGitRepo(root, fixture)
      const result = await runCli(
        ["get", JSON.stringify({ root, path: "src/broken.ts", symbol: "rows", context: true })],
        {},
      )
      expect(result.exitCode).toBe(0)
      const payload = expectJson<GetEnvelope>(result.stdout)
      expect(payload.ok).toBe(true)
      expect(payload.error).toBeUndefined()
      expect(payload.data?.coverage?.extraction.unchecked).toEqual([syntaxErrorEntry("src/broken.ts")])
      expect(payload.data?.facts).not.toContainEqual({ kind: "symbol_missing", path: "src/broken.ts.tether" })
    })
  })

  it("keeps folder fingerprints after a syntax-error descendant", async () => {
    await withTempDir("tether-syntax-folder-", async (root) => {
      await initGitRepo(root, fixture)
      const analysis = await Effect.runPromise(analyzeRepo(root))
      const folder = analysis.tethers.find((tether) => tether.path === "src.tether")
      expect(folder?.host).toEqual({ kind: "folder", path: "src" })
      const broken = analysis.targets.find((target) => target.path === "src/broken.ts")
      expect(broken && "reason" in broken ? broken.reason : undefined).toBe("syntax_error")
      expect(analysis.comparisons).toContainEqual(
        expect.objectContaining({ path: "src.tether", status: "compared" }),
      )
    })
  })
})
