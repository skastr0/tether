import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DOCUMENT_PREFIX,
  QUERY_PREFIX,
  isSearchError,
  runExtractSearch,
  type Embedder,
  type SearchFilters,
  type SearchMode,
  type SearchSource,
  type SearchTether,
} from "../../src/search/index"

const TOKEN_AXES = ["session", "cookie", "wiki", "extract", "refresh", "login"] as const

const mockVector = (text: string): number[] => {
  const vector = new Array<number>(DEFAULT_EMBEDDING_DIMENSIONS).fill(0)
  const lower = text.toLowerCase()
  for (const [index, token] of TOKEN_AXES.entries()) {
    if (lower.includes(token)) {
      vector[index] = 1
    }
  }
  let hash = 2166136261
  for (let offset = 0; offset < lower.length; offset += 1) {
    hash ^= lower.charCodeAt(offset)
    hash = Math.imul(hash, 16777619)
  }
  vector[16] = 0.05 + (hash >>> 0) / 2 ** 32
  return vector
}

interface HarnessInput {
  readonly dbPath: string
  readonly query: string
  readonly mode: SearchMode
  readonly limit?: number
  readonly source?: SearchSource
  readonly tethers?: readonly SearchTether[]
  readonly filters?: SearchFilters
  readonly mock?: boolean
  readonly apiKey?: string
}

const recordingEmbedder = (): { embedder: Embedder; calls: string[][] } => {
  const calls: string[][] = []
  return {
    calls,
    embedder: {
      embedMany: async (values) => {
        calls.push([...values])
        return values.map(mockVector)
      },
    },
  }
}

const input = JSON.parse(Bun.argv[2] ?? "{}") as HarnessInput
const recorded = input.mock === true ? recordingEmbedder() : undefined

try {
  const result = await runExtractSearch({
    dbPath: input.dbPath,
    query: input.query,
    mode: input.mode,
    limit: input.limit ?? 10,
    source: input.source ?? (input.tethers === undefined ? "index" : "tethers"),
    ...(input.tethers === undefined ? {} : { tethers: input.tethers }),
    ...(input.filters === undefined ? {} : { filters: input.filters }),
    ...(recorded === undefined ? {} : { embedder: recorded.embedder }),
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
  })
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      result,
      calls: recorded?.calls ?? [],
      prefixes: { document: DOCUMENT_PREFIX, query: QUERY_PREFIX },
    })}\n`,
  )
} catch (cause) {
  const error =
    isSearchError(cause) || cause instanceof Error
      ? {
          type: "_tag" in cause && typeof cause._tag === "string" ? cause._tag : cause.name,
          message: cause.message,
        }
      : { type: "Error", message: String(cause) }
  process.stdout.write(`${JSON.stringify({ ok: false, error, calls: recorded?.calls ?? [] })}\n`)
}
