import { Database } from "bun:sqlite"
import { Schema } from "effect"

import type { ExampleBlock, Host, Ref } from "../extract/types"

export const SEARCH_DB_NAME = "search.sqlite"
export const EXTRACT_CACHE_NAME = "extract.json"
export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 100

export const SEARCH_CAPABILITIES = {
  corpus: "extract",
  not_indexed: ["wiki"],
  lexical: {
    available: true,
    engine: "sqlite-fts5",
  },
  semantic: {
    available: false,
    engine: "local-onnx",
    reason: "no small ONNX embedding runtime is shipped in this cut",
  },
  fusion: {
    available: true,
    stub: true,
    lexical: true,
    semantic: false,
    reason: "fusion ranks lexical FTS5 hits only until local embeddings ship",
  },
} as const

export const SearchModeSchema = Schema.Literal("lexical", "semantic", "fusion")

export type SearchMode = typeof SearchModeSchema.Type

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

export const SearchInputSchema = Schema.Struct({
  query: Schema.NonEmptyString,
  root: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.pipe(Schema.between(1, MAX_SEARCH_LIMIT))),
  mode: Schema.optional(SearchModeSchema),
  tethers: Schema.optional(Schema.Array(TetherSchema)),
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

export const isSearchError = (error: unknown): error is SearchError =>
  error instanceof SearchQueryEmptyError ||
  error instanceof SearchCorpusEmptyError ||
  error instanceof SearchModeUnavailableError ||
  error instanceof SearchIndexError

const quoteFtsLiteral = (value: string): string => `"${value.replaceAll('"', '""')}"`

const FTS_RESERVED = new Set(["and", "or", "not", "near"])

export const compileFtsQuery = (raw: string): string | undefined => {
  const parts: string[] = []
  const token = /"([^"]+)"|(\S+)/g
  let match = token.exec(raw)
  while (match !== null) {
    const phrase = match[1]
    const loose = match[2]
    if (phrase !== undefined) {
      const trimmed = phrase.trim()
      if (trimmed.length > 0) {
        parts.push(quoteFtsLiteral(trimmed))
      }
    } else if (loose !== undefined) {
      const terms = loose.match(/[\p{L}\p{N}_-]+/gu) ?? []
      for (const term of terms) {
        if (FTS_RESERVED.has(term.toLowerCase())) {
          continue
        }
        parts.push(quoteFtsLiteral(term))
      }
    }
    match = token.exec(raw)
  }
  return parts.length === 0 ? undefined : parts.join(" AND ")
}

export const hostSearchText = (host: Host): string => {
  switch (host.kind) {
    case "symbol":
      return `symbol ${host.path} ${host.name}`
    case "file":
      return `file ${host.path}`
    case "folder":
      return `folder ${host.path}`
    case "repository":
      return "repository ."
    case "honorary_folder":
      return `honorary_folder ${host.path} ${host.file}`
  }
}

export const refsSearchText = (refs: readonly Ref[]): string =>
  refs
    .map((ref) => (ref.name === undefined ? `${ref.raw} ${ref.path}` : `${ref.raw} ${ref.path} ${ref.name}`))
    .join(" ")

export const examplesSearchText = (examples: readonly ExampleBlock[]): string =>
  examples.map((example) => `example ${example.lang}\n${example.body}`).join("\n\n")

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

export interface SearchResult {
  readonly query: string
  readonly fts_query: string
  readonly mode: Exclude<SearchMode, "semantic">
  readonly limit: number
  readonly indexed: number
  readonly index_path: string
  readonly source: SearchSource
  readonly capabilities: typeof SEARCH_CAPABILITIES
  readonly fusion?: {
    readonly stub: true
    readonly lexical: true
    readonly semantic: false
    readonly reason: string
  }
  readonly hits: readonly SearchHit[]
}

interface IndexQueryRow {
  readonly path: string
  readonly host_json: string
  readonly symbols_json: string
  readonly public: number
  readonly doc: string
  readonly bm25: number
  readonly doc_snippet: string
  readonly example_snippet: string
}

