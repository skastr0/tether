import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface AggregateEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly group_by: string
    readonly groups: ReadonlyArray<{ readonly key: string; readonly count: number }>
    readonly total: number
    readonly facts_source?: "extract" | "lint"
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
// doc {
//   Greet the caller.
// }
export function greet(name: string) {
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
  "broken.tether": "@quartz no\ndoc {\n",
}

describe("aggregate command", () => {
  it("counts tethers by host_kind and folder", async () => {
    await withTempDir("tether-agg-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const byHost = await runCli(
        ["aggregate", JSON.stringify({ root: dir, group_by: "host_kind" })],
        {},
      )
      const hostPayload = expectJson<AggregateEnvelope>(byHost.stdout)
      expect(byHost.exitCode).toBe(0)
      expect(hostPayload.ok).toBe(true)
      expect(hostPayload.command).toBe("aggregate")
      expect(hostPayload.data?.git_key).toBe(hashRepoRoot(hostPayload.data?.root ?? dir))
      expect(hostPayload.data?.group_by).toBe("host_kind")
      expect(hostPayload.data?.facts_source).toBeUndefined()
      expect(hostPayload.data?.groups).toEqual(
        expect.arrayContaining([
          { key: "repository", count: 1 },
          { key: "folder", count: 2 },
          { key: "symbol", count: 2 },
        ]),
      )
      expect(hostPayload.data?.total).toBe(5)

      const byFolder = await runCli(
        ["aggregate", JSON.stringify({ root: dir, group_by: "folder" })],
        {},
      )
      const folderPayload = expectJson<AggregateEnvelope>(byFolder.stdout)
      expect(byFolder.exitCode).toBe(0)
      expect(folderPayload.data?.groups).toEqual(
        expect.arrayContaining([
          { key: ".", count: 1 },
          { key: "src", count: 2 },
          { key: "src/nested", count: 1 },
          { key: "broken", count: 1 },
        ]),
      )
      expect(folderPayload.data?.total).toBe(5)
    })
  })

  it("counts facts by kind using the same source as facts", async () => {
    await withTempDir("tether-agg-cli-", async (dir) => {
      await initGitRepo(dir, seed)

      const facts = await runCli(["facts", JSON.stringify({ root: dir })], {})
      const factsPayload = expectJson<{
        readonly data?: {
          readonly facts: ReadonlyArray<{ readonly kind: string }>
          readonly facts_source: "extract" | "lint"
        }
      }>(facts.stdout)

      const result = await runCli(
        ["aggregate", JSON.stringify({ root: dir, group_by: "fact_kind" })],
        {},
      )
      const payload = expectJson<AggregateEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.group_by).toBe("fact_kind")
      expect(payload.data?.facts_source).toBe(factsPayload.data?.facts_source)
      expect(payload.data?.groups).toContainEqual({ key: "ill_formed", count: expect.any(Number) })
      expect(payload.data?.total).toBe(factsPayload.data?.facts.length)
      expect(payload.data?.groups.find((group) => group.key === "ill_formed")?.count).toBeGreaterThan(0)
    })
  })

  it("fails on empty root, bad group_by, and a missing git repo", async () => {
    const emptyRoot = await runCli(["aggregate", '{"root":"   ","group_by":"host_kind"}'], {})
    expect(expectJson<AggregateEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

    const badGroup = await runCli(["aggregate", JSON.stringify({ root: ".", group_by: "wiki" })], {})
    expect(badGroup.exitCode).toBe(1)
    expect(expectJson<AggregateEnvelope>(badGroup.stderr).error?.type).toBe("JsonInputError")

    await withTempDir("tether-agg-nogit-", async (missing) => {
      const notRepo = await runCli(
        ["aggregate", JSON.stringify({ root: missing, group_by: "host_kind" })],
        {},
      )
      expect(notRepo.exitCode).toBe(1)
      expect(expectJson<AggregateEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
    })
  })

  it("registers a schema", async () => {
    const schema = await runCli(["schema", "show", "aggregate"], {})
    const payload = expectJson<{ ok: boolean; data?: { schema_id?: string } }>(schema.stdout)
    expect(schema.exitCode).toBe(0)
    expect(payload.data?.schema_id).toBe("aggregate.input/v1")
  })
})
