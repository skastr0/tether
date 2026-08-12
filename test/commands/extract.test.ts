import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli } from "../helpers/cli"

const execFileAsync = promisify(execFile)

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

const initGitRepo = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "tether-extract-cli-"))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  await execFileAsync("git", ["init"], { cwd: dir })
  await execFileAsync("git", ["config", "user.email", "tether@example.com"], { cwd: dir })
  await execFileAsync("git", ["config", "user.name", "tether"], { cwd: dir })
  await execFileAsync("git", ["add", "-A"], { cwd: dir })
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: dir })
  return dir
}

describe("extract command", () => {
  it.effect("returns a JSON envelope from inline input", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        initGitRepo({
          "root.tether": `@symbol Host
@public
doc {
  Repo doctrine.
}
`,
          "src/has space.ts": `// @tether
// @symbol spaced
export const spaced = 1
`,
          "README.md": "# not a tether\n",
        }),
      )
      yield* Effect.promise(() => writeFile(join(dir, "untracked.ts"), "// @tether\nexport const ghost = 1\n"))

      const result = yield* runCli(["extract", JSON.stringify({ root: dir })], {})
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))

      const payload = expectJson<ExtractEnvelope>(result.stdout)
      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("extract")
      expect(payload.data?.root).toBeTruthy()
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(payload.data?.files).toEqual(["README.md", "root.tether", "src/has space.ts"])
      expect(payload.data?.tethers).toEqual([
        expect.objectContaining({
          path: "root.tether",
          host: { kind: "repository", path: "." },
          symbols: ["Host"],
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
    }),
  )

  it.effect("accepts @file and stdin JSON", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        initGitRepo({
          "root.tether": `@symbol Host
doc {
  Repo doctrine.
}
`,
        }),
      )
      const payloadPath = join(dir, "input.json")
      yield* Effect.promise(() => writeFile(payloadPath, JSON.stringify({ root: dir })))

      const fromFile = yield* runCli(["extract", `@${payloadPath}`], {})
      const fromStdin = yield* runCli(["extract", "-"], {}, { stdinText: JSON.stringify({ root: dir }) })
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))

      const filePayload = expectJson<ExtractEnvelope>(fromFile.stdout)
      const stdinPayload = expectJson<ExtractEnvelope>(fromStdin.stdout)
      expect(fromFile.exitCode).toBe(0)
      expect(fromStdin.exitCode).toBe(0)
      expect(filePayload.data?.tethers[0]?.symbols).toEqual(["Host"])
      expect(stdinPayload.data?.tethers[0]?.symbols).toEqual(["Host"])
    }),
  )

  it.effect("fails on invalid JSON and a missing git repo", () =>
    Effect.gen(function* () {
      const invalid = yield* runCli(["extract", "not-json"], {})
      const invalidPayload = expectJson<ExtractEnvelope>(invalid.stderr)
      expect(invalid.exitCode).toBe(1)
      expect(invalidPayload.ok).toBe(false)
      expect(invalidPayload.command).toBe("extract")
      expect(invalidPayload.error?.type).toBe("JsonInputError")

      const emptyRoot = yield* runCli(["extract", '{"root":"   "}'], {})
      const emptyPayload = expectJson<ExtractEnvelope>(emptyRoot.stderr)
      expect(emptyRoot.exitCode).toBe(1)
      expect(emptyPayload.error?.type).toBe("CommandInputError")
      expect(emptyPayload.error?.details?.field).toBe("root")

      const missing = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "tether-extract-nogit-")))
      const notRepo = yield* runCli(["extract", JSON.stringify({ root: missing })], {})
      yield* Effect.promise(() => rm(missing, { recursive: true, force: true }))
      const notRepoPayload = expectJson<ExtractEnvelope>(notRepo.stderr)
      expect(notRepo.exitCode).toBe(1)
      expect(notRepoPayload.error?.type).toBe("NotAGitRepositoryError")
    }),
  )
})