const pickSnippet = (row: IndexQueryRow): string => {
  const docSnippet = row.doc_snippet.trim()
  const exampleSnippet = row.example_snippet.trim()
  if (docSnippet.includes("[")) {
    return docSnippet
  }
  if (exampleSnippet.includes("[")) {
    return exampleSnippet
  }
  const fallback = row.doc.trim()
  return fallback.length <= 160 ? fallback : `${fallback.slice(0, 157)}…`
}

const parseHost = (json: string): Host => Schema.decodeUnknownSync(HostSchema)(JSON.parse(json) as unknown)

const parseSymbols = (json: string): readonly string[] =>
  Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(json) as unknown)

export const queryExtractIndex = (
  db: Database,
  args: {
    readonly query: string
    readonly mode: Exclude<SearchMode, "semantic">
    readonly limit: number
    readonly indexPath: string
    readonly source: SearchSource
  },
): SearchResult => {
  const ftsQuery = compileFtsQuery(args.query)
  if (ftsQuery === undefined) {
    throw new SearchQueryEmptyError({
      field: "query",
      message: "query has no searchable tokens",
      hint: "Pass words or a quoted phrase from extract prose, symbols, refs, or example bodies.",
    })
  }

  if (!indexIsReady(db)) {
    throw new SearchCorpusEmptyError({
      message: "no extract index is available",
      hint: "Pass tethers from extract, or write extract.json under the project cache, then retry.",
    })
  }

  const indexed = indexDocumentCount(db)
  const rows = db
    .query<IndexQueryRow, [string, number]>(
      `SELECT
         d.path,
         d.host_json,
         d.symbols_json,
         d.public,
         d.doc,
         bm25(extract_fts) AS bm25,
         snippet(extract_fts, 4, '[', ']', '…', 16) AS doc_snippet,
         snippet(extract_fts, 5, '[', ']', '…', 12) AS example_snippet
       FROM extract_fts
       JOIN extract_doc d ON d.id = extract_fts.rowid
       WHERE extract_fts MATCH ?
       ORDER BY bm25(extract_fts), d.id
       LIMIT ?`,
    )
    .all(ftsQuery, args.limit)

  const hits: SearchHit[] = rows.map((row) => {
    const bm25 = Number(row.bm25)
    return {
      path: row.path,
      host: parseHost(row.host_json),
      symbols: parseSymbols(row.symbols_json),
      public: row.public === 1,
      score: Number.isFinite(bm25) ? -bm25 : 0,
      bm25,
      snippet: pickSnippet(row),
    }
  })

  return {
    query: args.query,
    fts_query: ftsQuery,
    mode: args.mode,
    limit: args.limit,
    indexed,
    index_path: args.indexPath,
    source: args.source,
    capabilities: SEARCH_CAPABILITIES,
    ...(args.mode === "fusion"
      ? {
          fusion: {
            stub: true,
            lexical: true,
            semantic: false,
            reason: SEARCH_CAPABILITIES.fusion.reason,
          },
        }
      : {}),
    hits,
  }
}

export const runExtractSearch = (args: {
  readonly dbPath: string
  readonly query: string
  readonly mode: SearchMode
  readonly limit: number
  readonly source: SearchSource
  readonly tethers?: readonly SearchTether[]
}): SearchResult => {
  if (args.mode === "semantic") {
    throw new SearchModeUnavailableError({
      mode: "semantic",
      message: "semantic search requires local ONNX embeddings, which are not shipped",
      hint: "Use mode lexical or fusion. Fusion is a lexical-only stub until embeddings ship.",
    })
  }

  const db = openSearchDatabase(args.dbPath)
  try {
    if (args.tethers !== undefined) {
      rebuildExtractIndex(db, args.tethers)
    } else if (!indexIsReady(db)) {
      throw new SearchCorpusEmptyError({
        message: "no extract index is available",
        hint: "Pass tethers from extract, or write extract.json under the project cache, then retry.",
      })
    }

    return queryExtractIndex(db, {
      query: args.query,
      mode: args.mode,
      limit: args.limit,
      indexPath: args.dbPath,
      source: args.source,
    })
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
