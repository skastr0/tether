import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface SearchHit {
  readonly path: string
  readonly host: { readonly kind: string; readonly path: string; readonly name?: string }
  readonly symbols: readonly string[]
  readonly public: boolean
  readonly score: number
  readonly snippet: string
}

interface SearchData {
  readonly query: string
  readonly fts_query: string
  readonly mode: string
  readonly limit: number
  readonly indexed: number
  readonly index_path: string
  readonly source: string
  readonly capabilities: {
    readonly corpus: string
    readonly not_indexed: readonly string[]
    readonly lexical: { readonly available: boolean; readonly engine: string }
    readonly semantic: { readonly available: boolean; readonly engine: string; readonly reason?: string }
    readonly fusion: {
      readonly available: boolean
      readonly stub: boolean
      readonly lexical: boolean
      readonly semantic: boolean
    }
  }
  readonly fusion?: {
    readonly stub: boolean
    readonly lexical: boolean
    readonly semantic: boolean
  }
  readonly hits: readonly SearchHit[]
}

interface SearchEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: SearchData
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly hint?: string; readonly mode?: string }
  }
}

const sampleTethers = [
  {
    path: "src/session.ts",
    host: { kind: "symbol", path: "src/session.ts", name: "refreshSession" },
    symbols: ["refreshSession"],
    refs: [{ raw: "session.ts#Session", path: "src/session.ts", name: "Session" }],
    public: true,
    doc: "Refresh is a rename of session state, not an in-place patch.",
    examples: [{ lang: "ts", body: "await refreshSession(cookie)" }],
  },
  {
    path: "root.tether",
    host: { kind: "repository", path: "." },
    symbols: [],
    refs: [{ raw: "src/session.ts#refreshSession", path: "src/session.ts", name: "refreshSession" }],
    public: true,
    doc: "Search indexes the extract, not the wiki.",
    examples: [],
  },
  {
    path: "src/auth.ts.tether",
    host: { kind: "file", path: "src/auth.ts" },
    symbols: [],
    refs: [],
    public: false,
    doc: "Login cookie binding.",
    examples: [{ lang: "ts", body: "const token = 'EXAMPLE_ONLY_TOKEN_q9z'" }],
  },
] as const

const execFileAsync = promisify(execFile)

const withSearchEnv = async (use: (ctx: { repo: string; home: string; gitKey: string }) => Promise<void>) => {
  await withTempDir("tether-search-repo-", async (repo) => {
    await initGitRepo(repo, { ".keep": "" })
    const toplevel = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: repo })).stdout.trim()
    const gitKey = hashRepoRoot(toplevel)
    await withTempDir("tether-search-home-", async (home) => {
      await use({ repo, home, gitKey })
    })
  })
}

const search = (
  input: Record<string, unknown>,
  env: { repo: string; home: string },
  extra?: { stdinText?: string; inputArg?: string },
) =>
  runCli(
    ["search", extra?.inputArg ?? JSON.stringify({ root: env.repo, ...input })],
    { TETHER_HOME: env.home, SYNTHETIC_API_KEY: "" },
    extra?.stdinText === undefined ? undefined : { stdinText: extra.stdinText },
  )

