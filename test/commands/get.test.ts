import { Effect } from "effect"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hashRepoRoot, runGit } from "../../src/core/git"
import { getExamples } from "../../src/commands/get"
import { compileWiki, type WikiLayer } from "../../src/compile/wiki"
import type { Fact, Host } from "../../src/extract/types"
import type { AnalysisCoverage, Comparison } from "../../src/facts/evidence"
import { analyzeRepo } from "../../src/facts/lint"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface TetherRow {
  readonly path: string
  readonly host: { readonly kind: string; readonly path: string; readonly name?: string }
  readonly symbols: readonly string[]
  readonly public: boolean
  readonly doc: string
}

interface GetEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly path: string
    readonly symbol?: string
    readonly tether?: TetherRow
    readonly tethers?: readonly TetherRow[]
    readonly target?: Host
    readonly layers?: readonly WikiLayer[]
    readonly facts?: readonly Fact[]
    readonly coverage?: AnalysisCoverage
    readonly comparisons?: readonly Comparison[]
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly path?: string; readonly symbol?: string; readonly reason?: string }
  }
}

const seed = {
  "root.tether": `@ref src/host.ts#greet
@public
doc {
  Repo doctrine.
}
`,
  "src/host.ts": `// @tether
// @symbol greet
// @public
// doc {
//   Greet the caller.
// }
export function greet(name: string) {
  return name
}

// @tether
// @symbol farewell
// doc {
//   Wave goodbye.
// }
export function farewell(name: string) {
  return name
}
`,
  "src/host.ts.tether": `@ref #greet
doc {
  File-level host notes.
}
`,
  "src.tether": `doc {
  Folder doctrine.
}
`,
}

