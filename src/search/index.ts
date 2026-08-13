import { Database } from "bun:sqlite"
import { Schema } from "effect"

import type { Host } from "../extract/types"
import {
  compileFtsQuery,
  escapeLike,
  examplesSearchText,
  fallbackSnippet,
  hostSearchText,
  refsSearchText,
  rowEmbedText,
} from "./text"
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DOCUMENT_PREFIX,
  makeSyntheticEmbedder,
  QUERY_PREFIX,
  resolveSyntheticApiKey,
  SyntheticEmbeddingError,
  type Embedder,
} from "./synthetic"
import {
  cachedVectorHashes,
  embedTextHash,
  ensureVectorTable,
  knnByHash,
  loadVectorMap,
  rrfScore,
  upsertVectors,
} from "./vectors"

export { compileFtsQuery, examplesSearchText, hostSearchText, refsSearchText } from "./text"
export {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  DOCUMENT_PREFIX,
  makeSyntheticEmbedder,
  QUERY_PREFIX,
  resolveSyntheticApiKey,
  SYNTHETIC_EMBEDDINGS_URL,
  SyntheticEmbeddingError,
  syntheticApiKeyFromEnv,
  type Embedder,
} from "./synthetic"
export { embedTextHash, tetherEmbedText } from "./vectors"

export const SEARCH_DB_NAME = "search.sqlite"
export const EXTRACT_CACHE_NAME = "extract.json"
export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 100
export const SEARCH_HIT_FIELDS = ["path", "host", "symbols", "public", "score", "bm25", "snippet"] as const

export type SearchHitField = (typeof SEARCH_HIT_FIELDS)[number]

export const SearchModeSchema = Schema.Literal("lexical", "semantic", "fusion")

export type SearchMode = typeof SearchModeSchema.Type

export const HostKindSchema = Schema.Literal("symbol", "file", "folder", "repository", "honorary_folder")

export const HostSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("symbol"),
    path: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("file"),
    path: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("folder"),
    path: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("repository"),
    path: Schema.Literal("."),
  }),
  Schema.Struct({
    kind: Schema.Literal("honorary_folder"),
    path: Schema.String,
    file: Schema.Literal("AGENTS.md", "CLAUDE.md"),
  }),
)

export const RefSchema = Schema.Struct({
  raw: Schema.String,
  path: Schema.String,
  name: Schema.optionalWith(Schema.String, { exact: true }),
})

export const ExampleBlockSchema = Schema.Struct({
  lang: Schema.String,
  body: Schema.String,
})

export const TetherSchema = Schema.Struct({
  path: Schema.String,
  host: HostSchema,
  symbols: Schema.Array(Schema.String),
  refs: Schema.Array(RefSchema),
  public: Schema.Boolean,
  doc: Schema.String,
  examples: Schema.Array(ExampleBlockSchema),
})

export const SearchHitFieldSchema = Schema.Literal(...SEARCH_HIT_FIELDS)

export const SearchInputSchema = Schema.Struct({
  query: Schema.NonEmptyString,
  root: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, MAX_SEARCH_LIMIT))),
  mode: Schema.optional(SearchModeSchema),
  tethers: Schema.optional(Schema.Array(TetherSchema)),
  host_kind: Schema.optional(HostKindSchema),
  path_prefix: Schema.optional(Schema.String),
  symbol: Schema.optional(Schema.String),
  public: Schema.optional(Schema.Boolean),
  folder: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Array(SearchHitFieldSchema)),
})

export type SearchInput = typeof SearchInputSchema.Type
export type SearchTether = typeof TetherSchema.Type

const ExtractTethersObjectSchema = Schema.Struct({
  tethers: Schema.Array(TetherSchema),
})

const ExtractEnvelopeSchema = Schema.Struct({
  data: Schema.Struct({
    tethers: Schema.Array(TetherSchema),
  }),
})

export const ExtractCacheSchema = Schema.Union(
  Schema.Array(TetherSchema),
  ExtractTethersObjectSchema,
  ExtractEnvelopeSchema,
)

export type SearchSource = "tethers" | "extract_cache" | "index"

