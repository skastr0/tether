import { Args, Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { join, resolve } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { decodeJsonText, loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
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
  SearchModeUnavailableError,
  type SearchSource,
  type SearchTether,
  runExtractSearch,
  unwrapExtractCache,
} from "../search/index"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, or - for stdin"),
)

export const searchSchemaContract = {
  command_id: "search",
  command: "search",
  schema_id: "search.input/v1",
  description: "Lexical FTS5 search over extract. Fusion is a lexical-only stub.",
  schema: SearchInputSchema,
  accepts_batch: false,
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
  description: "SQLite FTS5 over extract. Semantic embeddings are not shipped; fusion is a stub.",
  schemas: [searchSchemaContract],
  examples: searchExamples,
} satisfies CommandCapability

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

export const executeSearch = (rawInput: string) =>
  Effect.gen(function* () {
    const input = yield* loadJsonInput(SearchInputSchema, rawInput)
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
    if (mode === "semantic") {
      return yield* new SearchModeUnavailableError({
        mode: "semantic",
        message: "semantic search requires local ONNX embeddings, which are not shipped",
        hint: "Use mode lexical or fusion. Fusion is a lexical-only stub until embeddings ship.",
      })
    }

    if (tethers === undefined && source === "index") {
      const exists = yield* fileSystem.exists(dbPath)
      if (!exists) {
        return yield* new SearchCorpusEmptyError({
          message: "no extract index is available",
          hint: "Pass tethers from extract, or write extract.json under the project cache, then retry.",
        })
      }
    }

    return yield* Effect.try({
      try: () =>
        runExtractSearch({
          dbPath,
          query: input.query,
          mode,
          limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
          source,
          ...(tethers === undefined ? {} : { tethers }),
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

export const searchCommand = Command.make("search", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("search", executeSearch(input)),
).pipe(
  Command.withDescription(
    "Search extract with SQLite FTS5. Semantic fusion is a lexical-only stub.",
  ),
)
