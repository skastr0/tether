import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface ListedTether {
  readonly path: string
  readonly host: { readonly kind: string; readonly path: string; readonly name?: string }
  readonly symbols: readonly string[]
  readonly refs: ReadonlyArray<{ readonly raw: string; readonly path: string; readonly name?: string }>
  readonly public: boolean
  readonly doc: string
  readonly examples?: unknown
}

interface ListEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly tethers: readonly ListedTether[]
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string }
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
  "src/nested/deep.ts": `// @tether
// @symbol deep
// doc {
//   Nested symbol.
// }
export const deep = 1
`,
  "src.tether": `doc {
  Folder doctrine.
}
`,
}

describe("list command", () => {
  it("lists matching tethers with metadata and doc", async () => {
    await withTempDir("tether-list-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const result = await runCli(["list", JSON.stringify({ root: dir })], {})
      const payload = expectJson<ListEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("list")
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(payload.data?.tethers.length).toBeGreaterThanOrEqual(4)

      const root = payload.data?.tethers.find((tether) => tether.host.kind === "repository")
      expect(root).toEqual(
        expect.objectContaining({
          path: "root.tether",
          host: { kind: "repository", path: "." },
          public: true,
          doc: expect.stringContaining("Repo doctrine."),
        }),
      )
      expect(root?.examples).toBeUndefined()
    })
  })

  it("filters by path_prefix, host_kind, symbol, and public", async () => {
    await withTempDir("tether-list-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const prefix = await runCli(["list", JSON.stringify({ root: dir, path_prefix: "src/nested" })], {})
      const prefixPayload = expectJson<ListEnvelope>(prefix.stdout)
      expect(prefixPayload.data?.tethers).toEqual([
        expect.objectContaining({
          path: "src/nested/deep.ts",
          host: { kind: "symbol", path: "src/nested/deep.ts", name: "deep" },
          symbols: ["deep"],
          doc: expect.stringContaining("Nested symbol."),
        }),
      ])

      const folders = await runCli(["list", JSON.stringify({ root: dir, host_kind: "folder" })], {})
      const folderPayload = expectJson<ListEnvelope>(folders.stdout)
      expect(folderPayload.data?.tethers).toEqual([
        expect.objectContaining({
          path: "src.tether",
          host: { kind: "folder", path: "src" },
        }),
      ])

      const symbol = await runCli(["list", JSON.stringify({ root: dir, symbol: "farewell" })], {})
      const symbolPayload = expectJson<ListEnvelope>(symbol.stdout)
      expect(symbolPayload.data?.tethers).toEqual([
        expect.objectContaining({
          host: { kind: "symbol", path: "src/host.ts", name: "farewell" },
        }),
      ])

      const published = await runCli(["list", JSON.stringify({ root: dir, public: true })], {})
      const publishedPayload = expectJson<ListEnvelope>(published.stdout)
      expect(publishedPayload.data?.tethers.every((tether) => tether.public)).toBe(true)
      expect(publishedPayload.data?.tethers.map((tether) => tether.path).sort()).toEqual([
        "root.tether",
        "src/host.ts",
      ])
    })
  })

  it("fails on empty root, bad host_kind, and a missing git repo", async () => {
    const emptyRoot = await runCli(["list", '{"root":"   "}'], {})
    expect(expectJson<ListEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

    const badKind = await runCli(["list", JSON.stringify({ root: ".", host_kind: "wiki" })], {})
    expect(badKind.exitCode).toBe(1)
    expect(expectJson<ListEnvelope>(badKind.stderr).error?.type).toBe("JsonInputError")

    await withTempDir("tether-list-nogit-", async (missing) => {
      const notRepo = await runCli(["list", JSON.stringify({ root: missing })], {})
      expect(notRepo.exitCode).toBe(1)
      expect(expectJson<ListEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
    })
  })

  it("registers a schema", async () => {
    const schema = await runCli(["schema", "show", "list"], {})
    const payload = expectJson<{ ok: boolean; data?: { schema_id?: string } }>(schema.stdout)
    expect(schema.exitCode).toBe(0)
    expect(payload.data?.schema_id).toBe("list.input/v1")
  })
})
