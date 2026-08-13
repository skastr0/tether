import { Args, Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { join, resolve } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { JsonInputError } from "../core/errors"
import { decodeJsonText, loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode, toErrorDetails } from "../core/output"
import { requireProject } from "../core/project"
import {
  DEFAULT_SEARCH_LIMIT,
  EXTRACT_CACHE_NAME,
  ExtractCacheSchema,
  isSearchError,
  SEARCH_DB_NAME,
  SearchCorpusEmptyError,
  SearchIndexError,
  SearchInputSchema,
  type SearchFilters,
  type SearchHitField,
  type SearchInput,
  type SearchSource,
  type SearchTether,
  runExtractSearch,
  unwrapExtractCache,
} from "../search/index"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, JSON array of queries, @file path, or - for stdin"),
)

export const searchSchemaContract = {
  command_id: "search",
  command: "search",
  schema_id: "search.input/v1",
  description:
    "Search extract with FTS5 and optional Synthetic embeddings. Accepts one query object or an array of queries.",
  schema: SearchInputSchema,
  accepts_batch: true,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const searchExamples = [
  {
    command_id: "search",
    command: "search",
    name: "query extract",
    description: "Search extract prose, symbols, refs, and example bodies.",
    args: ["search", '{"query":"auth refresh"}'],
    input: {
      query: "auth refresh",
    },
  },
] satisfies readonly CommandExample[]

export const searchCapability = {
  command_id: "search",
  command: "search",
  category: "workflow",
  description:
    "SQLite FTS5 over extract. Semantic/fusion use Synthetic embeddings when SYNTHETIC_API_KEY is set; otherwise fusion is a lexical stub.",
  schemas: [searchSchemaContract],
  examples: searchExamples,
  batch: {
    accepts_batch: true,
    default_concurrency: 1,
    supports_concurrency_option: false,
  },
} satisfies CommandCapability

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const loadCachedTethers = (fileSystem: FileSystem.FileSystem, cachePath: string) =>
  Effect.gen(function* () {
    const exists = yield* fileSystem.exists(cachePath)
    if (!exists) {
      return undefined
    }

    const contents = yield* fileSystem.readFileString(cachePath).pipe(
      Effect.mapError(
        (error) =>
          new SearchIndexError({
            message: error.message,
            hint: `Failed to read extract cache at ${cachePath}`,
          }),
      ),
    )

    const parsed = yield* decodeJsonText(ExtractCacheSchema, contents, cachePath).pipe(
      Effect.mapError(
        (error) =>
          new SearchIndexError({
            message: error.message,
            hint: `${EXTRACT_CACHE_NAME} must be a tether array or { tethers } from extract`,
          }),
      ),
    )

    return unwrapExtractCache(parsed)
  })

const decodeSearchInput = (value: unknown, source: string) =>
  Schema.decodeUnknown(SearchInputSchema)(value).pipe(
    Effect.mapError(
      (error) =>
        new JsonInputError({
          source,
          reason: "InvalidJson",
          message: error.message,
        }),
    ),
  )

const filtersFromInput = (input: SearchInput): SearchFilters | undefined => {
  const filters: SearchFilters = {
    ...(input.host_kind === undefined ? {} : { host_kind: input.host_kind }),
    ...(input.path_prefix === undefined ? {} : { path_prefix: input.path_prefix }),
    ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
    ...(input.public === undefined ? {} : { public: input.public }),
    ...(input.folder === undefined ? {} : { folder: input.folder }),
  }
  return Object.keys(filters).length === 0 ? undefined : filters
}

const executeSearchInput = (input: SearchInput) =>
  Effect.gen(function* () {
    const cwd = resolve(process.cwd(), input.root ?? ".")
    const project = yield* requireProject(cwd)
    const fileSystem = yield* FileSystem.FileSystem

    yield* fileSystem.makeDirectory(project.projectDir, { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new SearchIndexError({
            message: error.message,
            hint: "Project cache directory under TETHER_HOME could not be created",
          }),
      ),
    )

    const dbPath = join(project.projectDir, SEARCH_DB_NAME)
    let source: SearchSource = "index"
    let tethers: readonly SearchTether[] | undefined = input.tethers

    if (tethers !== undefined) {
      source = "tethers"
    } else {
      const cached = yield* loadCachedTethers(fileSystem, join(project.projectDir, EXTRACT_CACHE_NAME))
      if (cached !== undefined) {
        tethers = cached
        source = "extract_cache"
      }
    }

    const mode = input.mode ?? "fusion"
    const filters = filtersFromInput(input)
    const fields = input.fields as readonly SearchHitField[] | undefined

    if (tethers === undefined && source === "index") {
      const exists = yield* fileSystem.exists(dbPath)
      if (!exists) {
        return yield* new SearchCorpusEmptyError({
          message: "no extract index is available",
          hint: "Pass tethers from extract, or write extract.json under the project cache, then retry.",
        })
      }
    }

    return yield* Effect.tryPromise({
      try: () =>
        runExtractSearch({
          dbPath,
          query: input.query,
          mode,
          limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
          source,
          ...(tethers === undefined ? {} : { tethers }),
          ...(filters === undefined ? {} : { filters }),
          ...(fields === undefined ? {} : { fields }),
        }),
      catch: (cause) => {
        if (isSearchError(cause)) {
          return cause
        }
        return new SearchIndexError({
          message: cause instanceof Error ? cause.message : "search index failed",
        })
      },
    })
  })

const executeSearch = (rawInput: string) =>
  Effect.gen(function* () {
    const raw = yield* loadJsonInput(Schema.Unknown, rawInput)

    if (Array.isArray(raw)) {
      const results = yield* Effect.forEach(
        raw,
        (item, index) =>
          decodeSearchInput(item, `input[${index}]`).pipe(
            Effect.flatMap(executeSearchInput),
            Effect.map((data) => ({ index, ok: true as const, data })),
            Effect.catchAll((error) =>
              Effect.succeed({
                index,
                ok: false as const,
                error: toErrorDetails(error),
              }),
            ),
          ),
        { concurrency: 1 },
      )
      const errorCount = results.filter((result) => !result.ok).length
      if (errorCount > 0) {
        yield* setExitCode(1)
      }
      return {
        outcome: errorCount === 0 ? "succeeded" : errorCount === results.length ? "failed" : "partial_failure",
        total: results.length,
        success_count: results.length - errorCount,
        error_count: errorCount,
        results,
      }
    }

    if (!isRecord(raw)) {
      return yield* new JsonInputError({
        source: "input",
        reason: "InvalidShape",
        message: "search input must be a JSON object or array of objects",
      })
    }

    const input = yield* decodeSearchInput(raw, "inline")
    return yield* executeSearchInput(input)
  })

export const searchCommand = Command.make("search", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("search", executeSearch(input)),
).pipe(
  Command.withDescription(
    "Search extract with SQLite FTS5. Fusion merges FTS with Synthetic kNN when SYNTHETIC_API_KEY is set.",
  ),
)
