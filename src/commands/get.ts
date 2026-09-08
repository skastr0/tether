import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"
import { isAbsolute, relative, resolve, sep } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { normalizeRepoPath } from "../extract/resolve"
import type { Host, Tether } from "../extract/types"
import { observePath, SourceObservationError } from "../extract/observations"
import { analyzeRepo, type RepositoryAnalysis } from "../facts/lint"
import { evidenceFor, factsFor, groupTethers, layersFor } from "../compile/wiki"

export const GetInputSchema = Schema.Struct({
  root: Schema.String,
  path: Schema.String,
  symbol: Schema.optional(Schema.String),
  context: Schema.optional(Schema.Boolean),
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

export class ContextTargetError extends Schema.TaggedError<ContextTargetError>()(
  "ContextTargetError",
  { path: Schema.String, reason: Schema.String, message: Schema.String },
) {}

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const getSchemaContract = {
  command_id: "get",
  command: "get",
  schema_id: "get.input/v1",
  description: "Return exact tethers with live evidence; context=true returns separate applicable layers.",
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
  {
    command_id: "get",
    command: "get",
    name: "applicable context",
    description: "Return file, enclosing folder, and root doctrine separately with live structural evidence. No prose synthesis or approval.",
    args: ["get", '{"root":".","path":"src/host.ts","context":true}'],
    input: { root: ".", path: "src/host.ts", context: true },
  },
] satisfies readonly CommandExample[]

export const getCapability = {
  command_id: "get",
  command: "get",
  category: "workflow",
  description: getSchemaContract.description,
  schemas: [getSchemaContract],
  examples: getExamples,
} satisfies CommandCapability

export const toRepoPath = (repoRoot: string, path: string): string => {
  const rel = relative(repoRoot, resolve(repoRoot, path.trim().replace(/\\/g, "/")))
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CommandInputError({ field: "path", message: "path must be inside the repository" })
  }
  return rel === "" ? "." : normalizeRepoPath(rel)
}

export const tetherMatchesPath = (tether: Tether, path: string): boolean =>
  tether.path === path || tether.host.path === path

export const tetherMatchesSymbol = (tether: Tether, symbol: string): boolean =>
  (tether.host.kind === "symbol" && tether.host.name === symbol) || tether.symbols.includes(symbol)

const contextTarget = (analysis: RepositoryAnalysis, path: string, symbol?: string) => Effect.gen(function* () {
  const sidecar = analysis.tethers.find((tether) => tether.path === path && tether.host.kind !== "symbol")
  const targetPath = sidecar?.host.path ?? path
  const info = analysis.targets.find((target) => target.path === targetPath)
  const observed = info ?? (yield* Effect.tryPromise({ try: () => observePath(analysis.root, targetPath),
    catch: (cause) => new SourceObservationError({ path: targetPath, message: String(cause) }) }))
  if (observed.kind === "missing" && sidecar === undefined) {
    return yield* Effect.fail(new ContextTargetError({ path, reason: "target_missing", message: `context target does not exist: ${path}` }))
  }
  if (symbol !== undefined) {
    const count = info?.symbols?.filter((name) => name === symbol).length
    if (count !== 1) {
      const reason = count === undefined ? "symbol_unexamined" : count === 0 ? "symbol_missing" : "symbol_ambiguous"
      return yield* Effect.fail(new ContextTargetError({ path, reason, message: `${reason}: ${targetPath}#${symbol}; retrieve file context instead` }))
    }
    return { kind: "symbol", path: targetPath, name: symbol } satisfies Host
  }
  return sidecar?.host ?? (targetPath === "." ? { kind: "repository", path: "." }
    : { kind: observed.kind === "dir" ? "folder" : "file", path: targetPath }) satisfies Host
})

export const runGet = (input: string) =>
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

    const extracted = yield* analyzeRepo(root)
    const path = yield* Effect.try({ try: () => toRepoPath(extracted.root, rawPath),
      catch: (cause) => cause instanceof CommandInputError ? cause : new CommandInputError({ field: "path", message: String(cause) }) })
    if (body.context === true) {
      const target = yield* contextTarget(extracted, path, symbol)
      const layers = layersFor(target, groupTethers(extracted.tethers))
      const included = layers.flatMap((layer) => layer.tethers)
      return { root: extracted.root, git_key: extracted.git_key, path, target, layers,
        facts: factsFor(target, included, extracted.facts), ...evidenceFor(target, included, extracted) }
    }
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
      coverage: extracted.coverage,
      facts: extracted.facts.filter((fact) => matches.some((tether) => fact.path === tether.path)),
      comparisons: extracted.comparisons.filter((entry) => matches.some((tether) => entry.path === tether.path)),
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
).pipe(Command.withDescription(getSchemaContract.description))
