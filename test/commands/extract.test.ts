import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface ExtractEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly files: readonly string[]
    readonly tethers: ReadonlyArray<{
      readonly path: string
      readonly host: { readonly kind: string; readonly path: string; readonly name?: string }
      readonly symbols: readonly string[]
      readonly refs: ReadonlyArray<{ readonly raw: string; readonly path: string; readonly name?: string }>
      readonly public: boolean
    }>
    readonly facts: ReadonlyArray<{ readonly kind: string; readonly path: string }>
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly source?: string; readonly reason?: string }
  }
}

describe("extract command", () => {
  it("returns a JSON envelope from inline input", async () => {
    await withTempDir("tether-extract-cli-", async (dir) => {
      await initGitRepo(dir, {
        "root.tether": `@ref src/host.ts#value
@public
doc {
  Repo doctrine.
}
`,
        "src/host.ts": "export const value = 1\n",
        "src/has space.ts": `// @tether
// @symbol spaced
export const spaced = 1
`,
        "README.md": "# not a tether\n",
      })
      await writeFile(join(dir, "untracked.ts"), "// @tether\nexport const ghost = 1\n")

      const result = await runCli(["extract", JSON.stringify({ root: dir })], {})
      const payload = expectJson<ExtractEnvelope>(result.stdout)
      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("extract")
      expect(payload.data?.root).toBeTruthy()
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(payload.data?.files).toEqual(["README.md", "root.tether", "src/has space.ts", "src/host.ts"])
      expect(payload.data?.tethers).toEqual([
        expect.objectContaining({
          path: "root.tether",
          host: { kind: "repository", path: "." },
          symbols: [],
          refs: [{ raw: "src/host.ts#value", path: "src/host.ts", name: "value" }],
          public: true,
        }),
        expect.objectContaining({
          path: "src/has space.ts",
          host: { kind: "symbol", path: "src/has space.ts", name: "spaced" },
          symbols: ["spaced"],
        }),
      ])
      expect(payload.data?.tethers.some((tether) => tether.path === "untracked.ts")).toBe(false)
      expect(payload.data?.facts).toEqual([])
    })
  })

  it("accepts @file and stdin JSON", async () => {
    await withTempDir("tether-extract-cli-", async (dir) => {
      await initGitRepo(dir, {
        "root.tether": `@ref src/host.ts#value
doc {
  Repo doctrine.
}
`,
        "src/host.ts": "export const value = 1\n",
      })
      const payloadPath = join(dir, "input.json")
      await writeFile(payloadPath, JSON.stringify({ root: dir }))

      const fromFile = await runCli(["extract", `@${payloadPath}`], {})
      const fromStdin = await runCli(["extract", "-"], {}, { stdinText: JSON.stringify({ root: dir }) })

      const filePayload = expectJson<ExtractEnvelope>(fromFile.stdout)
      const stdinPayload = expectJson<ExtractEnvelope>(fromStdin.stdout)
      expect(fromFile.exitCode).toBe(0)
      expect(fromStdin.exitCode).toBe(0)
      expect(filePayload.data?.tethers[0]?.symbols).toEqual([])
      expect(filePayload.data?.tethers[0]?.refs).toEqual([
        { raw: "src/host.ts#value", path: "src/host.ts", name: "value" },
      ])
      expect(stdinPayload.data?.tethers[0]?.refs).toEqual([
        { raw: "src/host.ts#value", path: "src/host.ts", name: "value" },
      ])
    })
  })

  it("fails on invalid JSON and a missing git repo", async () => {
    const invalid = await runCli(["extract", "not-json"], {})
    const invalidPayload = expectJson<ExtractEnvelope>(invalid.stderr)
    expect(invalid.exitCode).toBe(1)
    expect(invalidPayload.ok).toBe(false)
    expect(invalidPayload.command).toBe("extract")
    expect(invalidPayload.error?.type).toBe("JsonInputError")

    const emptyRoot = await runCli(["extract", '{"root":"   "}'], {})
    const emptyPayload = expectJson<ExtractEnvelope>(emptyRoot.stderr)
    expect(emptyRoot.exitCode).toBe(1)
    expect(emptyPayload.error?.type).toBe("CommandInputError")
    expect(emptyPayload.error?.details?.field).toBe("root")

    await withTempDir("tether-extract-nogit-", async (missing) => {
      const notRepo = await runCli(["extract", JSON.stringify({ root: missing })], {})
      const notRepoPayload = expectJson<ExtractEnvelope>(notRepo.stderr)
      expect(notRepo.exitCode).toBe(1)
      expect(notRepoPayload.error?.type).toBe("NotAGitRepositoryError")
    })
  })
})