describe("search command", () => {
  it("indexes extract tethers and finds doc text", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "session state", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("search")
      expect(payload.data?.source).toBe("tethers")
      expect(payload.data?.mode).toBe("fusion")
      expect(payload.data?.indexed).toBe(3)
      expect(payload.data?.capabilities.corpus).toBe("extract")
      expect(payload.data?.capabilities.not_indexed).toContain("wiki")
      expect(payload.data?.capabilities.semantic.available).toBe(false)
      expect(payload.data?.capabilities.semantic.engine).toBe("synthetic")
      expect(payload.data?.fusion?.stub).toBe(true)
      expect(payload.data?.fusion?.semantic).toBe(false)
      expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
      expect(payload.data?.hits[0]?.host).toEqual(sampleTethers[0].host)
      expect(payload.data?.index_path).toContain(ctx.gitKey)
      expect(payload.data?.index_path.endsWith("search.sqlite")).toBe(true)
    })
  })

  it("accepts @file JSON input", async () => {
    await withSearchEnv(async (ctx) => {
      const filePath = join(ctx.home, "query.json")
      await writeFile(
        filePath,
        JSON.stringify({ root: ctx.repo, query: "Login cookie", tethers: sampleTethers }),
      )

      const result = await search({}, ctx, { inputArg: `@${filePath}` })
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data?.hits[0]?.path).toBe("src/auth.ts.tether")
    })
  })

  it("accepts stdin JSON via -", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search(
        {},
        ctx,
        {
          inputArg: "-",
          stdinText: JSON.stringify({
            root: ctx.repo,
            query: "in-place patch",
            tethers: sampleTethers,
          }),
        },
      )
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
    })
  })

  it("searches example bodies as text, not as symbols", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "EXAMPLE_ONLY_TOKEN_q9z", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stdout)
      const hit = payload.data?.hits[0]

      expect(result.exitCode).toBe(0)
      expect(hit?.path).toBe("src/auth.ts.tether")
      expect(hit?.symbols).toEqual([])
      expect(hit?.snippet).toContain("EXAMPLE_ONLY_TOKEN_q9z")
    })
  })

  it("does not index wiki files under the project cache", async () => {
    await withSearchEnv(async (ctx) => {
      const wikiDir = join(ctx.home, "projects", ctx.gitKey, "wiki")
      await mkdir(wikiDir, { recursive: true })
      await writeFile(join(wikiDir, "poison.md"), "UNIQUE_WIKI_TOKEN_xyz never extract")

      const result = await search({ query: "UNIQUE_WIKI_TOKEN_xyz", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.hits).toEqual([])
      expect(payload.data?.capabilities.not_indexed).toContain("wiki")
    })
  })

  it("reuses the persisted extract index without re-sending tethers", async () => {
    await withSearchEnv(async (ctx) => {
      const first = await search({ query: "rename", tethers: sampleTethers }, ctx)
      expect(expectJson<SearchEnvelope>(first.stdout).ok).toBe(true)

      const second = await search({ query: "rename", mode: "lexical" }, ctx)
      const payload = expectJson<SearchEnvelope>(second.stdout)

      expect(second.exitCode).toBe(0)
      expect(payload.data?.source).toBe("index")
      expect(payload.data?.mode).toBe("lexical")
      expect(payload.data?.fusion).toBeUndefined()
      expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
    })
  })

  it("rebuilds from extract.json cache when tethers are omitted", async () => {
    await withSearchEnv(async (ctx) => {
      const cacheDir = join(ctx.home, "projects", ctx.gitKey)
      await mkdir(cacheDir, { recursive: true })
      await writeFile(join(cacheDir, "extract.json"), JSON.stringify({ tethers: sampleTethers }))

      const result = await search({ query: "extract, not the wiki" }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.source).toBe("extract_cache")
      expect(payload.data?.hits[0]?.path).toBe("root.tether")
    })
  })

  it("rejects semantic mode without SYNTHETIC_API_KEY", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "refresh", mode: "semantic", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(payload.ok).toBe(false)
      expect(payload.error?.type).toBe("SearchModeUnavailableError")
      expect(payload.error?.details?.mode).toBe("semantic")
      expect(payload.error?.message).toContain("SYNTHETIC_API_KEY")
      expect(payload.error?.message).not.toMatch(/ONNX/i)
    })
  })

  it("filters hits by path_prefix", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search(
        { query: "session", mode: "lexical", path_prefix: "src/", tethers: sampleTethers },
        ctx,
      )
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.hits.map((hit) => hit.path)).toEqual(["src/session.ts"])
    })
  })

  it("projects hit fields", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search(
        { query: "session state", mode: "lexical", fields: ["path", "score"], tethers: sampleTethers },
        ctx,
      )
      const payload = expectJson<SearchEnvelope>(result.stdout)
      const hit = payload.data?.hits[0]

      expect(result.exitCode).toBe(0)
      expect(hit).toEqual({ path: "src/session.ts", score: expect.any(Number) })
    })
  })

  it("accepts a batch array and preserves index", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search(
        {},
        ctx,
        {
          inputArg: JSON.stringify([
            { root: ctx.repo, query: "session state", mode: "lexical", tethers: sampleTethers },
            { root: ctx.repo, query: "Login cookie", mode: "lexical", tethers: sampleTethers },
          ]),
        },
      )
      const payload = expectJson<{
        readonly ok: boolean
        readonly data?: {
          readonly outcome: string
          readonly total: number
          readonly results: ReadonlyArray<{
            readonly index: number
            readonly ok: boolean
            readonly data?: { readonly hits: ReadonlyArray<{ readonly path: string }> }
          }>
        }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.data?.outcome).toBe("succeeded")
      expect(payload.data?.total).toBe(2)
      expect(payload.data?.results[0]?.index).toBe(0)
      expect(payload.data?.results[0]?.data?.hits[0]?.path).toBe("src/session.ts")
      expect(payload.data?.results[1]?.index).toBe(1)
      expect(payload.data?.results[1]?.data?.hits[0]?.path).toBe("src/auth.ts.tether")
    })
  })

  it("fails honestly when there is no extract corpus", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "refresh" }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(payload.ok).toBe(false)
      expect(payload.error?.type).toBe("SearchCorpusEmptyError")
    })
  })

  it("does not treat FTS operators in the query as syntax", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "AND OR (refresh)", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data?.fts_query).toBe('"refresh"')
      expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
    })
  })

  it("rejects a query with no searchable tokens", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({ query: "***", tethers: sampleTethers }, ctx)
      const payload = expectJson<SearchEnvelope>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(payload.error?.type).toBe("SearchQueryEmptyError")
      expect(payload.error?.details?.field).toBe("query")
    })
  })

  it("rejects invalid inline JSON", async () => {
    await withSearchEnv(async (ctx) => {
      const result = await search({}, ctx, { inputArg: "{" })
      const payload = expectJson<SearchEnvelope>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(payload.error?.type).toBe("JsonInputError")
    })
  })
})
