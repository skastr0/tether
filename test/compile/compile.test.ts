import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli } from "../helpers/cli"

interface CompileEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly project_dir: string
    readonly wiki_dir: string
    readonly public_dir: string
    readonly wiki_pages: readonly string[]
    readonly public_pages: readonly string[]
    readonly readme_updated: boolean
    readonly tether_count: number
    readonly public_count: number
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly source?: string; readonly reason?: string }
  }
}

const run = async (cwd: string, args: [string, ...string[]]) => {
  const [command, ...commandArgs] = args
  try {
    await execFileAsync(command, commandArgs, { cwd })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`${args.join(" ")} failed: ${detail}`)
  }
}

const initGitRepo = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "tether-compile-cli-"))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
  await run(dir, ["git", "init"])
  await run(dir, ["git", "config", "user.email", "tether@example.com"])
  await run(dir, ["git", "config", "user.name", "tether"])
  await run(dir, ["git", "add", "-A"])
  await run(dir, ["git", "commit", "-m", "init"])
  return dir
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe("compile command", () => {
  it.effect("writes wiki and public trees under TETHER_HOME, never the repo", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "tether-compile-home-")))
      const dir = yield* Effect.promise(() =>
        initGitRepo({
          "root.tether": `@symbol Host
@public
doc {
  Repo doctrine.
}
`,
          "src.tether": `@symbol Src
@public
doc {
  Folder doctrine.
}
`,
          "src/auth.ts.tether": `doc {
  File doctrine.
}
`,
          "README.md": `# Authored\n\nkeep\n\n<!-- tether:public -->\nold\n<!-- /tether:public -->\n\ntail\n`,
        }),
      )

      const result = yield* runCli(["compile", JSON.stringify({ root: dir })], { TETHER_HOME: home })
      if (result.stdout.trim().length === 0) {
        throw new Error(`compile produced no stdout (exit ${result.exitCode}): ${result.stderr}`)
      }
      const payload = expectJson<CompileEnvelope>(result.stdout)
      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("compile")
      const resolvedDir = yield* Effect.promise(() => realpath(dir))
      const resolvedHome = yield* Effect.promise(() => realpath(home))
      expect(payload.data?.root).toBe(resolvedDir)
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(yield* Effect.promise(() => realpath(payload.data?.project_dir ?? home))).toContain(resolvedHome)
      expect(payload.data?.wiki_dir).toBe(join(payload.data?.project_dir ?? "", "wiki"))
      expect(payload.data?.readme_updated).toBe(true)
      expect(payload.data?.wiki_pages).toEqual(expect.arrayContaining(["index.md", "src/index.md", "src/auth.ts/index.md"]))
      expect(payload.data?.public_pages).toEqual(expect.arrayContaining(["index.md", "src/index.md"]))
      expect(payload.data?.public_pages).not.toContain("src/auth.ts/index.md")

      const wikiIndex = yield* Effect.promise(() => readFile(join(payload.data?.wiki_dir ?? "", "index.md"), "utf8"))
      const filePage = yield* Effect.promise(() =>
        readFile(join(payload.data?.wiki_dir ?? "", "src/auth.ts/index.md"), "utf8"),
      )
      const nav = yield* Effect.promise(() => readFile(join(payload.data?.public_dir ?? "", "nav.md"), "utf8"))
      const readme = yield* Effect.promise(() => readFile(join(dir, "README.md"), "utf8"))

      expect(wikiIndex.startsWith("---\nfacts: []\n---")).toBe(true)
      expect(wikiIndex).toContain("Repo doctrine.")
      expect(filePage).toContain("File doctrine.")
      expect(filePage).toContain("Folder doctrine.")
      expect(filePage).toContain("Repo doctrine.")
      const fileAt = filePage.indexOf("File doctrine.")
      const folderAt = filePage.indexOf("Folder doctrine.")
      const rootAt = filePage.indexOf("Repo doctrine.")
      expect(fileAt).toBeLessThan(folderAt)
      expect(folderAt).toBeLessThan(rootAt)
      expect(nav).toContain("[Host](./index.md)")
      expect(nav).not.toContain("src/auth.ts/index.md")
      expect(readme).toContain("# Authored")
      expect(readme).toContain("keep")
      expect(readme).toContain("tail")
      expect(readme).toContain("## Host")
      expect(readme).not.toContain("\nold\n")
      expect(yield* Effect.promise(() => exists(join(dir, "wiki")))).toBe(false)
      expect(yield* Effect.promise(() => exists(join(dir, ".tether")))).toBe(false)
      expect(yield* Effect.promise(() => exists(join(dir, "public")))).toBe(false)

      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
      yield* Effect.promise(() => rm(home, { recursive: true, force: true }))
    }),
  )

  it.effect("accepts @file and stdin JSON and leaves README without markers untouched", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "tether-compile-home-")))
      const dir = yield* Effect.promise(() =>
        initGitRepo({
          "root.tether": `@symbol Host
@public
doc {
  Repo doctrine.
}
`,
          "README.md": "# Authored only\n",
        }),
      )
      const payloadPath = join(dir, "input.json")
      yield* Effect.promise(() => writeFile(payloadPath, JSON.stringify({ root: dir })))

      const fromFile = yield* runCli(["compile", `@${payloadPath}`], { TETHER_HOME: home })
      const fromStdin = yield* runCli(["compile", "-"], { TETHER_HOME: home }, { stdinText: JSON.stringify({ root: dir }) })
      if (fromFile.exitCode !== 0) {
        throw new Error(`@file compile failed (exit ${fromFile.exitCode}): ${fromFile.stderr || fromFile.stdout}`)
      }
      const readme = yield* Effect.promise(() => readFile(join(dir, "README.md"), "utf8"))
      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
      yield* Effect.promise(() => rm(home, { recursive: true, force: true }))

      expect(fromFile.exitCode).toBe(0)
      expect(fromStdin.exitCode).toBe(0)
      expect(expectJson<CompileEnvelope>(fromFile.stdout).data?.tether_count).toBe(1)
      expect(expectJson<CompileEnvelope>(fromStdin.stdout).data?.readme_updated).toBe(false)
      expect(readme).toBe("# Authored only\n")
    }),
  )

  it.effect("puts extract facts in frontmatter and rejects bad input", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "tether-compile-home-")))
      const dir = yield* Effect.promise(() =>
        initGitRepo({
          "src.tether": `@quartz no\ndoc {\n`,
        }),
      )

      const result = yield* runCli(["compile", JSON.stringify({ root: dir })], { TETHER_HOME: home })
      if (result.stdout.trim().length === 0) {
        throw new Error(`compile produced no stdout (exit ${result.exitCode}): ${result.stderr}`)
      }
      const payload = expectJson<CompileEnvelope>(result.stdout)
      expect(result.exitCode).toBe(0)
      const page = yield* Effect.promise(() =>
        readFile(join(payload.data?.wiki_dir ?? "", "src/index.md"), "utf8"),
      )
      expect(page).toContain("kind: ill_formed")
      expect(page).toContain("path: src.tether")

      const invalid = yield* runCli(["compile", "not-json"], { TETHER_HOME: home })
      expect(invalid.exitCode).toBe(1)
      expect(expectJson<CompileEnvelope>(invalid.stderr).error?.type).toBe("JsonInputError")

      const emptyRoot = yield* runCli(["compile", '{"root":"   "}'], { TETHER_HOME: home })
      expect(emptyRoot.exitCode).toBe(1)
      expect(expectJson<CompileEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

      const notRepoDir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "tether-compile-nogit-")))
      const notRepo = yield* runCli(["compile", JSON.stringify({ root: notRepoDir })], { TETHER_HOME: home })
      expect(notRepo.exitCode).toBe(1)
      expect(expectJson<CompileEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
      yield* Effect.promise(() => rm(notRepoDir, { recursive: true, force: true }))

      yield* Effect.promise(() => rm(dir, { recursive: true, force: true }))
      yield* Effect.promise(() => rm(home, { recursive: true, force: true }))
    }),
  )
})
