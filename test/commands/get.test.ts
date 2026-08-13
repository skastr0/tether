import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
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
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly path?: string; readonly symbol?: string }
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