export class SearchQueryEmptyError extends Schema.TaggedError<SearchQueryEmptyError>()(
  "SearchQueryEmptyError",
  {
    field: Schema.Literal("query"),
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class SearchCorpusEmptyError extends Schema.TaggedError<SearchCorpusEmptyError>()(
  "SearchCorpusEmptyError",
  {
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class SearchModeUnavailableError extends Schema.TaggedError<SearchModeUnavailableError>()(
  "SearchModeUnavailableError",
  {
    mode: SearchModeSchema,
    message: Schema.String,
    hint: Schema.String,
  },
) {}

export class SearchIndexError extends Schema.TaggedError<SearchIndexError>()("SearchIndexError", {
  message: Schema.String,
  hint: Schema.optional(Schema.String),
}) {}

export type SearchError =
  | SearchQueryEmptyError
  | SearchCorpusEmptyError
  | SearchModeUnavailableError
  | SearchIndexError
  | SyntheticEmbeddingError

export const isSearchError = (error: unknown): error is SearchError =>
  error instanceof SearchQueryEmptyError ||
  error instanceof SearchCorpusEmptyError ||
  error instanceof SearchModeUnavailableError ||
  error instanceof SearchIndexError ||
  error instanceof SyntheticEmbeddingError

export interface SearchFilters {
  readonly host_kind?: typeof HostKindSchema.Type
  readonly path_prefix?: string
  readonly symbol?: string
  readonly public?: boolean
  readonly folder?: string
}

export interface SearchCapabilities {
  readonly corpus: "extract"
  readonly not_indexed: readonly ["wiki"]
  readonly lexical: {
    readonly available: true
    readonly engine: "sqlite-fts5"
  }
  readonly semantic: {
    readonly available: boolean
    readonly engine: "synthetic"
    readonly model: string
    readonly dimensions: number
    readonly reason?: string
  }
  readonly fusion: {
    readonly available: true
    readonly stub: boolean
    readonly lexical: true
    readonly semantic: boolean
    readonly reason?: string
  }
}

export const searchCapabilities = (semanticAvailable: boolean): SearchCapabilities => ({
  corpus: "extract",
  not_indexed: ["wiki"],
  lexical: {
    available: true,
    engine: "sqlite-fts5",
  },
  semantic: semanticAvailable
    ? {
        available: true,
        engine: "synthetic",
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      }
    : {
        available: false,
        engine: "synthetic",
        model: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        reason: "SYNTHETIC_API_KEY is required for semantic search",
      },
  fusion: semanticAvailable
    ? {
        available: true,
        stub: false,
        lexical: true,
        semantic: true,
      }
    : {
        available: true,
        stub: true,
        lexical: true,
        semantic: false,
        reason: "SYNTHETIC_API_KEY is not set; fusion ranks lexical FTS5 hits only",
      },
})

export const SEARCH_CAPABILITIES = searchCapabilities(false)

const SCHEMA_SQL = `
DROP TABLE IF EXISTS extract_fts;
DROP TABLE IF EXISTS extract_doc;
CREATE TABLE extract_doc (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  host_json TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  public INTEGER NOT NULL,
  doc TEXT NOT NULL
);
CREATE VIRTUAL TABLE extract_fts USING fts5(
  path,
  host,
  symbols,
  refs,
  doc,
  examples,
  tokenize = 'unicode61 remove_diacritics 2'
);
`

export const openSearchDatabase = (path: string): Database => {
  const db = new Database(path, { create: true })
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;")
  }
  ensureVectorTable(db)
  return db
}

export const indexIsReady = (db: Database): boolean => {
  const row = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'extract_doc'",
  ).get()
  return row !== null
}

export const indexDocumentCount = (db: Database): number => {
  if (!indexIsReady(db)) {
    return 0
  }
  const row = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM extract_doc").get()
  return row?.n ?? 0
}

export const rebuildExtractIndex = (db: Database, tethers: readonly SearchTether[]): number => {
  ensureVectorTable(db)
  db.exec(SCHEMA_SQL)
  const insertDoc = db.prepare(
    "INSERT INTO extract_doc (id, path, host_json, symbols_json, public, doc) VALUES (?, ?, ?, ?, ?, ?)",
  )
  const insertFts = db.prepare(
    "INSERT INTO extract_fts (rowid, path, host, symbols, refs, doc, examples) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  const insertAll = db.transaction((rows: readonly SearchTether[]) => {
    for (const [offset, tether] of rows.entries()) {
      const id = offset + 1
      insertDoc.run(
        id,
        tether.path,
        JSON.stringify(tether.host),
        JSON.stringify(tether.symbols),
        tether.public ? 1 : 0,
        tether.doc,
      )
      insertFts.run(
        id,
        tether.path,
        hostSearchText(tether.host),
        tether.symbols.join(" "),
        refsSearchText(tether.refs),
        tether.doc,
        examplesSearchText(tether.examples),
      )
    }
  })
  insertAll(tethers)
  return tethers.length
}

export interface SearchHit {
  readonly path: string
  readonly host: Host
  readonly symbols: readonly string[]
  readonly public: boolean
  readonly score: number
  readonly bm25: number
  readonly snippet: string
}

export interface SearchFusion {
  readonly stub: boolean
  readonly lexical: true
  readonly semantic: boolean
  readonly method?: "rrf"
  readonly reason?: string
}

export interface SearchResult {
  readonly query: string
  readonly fts_query: string
  readonly mode: SearchMode
  readonly limit: number
  readonly indexed: number
  readonly index_path: string
  readonly source: SearchSource
  readonly capabilities: SearchCapabilities
  readonly fusion?: SearchFusion
  readonly hits: readonly SearchHit[]
}

interface IndexedDocRow {
  readonly id: number
  readonly path: string
  readonly host_json: string
  readonly symbols_json: string
  readonly public: number
  readonly doc: string
  readonly symbols_text: string
  readonly refs_text: string
}

interface LexicalQueryRow extends IndexedDocRow {
  readonly bm25: number
  readonly doc_snippet: string
  readonly example_snippet: string
}

interface InternalHit extends SearchHit {
  readonly id: number
}

const pickSnippet = (row: Pick<LexicalQueryRow, "doc" | "doc_snippet" | "example_snippet">): string => {
  const docSnippet = row.doc_snippet.trim()
  const exampleSnippet = row.example_snippet.trim()
  if (docSnippet.includes("[")) {
    return docSnippet
  }
  if (exampleSnippet.includes("[")) {
    return exampleSnippet
  }
  return fallbackSnippet(row.doc)
}

const parseHost = (json: string): Host => Schema.decodeUnknownSync(HostSchema)(JSON.parse(json) as unknown)

const parseSymbols = (json: string): readonly string[] =>
  Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(json) as unknown)

