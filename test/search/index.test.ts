import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"

import type { SearchResult, SearchTether } from "../../src/search/index"

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = resolve(dirname(import.meta.filename), "../..")
const HARNESS = join(PROJECT_ROOT, "test/search/harness.ts")

const sampleTethers: readonly SearchTether[] = [
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
]

interface HarnessOutput {
  readonly ok: boolean
  readonly result?: SearchResult
  readonly calls?: readonly (readonly string[])[]
  readonly prefixes?: { readonly document: string; readonly query: string }
  readonly error?: { readonly type: string; readonly message: string }
}

const scratch: string[] = []

const tempDb = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "tether-search-unit-"))
  scratch.push(directory)
  return join(directory, "search.sqlite")
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const runHarness = async (input: Record<string, unknown>): Promise<HarnessOutput> => {
  const { stdout } = await execFileAsync("bun", [HARNESS, JSON.stringify(input)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, SYNTHETIC_API_KEY: "" },
  })
  return JSON.parse(stdout) as HarnessOutput
}

describe("runExtractSearch", () => {
  it("runs lexical FTS without calling the embedder", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "session state",
      mode: "lexical",
      tethers: sampleTethers,
      mock: true,
      apiKey: "",
    })

    expect(payload.ok).toBe(true)
    expect(payload.result?.mode).toBe("lexical")
    expect(payload.result?.fusion).toBeUndefined()
    expect(payload.result?.hits[0]?.path).toBe("src/session.ts")
    expect(payload.calls).toEqual([])
  })

  it("rejects semantic mode without a key as SearchModeUnavailableError", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "refresh",
      mode: "semantic",
      tethers: sampleTethers,
      apiKey: "",
    })

    expect(payload.ok).toBe(false)
    expect(payload.error?.type).toBe("SearchModeUnavailableError")
    expect(payload.error?.message).toBe("semantic search requires SYNTHETIC_API_KEY")
    expect(payload.error?.message).not.toMatch(/ONNX/i)
  })

  it("keeps fusion as a lexical stub without a key", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "session state",
      mode: "fusion",
      tethers: sampleTethers,
      apiKey: "",
    })

    expect(payload.ok).toBe(true)
    expect(payload.result?.mode).toBe("fusion")
    expect(payload.result?.fusion).toEqual({
      stub: true,
      lexical: true,
      semantic: false,
      reason: "SYNTHETIC_API_KEY is not set; fusion ranks lexical FTS5 hits only",
    })
    expect(payload.result?.capabilities.semantic.available).toBe(false)
    expect(payload.result?.capabilities.semantic.engine).toBe("synthetic")
    expect(payload.result?.hits[0]?.path).toBe("src/session.ts")
    expect(payload.calls).toEqual([])
  })

  it("filters lexical hits by path_prefix", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "session",
      mode: "lexical",
      tethers: sampleTethers,
      filters: { path_prefix: "src/" },
      apiKey: "",
    })

    expect(payload.ok).toBe(true)
    expect(payload.result?.hits.map((hit) => hit.path)).toEqual(["src/session.ts"])
  })

  it("runs semantic kNN through a mock embedder and never hits the network", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "login cookie",
      mode: "semantic",
      tethers: sampleTethers,
      mock: true,
    })

    expect(payload.ok).toBe(true)
    expect(payload.result?.mode).toBe("semantic")
    expect(payload.result?.hits[0]?.path).toBe("src/auth.ts.tether")
    expect(payload.calls?.some((batch) => batch.some((value) => value.startsWith(payload.prefixes?.query ?? "search_query: ")))).toBe(
      true,
    )
    expect(
      payload.calls?.some((batch) => batch.some((value) => value.startsWith(payload.prefixes?.document ?? "search_document: "))),
    ).toBe(true)
  })

  it("merges FTS and kNN in fusion when an embedder is present", async () => {
    const payload = await runHarness({
      dbPath: ":memory:",
      query: "session cookie",
      mode: "fusion",
      tethers: sampleTethers,
      mock: true,
    })

    expect(payload.ok).toBe(true)
    expect(payload.result?.fusion).toEqual({
      stub: false,
      lexical: true,
      semantic: true,
      method: "rrf",
    })
    expect(payload.result?.capabilities.semantic.available).toBe(true)
    expect(payload.result?.hits.map((hit) => hit.path)).toEqual(
      expect.arrayContaining(["src/session.ts", "src/auth.ts.tether"]),
    )
  })

  it("embeds only missing document hashes on later searches", async () => {
    const dbPath = await tempDb()
    const first = await runHarness({
      dbPath,
      query: "session",
      mode: "semantic",
      tethers: sampleTethers,
      mock: true,
    })
    const second = await runHarness({
      dbPath,
      query: "cookie",
      mode: "semantic",
      source: "index",
      mock: true,
    })

    const firstDocCalls = first.calls?.filter((batch) =>
      batch.some((value) => value.startsWith("search_document: ")),
    ).length
    const secondDocCalls = second.calls?.filter((batch) =>
      batch.some((value) => value.startsWith("search_document: ")),
    ).length

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(firstDocCalls).toBe(1)
    expect(secondDocCalls).toBe(0)
    expect(second.calls?.at(-1)).toEqual(["search_query: cookie"])
  })
})
