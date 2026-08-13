import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"
import { isAbsolute, relative } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { normalizeRepoPath } from "../extract/resolve"
import type { Tether } from "../extract/types"
import { extractRepo } from "../extract/walk"

export const GetInputSchema = Schema.Struct({
  root: Schema.String,
  path: Schema.String,
  symbol: Schema.optional(Schema.String),
})

export type GetInput = typeof GetInputSchema.Type

export class TetherNotFoundError extends Schema.TaggedError<TetherNotFoundError>()(
  "TetherNotFoundError",
  {
    path: Schema.String,
    symbol: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const getSchemaContract = {
  command_id: "get",
  command: "get",
  schema_id: "get.input/v1",
  description: "Return one tether by path, or every tether on that file.",
  schema: GetInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const getExamples = [
  {
    command_id: "get",
    command: "get",
    name: "by path",
    description: "Get tethers bound to a host or sidecar path.",
    args: ["get", '{"root":".","path":"src/host.ts"}'],
    input: { root: ".", path: "src/host.ts" },
  },
  {
    command_id: "get",
    command: "get",
    name: "by symbol",
    description: "Get one tether on a file by symbol name.",
    args: ["get", '{"root":".","path":"src/host.ts","symbol":"greet"}'],
    input: { root: ".", path: "src/host.ts", symbol: "greet" },
  },
] satisfies readonly CommandExample[]

export const getCapability = {
  command_id: "get",
  command: "get",
  category: "workflow",
  description: "Return one tether by path, or every tether on that file.",
  schemas: [getSchemaContract],
  examples: getExamples,
} satisfies CommandCapability

export const toRepoPath = (repoRoot: string, path: string): string => {
  const trimmed = path.trim()
  if (trimmed === "." || trimmed === "./") {
    return "."
  }

  if (isAbsolute(trimmed)) {
    const rel = relative(repoRoot, trimmed)
    if (rel === "") {
      return "."
    }
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return normalizeRepoPath(rel)
    }
  }

  return normalizeRepoPath(trimmed)
}

export const tetherMatchesPath = (tether: Tether, path: string): boolean =>
  tether.path === path || tether.host.path === path

export const tetherMatchesSymbol = (tether: Tether, symbol: string): boolean =>
  (tether.host.kind === "symbol" && tether.host.name === symbol) || tether.symbols.includes(symbol)

const runGet = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(GetInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    const rawPath = body.path.trim()
    if (rawPath.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "path",
          message: "path must not be empty",
        }),
      )
    }

    const rawSymbol = body.symbol?.trim()
    if (body.symbol !== undefined && (rawSymbol === undefined || rawSymbol.length === 0)) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "symbol",
          message: "symbol must not be empty",
        }),
      )
    }
    const symbol = rawSymbol !== undefined && rawSymbol.length > 0 ? rawSymbol : undefined

    const extracted = yield* extractRepo(root)
    const path = toRepoPath(extracted.root, rawPath)
    const matches = extracted.tethers.filter((tether) => {
      if (!tetherMatchesPath(tether, path)) {
        return false
      }
      return symbol === undefined || tetherMatchesSymbol(tether, symbol)
    })

    if (matches.length === 0) {
      return yield* Effect.fail(
        new TetherNotFoundError({
          path,
          message:
            symbol === undefined ? `no tether at ${path}` : `no tether at ${path}#${symbol}`,
          ...(symbol === undefined ? {} : { symbol }),
        }),
      )
    }

    const base = {
      root: extracted.root,
      git_key: extracted.git_key,
      path,
      ...(symbol === undefined ? {} : { symbol }),
    }

    if (matches.length === 1) {
      return {
        ...base,
        tether: matches[0],
      }
    }

    return {
      ...base,
      tethers: matches,
    }
  })

export const getCommand = Command.make("get", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("get", runGet(input)),
).pipe(Command.withDescription("Return one tether by path, or every tether on that file"))