const compileFilters = (
  filters: SearchFilters | undefined,
  docAlias: string,
): { readonly sql: string; readonly params: readonly (string | number)[] } => {
  if (filters === undefined) {
    return { sql: "", params: [] }
  }

  const clauses: string[] = []
  const params: (string | number)[] = []

  if (filters.path_prefix !== undefined && filters.path_prefix.length > 0) {
    clauses.push(`${docAlias}.path LIKE ? ESCAPE '\\'`)
    params.push(`${escapeLike(filters.path_prefix)}%`)
  }

  if (filters.host_kind !== undefined) {
    clauses.push(`json_extract(${docAlias}.host_json, '$.kind') = ?`)
    params.push(filters.host_kind)
  }

  if (filters.public !== undefined) {
    clauses.push(`${docAlias}.public = ?`)
    params.push(filters.public ? 1 : 0)
  }

  if (filters.symbol !== undefined && filters.symbol.length > 0) {
    clauses.push(
      `(json_extract(${docAlias}.host_json, '$.name') = ? OR EXISTS (SELECT 1 FROM json_each(${docAlias}.symbols_json) WHERE json_each.value = ?))`,
    )
    params.push(filters.symbol, filters.symbol)
  }

  if (filters.folder !== undefined && filters.folder.length > 0) {
    const folder = filters.folder.replace(/\/+$/, "")
    if (folder.length > 0) {
      clauses.push(
        `(${docAlias}.path = ? OR ${docAlias}.path LIKE ? ESCAPE '\\' OR json_extract(${docAlias}.host_json, '$.path') = ? OR json_extract(${docAlias}.host_json, '$.path') LIKE ? ESCAPE '\\')`,
      )
      params.push(folder, `${escapeLike(folder)}/%`, folder, `${escapeLike(folder)}/%`)
    }
  }

  return {
    sql: clauses.length === 0 ? "" : ` AND ${clauses.join(" AND ")}`,
    params,
  }
}