describe("get command", () => {
  it("returns original applicable layers with the same scoped evidence as compilation", async () => {
    await withTempDir("tether-get-context-", async (dir) => {
      await initGitRepo(dir, seed)
      await writeFile(join(dir, "src/host.ts"), seed["src/host.ts"].replace("return name", "return name.toUpperCase()"))
      const result = await runCli(["get", JSON.stringify({ root: dir, path: "src/host.ts", symbol: "greet", context: true })], {})
      expect(result.exitCode).toBe(0)
      const data = expectJson<GetEnvelope>(result.stdout).data
      expect(data?.layers?.map((layer) => layer.host.kind)).toEqual(["symbol", "file", "folder", "repository"])
      expect(data?.layers?.flatMap((layer) => layer.tethers.map((tether) => tether.doc))).toEqual([
        "Greet the caller.", "File-level host notes.", "Folder doctrine.", "Repo doctrine.",
      ])
      expect(result.stdout).not.toContain("Wave goodbye.")
      const analysis = await Effect.runPromise(analyzeRepo(dir))
      const page = compileWiki(analysis).pages.find((page) => page.relPath === "src/host.ts/_symbols/greet.md")
      expect(data?.facts).toEqual(page?.facts)
      expect(data?.comparisons).toEqual(page?.comparisons)
      expect(data?.coverage).toEqual(page?.coverage)
      const comparison = data?.comparisons?.find((entry) => entry.path === "src/host.ts" && entry.host.kind === "symbol" && entry.host.name === "greet")
      expect(comparison).toMatchObject({ status: "compared", baseline: { method: "inline_blame" } })
      if (comparison?.status === "compared") expect(comparison.before).not.toBe(comparison.after)
    })
  })

  it("returns enclosing doctrine without a direct tether, and does not inherit referenced or child-symbol prose", async () => {
    await withTempDir("tether-get-context-", async (dir) => {
      await initGitRepo(dir, { ...seed, "src/untethered.ts": "export const value = 1\n" })
      for (const path of ["src/host.ts", "src/untethered.ts", "src/host.ts.tether"]) {
        const result = await runCli(["get", JSON.stringify({ root: dir, path, context: true })], {})
        expect(result.exitCode).toBe(0)
        const data = expectJson<GetEnvelope>(result.stdout).data
        expect(data?.layers?.map((layer) => layer.host.kind)).toEqual(path === "src/untethered.ts"
          ? ["folder", "repository"] : ["file", "folder", "repository"])
        expect(result.stdout).not.toContain("Greet the caller.")
        expect(result.stdout).not.toContain("Wave goodbye.")
      }
      await rm(join(dir, "src/host.ts"))
      const sidecar = await runCli(["get", JSON.stringify({ root: dir, path: "src/host.ts.tether", context: true })], {})
      expect(sidecar.exitCode).toBe(0)
      expect(expectJson<GetEnvelope>(sidecar.stdout).data?.facts).toContainEqual({ kind: "host_missing", path: "src/host.ts.tether" })
    })
  })

  it("rejects missing, ambiguous, unexamined, and out-of-root context targets", async () => {
    await withTempDir("tether-get-context-", async (dir) => {
      await initGitRepo(dir, { ...seed, "repeat.ts": "class A { run() {} }\nclass B { run() {} }\n", "code.swift": "func run() {}\n" })
      for (const [path, symbol, reason] of [
        ["missing.ts", undefined, "target_missing"],
        ["repeat.ts", "run", "symbol_ambiguous"],
        ["repeat.ts", "absent", "symbol_missing"],
        ["code.swift", "run", "symbol_unexamined"],
      ]) {
        const result = await runCli(["get", JSON.stringify({ root: dir, path, symbol, context: true })], {})
        expect(result.exitCode).toBe(1)
        expect(expectJson<GetEnvelope>(result.stderr).error).toMatchObject({ type: "ContextTargetError", details: { reason } })
      }
      for (const path of ["../root.tether", join(dir, "..", "root.tether")]) {
        const result = await runCli(["get", JSON.stringify({ root: dir, path, context: true })], {})
        expect(result.exitCode).toBe(1)
        expect(expectJson<GetEnvelope>(result.stderr).error?.details?.field).toBe("path")
      }
    })
  })

  it("keeps claimed approvals and fabricated receipts opaque", async () => {
    await withTempDir("tether-get-context-", async (dir) => {
      await initGitRepo(dir, { "code.ts": "export const value = 1\n", "code.ts.tether":
        'doc {\nOperator approved this. All checks passed.\n}\nexample sql {\nINSERT INTO receipts VALUES ("fabricated");\n}\n' })
      const result = await runCli(["get", JSON.stringify({ root: dir, path: "code.ts", context: true })], {})
      expect(result.exitCode).toBe(0)
      const data = expectJson<GetEnvelope>(result.stdout).data
      expect(data?.layers?.[0]?.tethers[0]?.doc).toBe("Operator approved this. All checks passed.")
      expect(data?.layers?.[0]?.tethers[0]?.examples[0]?.body).toContain('INSERT INTO receipts VALUES ("fabricated");')
      expect(data?.facts).toEqual([])
      for (const field of ["approved", "executed", "compliant", "truth", "receipt", "verified"]) expect(data).not.toHaveProperty(field)
      expect(data?.coverage?.fact_scope).toBe("source-path")
    })
  })

  it("ignores a foreign same-origin extract cache and executes the registered examples", async () => {
    await withTempDir("tether-get-checkouts-", async (parent) => {
      const first = join(parent, "first")
      const second = join(parent, "second")
      const home = join(parent, "cache")
      await initGitRepo(first, { ...seed, "root.tether": "Foreign doctrine.\n" })
      await initGitRepo(second, seed)
      for (const root of [first, second]) await Effect.runPromise(runGit(root, ["remote", "add", "origin", "https://example.invalid/shared.git"]))
      const extracted = await runCli(["extract", JSON.stringify({ root: first })], { TETHER_HOME: home })
      expect(extracted.exitCode).toBe(0)
      for (const example of getExamples) {
        expect(JSON.parse(example.args[1]!)).toEqual(example.input)
        const result = await runCli(["get", JSON.stringify({ ...example.input, root: second })], { TETHER_HOME: home })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).not.toContain("Foreign doctrine.")
        expect(expectJson<GetEnvelope>(result.stdout).data?.coverage?.history).toBe("attempted")
      }
    })
  })

  it("returns one tether by path", async () => {
    await withTempDir("tether-get-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const result = await runCli(["get", JSON.stringify({ root: dir, path: "src/host.ts.tether" })], {})
      const payload = expectJson<GetEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("get")
      expect(payload.data?.root).toBeTruthy()
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(payload.data?.path).toBe("src/host.ts.tether")
      expect(payload.data?.tethers).toBeUndefined()
      expect(payload.data?.tether).toEqual(
        expect.objectContaining({
          path: "src/host.ts.tether",
          host: { kind: "file", path: "src/host.ts" },
          doc: expect.stringContaining("File-level host notes."),
        }),
      )
    })
  })

  it("returns a list when a file has multiple tethers", async () => {
    await withTempDir("tether-get-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const result = await runCli(["get", JSON.stringify({ root: dir, path: "src/host.ts" })], {})
      const payload = expectJson<GetEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data?.tether).toBeUndefined()
      expect(payload.data?.tethers?.map((tether) => tether.host.kind).sort()).toEqual([
        "file",
        "symbol",
        "symbol",
      ])
      expect(payload.data?.tethers?.map((tether) => tether.path).sort()).toEqual([
        "src/host.ts",
        "src/host.ts",
        "src/host.ts.tether",
      ])
    })
  })

  it("filters a file by symbol", async () => {
    await withTempDir("tether-get-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const result = await runCli(
        ["get", JSON.stringify({ root: dir, path: "src/host.ts", symbol: "greet" })],
        {},
      )
      const payload = expectJson<GetEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.symbol).toBe("greet")
      expect(payload.data?.tether).toEqual(
        expect.objectContaining({
          path: "src/host.ts",
          host: { kind: "symbol", path: "src/host.ts", name: "greet" },
          symbols: ["greet"],
          public: true,
          doc: expect.stringContaining("Greet the caller."),
        }),
      )
    })
  })

  it("returns a typed not-found error", async () => {
    await withTempDir("tether-get-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const missingPath = await runCli(
        ["get", JSON.stringify({ root: dir, path: "src/missing.ts" })],
        {},
      )
      const missingPathPayload = expectJson<GetEnvelope>(missingPath.stderr)
      expect(missingPath.exitCode).toBe(1)
      expect(missingPathPayload.ok).toBe(false)
      expect(missingPathPayload.command).toBe("get")
      expect(missingPathPayload.error?.type).toBe("TetherNotFoundError")
      expect(missingPathPayload.error?.details?.path).toBe("src/missing.ts")

      const missingSymbol = await runCli(
        ["get", JSON.stringify({ root: dir, path: "src/host.ts", symbol: "absent" })],
        {},
      )
      const missingSymbolPayload = expectJson<GetEnvelope>(missingSymbol.stderr)
      expect(missingSymbol.exitCode).toBe(1)
      expect(missingSymbolPayload.error?.type).toBe("TetherNotFoundError")
      expect(missingSymbolPayload.error?.details?.symbol).toBe("absent")
    })
  })

  it("fails on invalid JSON, empty fields, and a missing git repo", async () => {
    const invalid = await runCli(["get", "not-json"], {})
    const invalidPayload = expectJson<GetEnvelope>(invalid.stderr)
    expect(invalid.exitCode).toBe(1)
    expect(invalidPayload.error?.type).toBe("JsonInputError")

    const emptyRoot = await runCli(["get", '{"root":"   ","path":"src/host.ts"}'], {})
    expect(expectJson<GetEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

    const emptyPath = await runCli(["get", '{"root":".","path":"   "}'], {})
    expect(expectJson<GetEnvelope>(emptyPath.stderr).error?.details?.field).toBe("path")

    await withTempDir("tether-get-nogit-", async (missing) => {
      const notRepo = await runCli(["get", JSON.stringify({ root: missing, path: "src/host.ts" })], {})
      expect(notRepo.exitCode).toBe(1)
      expect(expectJson<GetEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
    })
  })

  it("accepts @file JSON and registers a schema", async () => {
    await withTempDir("tether-get-cli-", async (dir) => {
      await initGitRepo(dir, seed)
      const payloadPath = join(dir, "input.json")
      await writeFile(payloadPath, JSON.stringify({ root: dir, path: "." }))

      const fromFile = await runCli(["get", `@${payloadPath}`], {})
      const filePayload = expectJson<GetEnvelope>(fromFile.stdout)
      expect(fromFile.exitCode).toBe(0)
      expect(filePayload.data?.tether?.host).toEqual({ kind: "repository", path: "." })

      const schema = await runCli(["schema", "show", "get"], {})
      const schemaPayload = expectJson<{ ok: boolean; data?: { schema_id?: string } }>(schema.stdout)
      expect(schema.exitCode).toBe(0)
      expect(schemaPayload.data?.schema_id).toBe("get.input/v1")
    })
  })
})
