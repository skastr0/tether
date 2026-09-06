import { Effect, Fiber } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { GitNotFoundError } from "../../src/core/errors"
import { requireGitRepo, runGit } from "../../src/core/git"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const scratch: string[] = []

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runGit", () => {
  it("trims stdout by default and preserves blob bytes when trimStdout is false", async () => {
    await withTempDir("tether-git-spawn-", async (root) => {
      await initGitRepo(root, {
        "blob.txt": "  padded  \n",
      })

      const trimmed = await Effect.runPromise(runGit(root, ["show", "HEAD:blob.txt"]))
      expect(trimmed.exitCode).toBe(0)
      expect(trimmed.stdout).toBe("padded")

      const raw = await Effect.runPromise(runGit(root, ["show", "HEAD:blob.txt"], { trimStdout: false }))
      expect(raw.exitCode).toBe(0)
      expect(raw.stdout).toBe("  padded  \n")
    })
  })

  it("keeps trailing NULs from ls-files -z", async () => {
    await withTempDir("tether-git-nul-", async (root) => {
      await initGitRepo(root, { "a.txt": "a\n", "b.txt": "b\n" })
      const listed = await Effect.runPromise(runGit(root, ["ls-files", "-z"], { trimStdout: false }))
      expect(listed.exitCode).toBe(0)
      expect(listed.stdout.endsWith("\0")).toBe(true)
      expect(listed.stdout.split("\0").filter((entry) => entry.length > 0).sort()).toEqual(["a.txt", "b.txt"])
    })
  })

  it("maps missing git to GitNotFoundError", async () => {
    await withTempDir("tether-git-missing-", async (root) => {
      const result = await Effect.runPromise(
        runGit(root, ["status"], { env: { PATH: "/nonexistent-tether-git-bin" } }).pipe(Effect.either),
      )
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(GitNotFoundError)
      }
    })
  })

  it("kills the subprocess when the effect is interrupted", async () => {
    await withTempDir("tether-git-abort-", async (root) => {
      await initGitRepo(root, { "a.txt": "a\n" })
      const fiber = Effect.runFork(
        runGit(root, ["-c", "alias.hang=!sleep 30", "hang"]),
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      const exit = await Effect.runPromise(Fiber.interrupt(fiber))
      expect(exit._tag).toBe("Failure")
    })
  })

  it("requireGitRepo succeeds in Node and fails outside a repository", async () => {
    await withTempDir("tether-git-repo-", async (root) => {
      await initGitRepo(root, { "a.txt": "a\n" })
      const repo = await Effect.runPromise(requireGitRepo(root))
      expect(repo.root).toBe(root)
    })

    const outside = await mkdtemp(join(tmpdir(), "tether-git-outside-"))
    scratch.push(outside)
    await writeFile(join(outside, "loose.txt"), "x\n")
    const result = await Effect.runPromise(requireGitRepo(outside).pipe(Effect.either))
    expect(result._tag).toBe("Left")
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("NotAGitRepositoryError")
    }
  })
})