const toSearchHit = (hit: InternalHit): SearchHit => ({
  path: hit.path,
  host: hit.host,
  symbols: hit.symbols,
  public: hit.public,
  score: hit.score,
  bm25: hit.bm25,
  snippet: hit.snippet,
})

const projectHits = (hits: readonly SearchHit[], fields: readonly SearchHitField[] | undefined): readonly SearchHit[] => {
  if (fields === undefined) {
    return hits
  }
  return hits.map((hit) => {
    const projected: Partial<SearchHit> = {}
    for (const field of fields) {
      ;(projected as Record<string, unknown>)[field] = hit[field]
    }
    return projected as SearchHit
  })
}

const requireIndex = (db: Database): void => {
  if (!indexIsReady(db)) {
    throw new SearchCorpusEmptyError({
      message: "no extract index is available",
      hint: "Pass tethers from extract, or write extract.json under the project cache, then retry.",
    })
  }
}

const lexicalHits = (
  db: Database,
  args: {
    readonly query: string
    readonly limit: number
    readonly filters?: SearchFilters
  },
): { readonly ftsQuery: string; readonly hits: readonly InternalHit[] } => {
  const ftsQuery = compileFtsQuery(args.query)
  if (ftsQuery === undefined) {
    throw new SearchQueryEmptyError({
      field: "query",
      message: "query has no searchable tokens",
      hint: "Pass words or a quoted phrase from extract prose, symbols, refs, or example bodies.",
    })
  }

  const filters = compileFilters(args.filters, "d")
  const rows = db
    .query<LexicalQueryRow, (string | number)[]>(
      `SELECT
         d.id,
         d.path,
         d.host_json,
         d.symbols_json,
         d.public,
         d.doc,
         extract_fts.symbols AS symbols_text,
         extract_fts.refs AS refs_text,
         bm25(extract_fts) AS bm25,
         snippet(extract_fts, 4, '[', ']', '…', 16) AS doc_snippet,
         snippet(extract_fts, 5, '[', ']', '…', 12) AS example_snippet
       FROM extract_fts
       JOIN extract_doc d ON d.id = extract_fts.rowid
       WHERE extract_fts MATCH ?${filters.sql}
       ORDER BY bm25(extract_fts), d.id
       LIMIT ?`,
    )
    .all(ftsQuery, ...filters.params, args.limit)

  return {
    ftsQuery,
    hits: rows.map((row) => {
      const bm25 = Number(row.bm25)
      return {
        id: row.id,
        path: row.path,
        host: parseHost(row.host_json),
        symbols: parseSymbols(row.symbols_json),
        public: row.public === 1,
        score: Number.isFinite(bm25) ? -bm25 : 0,
        bm25,
        snippet: pickSnippet(row),
      }
    }),
  }
}

const listIndexedDocs = (db: Database, filters?: SearchFilters): readonly IndexedDocRow[] => {
  const compiled = compileFilters(filters, "d")
  return db
    .query<IndexedDocRow, (string | number)[]>(
      `SELECT
         d.id,
         d.path,
         d.host_json,
         d.symbols_json,
         d.public,
         d.doc,
         extract_fts.symbols AS symbols_text,
         extract_fts.refs AS refs_text
       FROM extract_doc d
       JOIN extract_fts ON extract_fts.rowid = d.id
       WHERE 1=1${compiled.sql}
       ORDER BY d.id`,
    )
    .all(...compiled.params)
}

