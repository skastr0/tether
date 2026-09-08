import { describe, expect, it } from "vitest"
import { Effect } from "effect"

import { hashRepoRoot } from "../../src/core/git"
import { lintRepo } from "../../src/facts/lint"
import type { Evidence } from "../../src/facts/evidence"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface FactsEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: Evidence & {
    readonly root: string
    readonly git_key: string
    readonly facts: ReadonlyArray<{ readonly kind: string; readonly path: string }>
    readonly facts_source: "lint"
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string }
  }
}

const seed = {
  "root.tether": `@ref src/host.ts#value
doc {
  Repo doctrine.
}
`,
  "src/host.ts": "export const value = 1\n",
  "src.tether": "@quartz no\ndoc {\n",
  "NOTES.md": "# homeless\n",
}

describe("facts command", () => {
  it("returns the repo fact list and records the source", async () => {
    await withTempDir("tether-facts-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const result = await runCli(["facts", JSON.stringify({ root: dir })], {})
      const payload = expectJson<FactsEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("facts")
      expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
      expect(payload.data?.facts_source).toBe("lint")
      expect(payload.data?.facts).toContainEqual({ kind: "ill_formed", path: "src.tether" })
      expect(payload.data?.facts).toContainEqual({ kind: "rogue_document", path: "NOTES.md" })
      const lint = await Effect.runPromise(lintRepo(dir))
      expect(payload.data?.facts).toEqual(lint.facts)
      expect(payload.data?.coverage).toEqual(lint.coverage)
      expect(payload.data?.comparisons).toEqual(lint.comparisons)
    })
  })

  it("fails on empty root and a missing git repo", async () => {
    const emptyRoot = await runCli(["facts", '{"root":"   "}'], {})
    expect(emptyRoot.exitCode).toBe(1)
    expect(expectJson<FactsEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

    await withTempDir("tether-facts-nogit-", async (missing) => {
      const notRepo = await runCli(["facts", JSON.stringify({ root: missing })], {})
      expect(notRepo.exitCode).toBe(1)
      expect(expectJson<FactsEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
    })
  })

  it("registers a schema", async () => {
    const schema = await runCli(["schema", "show", "facts"], {})
    const payload = expectJson<{ ok: boolean; data?: { schema_id?: string } }>(schema.stdout)
    expect(schema.exitCode).toBe(0)
    expect(payload.data?.schema_id).toBe("facts.input/v1")
  })
})
