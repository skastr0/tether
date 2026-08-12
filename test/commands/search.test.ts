import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli } from "../helpers/cli"

const execFileAsync = promisify(execFile)

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
    readonly semantic: { readonly available: boolean; readonly engine: string; readonly reason: string }
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
    refs: [{ raw: "./session.ts#Session", path: "src/session.ts", name: "Session" }],
    public: true,
    doc: "Refresh is a rename of session state, not an in-place patch.",
    examples: [{ lang: "ts", body: "await refreshSession(cookie)" }],
  },
  {
    path: "root.tether",
    host: { kind: "repository", path: "." },
    symbols: [],
    refs: [],
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

const initGitRepo = async (): Promise<{ repo: string; gitKey: string }> => {
  const dir = await mkdtemp(join(tmpdir(), "tether-search-repo-"))
  await execFileAsync("git", ["init"], { cwd: dir })
  await execFileAsync("git", ["config", "user.email", "tether@example.com"], { cwd: dir })
  await execFileAsync("git", ["config", "user.name", "tether"], { cwd: dir })
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir })
  const toplevel = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: dir })).stdout.trim()
  return { repo: dir, gitKey: hashRepoRoot(toplevel) }
}

const withSearchEnv = <A, E, R>(
  use: (ctx: { repo: string; home: string; gitKey: string }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(async () => {
      const { repo, gitKey } = await initGitRepo()
      const home = await mkdtemp(join(tmpdir(), "tether-search-home-"))
      return { repo, home, gitKey }
    }),
    use,
    ({ repo, home }) =>
      Effect.promise(async () => {
        await rm(repo, { recursive: true, force: true })
        await rm(home, { recursive: true, force: true })
      }),
  )

const search = (
  input: Record<string, unknown>,
  env: { repo: string; home: string },
  extra?: { stdinText?: string; inputArg?: string },
) =>
  runCli(
    ["search", extra?.inputArg ?? JSON.stringify({ root: env.repo, ...input })],
    { TETHER_HOME: env.home },
    extra?.stdinText === undefined ? undefined : { stdinText: extra.stdinText },
  )

describe("search command", () => {
  it.effect("indexes extract tethers and finds doc text", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "session state", tethers: sampleTethers }, ctx)
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
        expect(payload.data?.fusion?.stub).toBe(true)
        expect(payload.data?.fusion?.semantic).toBe(false)
        expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
        expect(payload.data?.hits[0]?.host).toEqual(sampleTethers[0].host)
        expect(payload.data?.index_path).toContain(ctx.gitKey)
        expect(payload.data?.index_path.endsWith("search.sqlite")).toBe(true)
      }),
    ),
  )

  it.effect("accepts @file JSON input", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const filePath = join(ctx.home, "query.json")
        yield* Effect.promise(() =>
          writeFile(
            filePath,
            JSON.stringify({ root: ctx.repo, query: "Login cookie", tethers: sampleTethers }),
          ),
        )

        const result = yield* search({}, ctx, { inputArg: `@${filePath}` })
        const payload = expectJson<SearchEnvelope>(result.stdout)

        expect(result.exitCode).toBe(0)
        expect(payload.ok).toBe(true)
        expect(payload.data?.hits[0]?.path).toBe("src/auth.ts.tether")
      }),
    ),
  )

  it.effect("accepts stdin JSON via -", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search(
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
      }),
    ),
  )

  it.effect("searches example bodies as text, not as symbols", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "EXAMPLE_ONLY_TOKEN_q9z", tethers: sampleTethers }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stdout)
        const hit = payload.data?.hits[0]

        expect(result.exitCode).toBe(0)
        expect(hit?.path).toBe("src/auth.ts.tether")
        expect(hit?.symbols).toEqual([])
        expect(hit?.snippet).toContain("EXAMPLE_ONLY_TOKEN_q9z")
      }),
    ),
  )

  it.effect("does not index wiki files under the project cache", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const wikiDir = join(ctx.home, "projects", ctx.gitKey, "wiki")
        yield* Effect.promise(async () => {
          await mkdir(wikiDir, { recursive: true })
          await writeFile(join(wikiDir, "poison.md"), "UNIQUE_WIKI_TOKEN_xyz never extract")
        })

        const result = yield* search({ query: "UNIQUE_WIKI_TOKEN_xyz", tethers: sampleTethers }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stdout)

        expect(result.exitCode).toBe(0)
        expect(payload.data?.hits).toEqual([])
        expect(payload.data?.capabilities.not_indexed).toContain("wiki")
      }),
    ),
  )

  it.effect("reuses the persisted extract index without re-sending tethers", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const first = yield* search({ query: "rename", tethers: sampleTethers }, ctx)
        expect(expectJson<SearchEnvelope>(first.stdout).ok).toBe(true)

        const second = yield* search({ query: "rename", mode: "lexical" }, ctx)
        const payload = expectJson<SearchEnvelope>(second.stdout)

        expect(second.exitCode).toBe(0)
        expect(payload.data?.source).toBe("index")
        expect(payload.data?.mode).toBe("lexical")
        expect(payload.data?.fusion).toBeUndefined()
        expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
      }),
    ),
  )

  it.effect("rebuilds from extract.json cache when tethers are omitted", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const cacheDir = join(ctx.home, "projects", ctx.gitKey)
        yield* Effect.promise(async () => {
          await mkdir(cacheDir, { recursive: true })
          await writeFile(join(cacheDir, "extract.json"), JSON.stringify({ tethers: sampleTethers }))
        })

        const result = yield* search({ query: "extract, not the wiki" }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stdout)

        expect(result.exitCode).toBe(0)
        expect(payload.data?.source).toBe("extract_cache")
        expect(payload.data?.hits[0]?.path).toBe("root.tether")
      }),
    ),
  )

  it.effect("rejects semantic mode instead of faking embeddings", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "refresh", mode: "semantic", tethers: sampleTethers }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stderr)

        expect(result.exitCode).toBe(1)
        expect(payload.ok).toBe(false)
        expect(payload.error?.type).toBe("SearchModeUnavailableError")
        expect(payload.error?.details?.mode).toBe("semantic")
      }),
    ),
  )

  it.effect("fails honestly when there is no extract corpus", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "refresh" }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stderr)

        expect(result.exitCode).toBe(1)
        expect(payload.ok).toBe(false)
        expect(payload.error?.type).toBe("SearchCorpusEmptyError")
      }),
    ),
  )

  it.effect("does not treat FTS operators in the query as syntax", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "AND OR (refresh)", tethers: sampleTethers }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stdout)

        expect(result.exitCode).toBe(0)
        expect(payload.ok).toBe(true)
        expect(payload.data?.fts_query).toBe('"refresh"')
        expect(payload.data?.hits[0]?.path).toBe("src/session.ts")
      }),
    ),
  )

  it.effect("rejects a query with no searchable tokens", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({ query: "***", tethers: sampleTethers }, ctx)
        const payload = expectJson<SearchEnvelope>(result.stderr)

        expect(result.exitCode).toBe(1)
        expect(payload.error?.type).toBe("SearchQueryEmptyError")
        expect(payload.error?.details?.field).toBe("query")
      }),
    ),
  )

  it.effect("rejects invalid inline JSON", () =>
    withSearchEnv((ctx) =>
      Effect.gen(function* () {
        const result = yield* search({}, ctx, { inputArg: "{" })
        const payload = expectJson<SearchEnvelope>(result.stderr)

        expect(result.exitCode).toBe(1)
        expect(payload.error?.type).toBe("JsonInputError")
      }),
    ),
  )
})