const persistMissingVectors = async (
  db: Database,
  embedder: Embedder,
  docs: readonly IndexedDocRow[],
): Promise<Map<string, number[]>> => {
  const hashed = docs.map((doc) => ({
    hash: embedTextHash(rowEmbedText({ doc: doc.doc, symbols: doc.symbols_text, refs: doc.refs_text })),
  }))
  const cached = cachedVectorHashes(db)
  const missing: { hash: string; text: string }[] = []
  const seen = new Set<string>()
  for (const [offset, doc] of docs.entries()) {
    const hash = hashed[offset]?.hash
    if (hash === undefined || seen.has(hash) || cached.has(hash)) {
      continue
    }
    seen.add(hash)
    missing.push({
      hash,
      text: rowEmbedText({ doc: doc.doc, symbols: doc.symbols_text, refs: doc.refs_text }),
    })
  }

  if (missing.length > 0) {
    const vectors = await embedder.embedMany(missing.map((item) => `${DOCUMENT_PREFIX}${item.text}`))
    upsertVectors(
      db,
      missing.map((item, index) => {
        const vector = vectors[index]
        if (vector === undefined) {
          throw new SyntheticEmbeddingError({
            operation: "synthetic.embeddings.decode",
            message: `Synthetic embeddings response omitted document index ${index}`,
          })
        }
        return { contentHash: item.hash, vector }
      }),
    )
  }

  return loadVectorMap(
    db,
    hashed.map((item) => item.hash),
  )
}

const semanticHits = (
  docs: readonly IndexedDocRow[],
  queryVector: readonly number[],
  vectors: ReadonlyMap<string, readonly number[]>,
  limit: number,
): readonly InternalHit[] => {
  const candidates = docs.map((doc) => ({
    id: doc.id,
    hash: embedTextHash(rowEmbedText({ doc: doc.doc, symbols: doc.symbols_text, refs: doc.refs_text })),
  }))
  const ranked = knnByHash(queryVector, candidates, vectors, limit)
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const hits: InternalHit[] = []
  for (const item of ranked) {
    const doc = byId.get(item.id)
    if (doc === undefined) {
      continue
    }
    hits.push({
      id: doc.id,
      path: doc.path,
      host: parseHost(doc.host_json),
      symbols: parseSymbols(doc.symbols_json),
      public: doc.public === 1,
      score: item.score,
      bm25: 0,
      snippet: fallbackSnippet(doc.doc),
    })
  }
  return hits
}

const fuseHits = (
  lexical: readonly InternalHit[],
  semantic: readonly InternalHit[],
  limit: number,
): readonly InternalHit[] => {
  const fused = new Map<number, { score: number; hit: InternalHit }>()
  const add = (list: readonly InternalHit[]) => {
    for (const [rank, hit] of list.entries()) {
      const current = fused.get(hit.id)
      const score = rrfScore(rank)
      if (current === undefined) {
        fused.set(hit.id, { score, hit })
        continue
      }
      current.score += score
      if (current.hit.bm25 === 0 && hit.bm25 !== 0) {
        current.hit = hit
      }
    }
  }
  add(lexical)
  add(semantic)
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.hit.path.localeCompare(right.hit.path) || left.hit.id - right.hit.id)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, score: entry.score }))
}

const resolveEmbedder = (args: {
  readonly embedder?: Embedder
  readonly apiKey?: string
}): Embedder | undefined => {
  if (args.embedder !== undefined) {
    return args.embedder
  }
  const apiKey = resolveSyntheticApiKey(args.apiKey)
  return apiKey === undefined ? undefined : makeSyntheticEmbedder({ apiKey })
}

export const queryExtractIndex = (
  db: Database,
  args: {
    readonly query: string
    readonly mode: Exclude<SearchMode, "semantic">
    readonly limit: number
    readonly indexPath: string
    readonly source: SearchSource
    readonly filters?: SearchFilters
    readonly fields?: readonly SearchHitField[]
    readonly capabilities?: SearchCapabilities
  },
): SearchResult => {
  requireIndex(db)
  const capabilities = args.capabilities ?? SEARCH_CAPABILITIES
  const { ftsQuery, hits } = lexicalHits(db, args)
  return {
    query: args.query,
    fts_query: ftsQuery,
    mode: args.mode,
    limit: args.limit,
    indexed: indexDocumentCount(db),
    index_path: args.indexPath,
    source: args.source,
    capabilities,
    ...(args.mode === "fusion"
      ? {
          fusion: {
            stub: true,
            lexical: true as const,
            semantic: false,
            reason: capabilities.fusion.reason ?? "SYNTHETIC_API_KEY is not set; fusion ranks lexical FTS5 hits only",
          },
        }
      : {}),
    hits: projectHits(hits.map(toSearchHit), args.fields),
  }
}

export const runExtractSearch = async (args: {
  readonly dbPath: string
  readonly query: string
  readonly mode: SearchMode
  readonly limit: number
  readonly source: SearchSource
  readonly tethers?: readonly SearchTether[]
  readonly filters?: SearchFilters
  readonly fields?: readonly SearchHitField[]
  readonly embedder?: Embedder
  readonly apiKey?: string
}): Promise<SearchResult> => {
  const embedder = resolveEmbedder(args)
  const capabilities = searchCapabilities(embedder !== undefined)

  if (args.mode === "semantic" && embedder === undefined) {
    throw new SearchModeUnavailableError({
      mode: "semantic",
      message: "semantic search requires SYNTHETIC_API_KEY",
      hint: "Set SYNTHETIC_API_KEY to enable Synthetic embeddings, or use mode lexical / fusion (fusion degrades to lexical without a key).",
    })
  }

  const db = openSearchDatabase(args.dbPath)
  try {
    if (args.tethers !== undefined) {
      rebuildExtractIndex(db, args.tethers)
    } else {
      requireIndex(db)
    }

    if (args.mode === "lexical" || (args.mode === "fusion" && embedder === undefined)) {
      return queryExtractIndex(db, {
        query: args.query,
        mode: args.mode,
        limit: args.limit,
        indexPath: args.dbPath,
        source: args.source,
        ...(args.filters === undefined ? {} : { filters: args.filters }),
        ...(args.fields === undefined ? {} : { fields: args.fields }),
        capabilities,
      })
    }

    if (embedder === undefined) {
      throw new SearchModeUnavailableError({
        mode: args.mode,
        message: "semantic search requires SYNTHETIC_API_KEY",
        hint: "Set SYNTHETIC_API_KEY to enable Synthetic embeddings, or use mode lexical / fusion (fusion degrades to lexical without a key).",
      })
    }

    const docs = listIndexedDocs(db, args.filters)
    const vectors = await persistMissingVectors(db, embedder, docs)
    const queryVectors = await embedder.embedMany([`${QUERY_PREFIX}${args.query}`])
    const queryVector = queryVectors[0]
    if (queryVector === undefined) {
      throw new SyntheticEmbeddingError({
        operation: "synthetic.embeddings.decode",
        message: "Synthetic embeddings response omitted the query vector",
      })
    }

    const candidateLimit = Math.max(args.limit, 50)
    const knn = semanticHits(docs, queryVector, vectors, candidateLimit)

    if (args.mode === "semantic") {
      return {
        query: args.query,
        fts_query: compileFtsQuery(args.query) ?? "",
        mode: "semantic",
        limit: args.limit,
        indexed: indexDocumentCount(db),
        index_path: args.dbPath,
        source: args.source,
        capabilities,
        hits: projectHits(knn.slice(0, args.limit).map(toSearchHit), args.fields),
      }
    }

    let ftsQuery = compileFtsQuery(args.query) ?? ""
    let lexical: readonly InternalHit[] = []
    try {
      const scanned = lexicalHits(db, {
        query: args.query,
        limit: candidateLimit,
        ...(args.filters === undefined ? {} : { filters: args.filters }),
      })
      ftsQuery = scanned.ftsQuery
      lexical = scanned.hits
    } catch (error) {
      if (!(error instanceof SearchQueryEmptyError)) {
        throw error
      }
    }

    return {
      query: args.query,
      fts_query: ftsQuery,
      mode: "fusion",
      limit: args.limit,
      indexed: indexDocumentCount(db),
      index_path: args.dbPath,
      source: args.source,
      capabilities,
      fusion: {
        stub: false,
        lexical: true,
        semantic: true,
        method: "rrf",
      },
      hits: projectHits(fuseHits(lexical, knn, args.limit).map(toSearchHit), args.fields),
    }
  } finally {
    db.close()
  }
}

export const unwrapExtractCache = (value: typeof ExtractCacheSchema.Type): readonly SearchTether[] => {
  if (Array.isArray(value)) {
    return value
  }

  const record = value as {
    readonly tethers?: readonly SearchTether[]
    readonly data?: { readonly tethers: readonly SearchTether[] }
  }
  if (record.data !== undefined) {
    return record.data.tethers
  }
  return record.tethers ?? []
}
