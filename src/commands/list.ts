import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import type { Host, Tether } from "../extract/types"
import { extractRepo } from "../extract/walk"
import { tetherMatchesSymbol, toRepoPath } from "./get"

export const HostKindSchema = Schema.Literal(
  "symbol",
  "file",
  "folder",
  "repository",
  "honorary_folder",
)

export type HostKind = typeof HostKindSchema.Type

export const ListInputSchema = Schema.Struct({
  root: Schema.String,
  path_prefix: Schema.optional(Schema.String),
  host_kind: Schema.optional(HostKindSchema),
  symbol: Schema.optional(Schema.String),
  public: Schema.optional(Schema.Boolean),
})

export type ListInput = typeof ListInputSchema.Type

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const listSchemaContract = {
  command_id: "list",
  command: "list",
  schema_id: "list.input/v1",
  description: "List tethers filtered by path prefix, host kind, symbol, or public.",
  schema: ListInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const listExamples = [
  {
    command_id: "list",
    command: "list",
    name: "repo root",
    description: "List every extracted tether.",
    args: ["list", '{"root":"."}'],
    input: { root: "." },
  },
  {
    command_id: "list",
    command: "list",
    name: "public under src",
    description: "List public tethers under a path prefix.",
    args: ["list", '{"root":".","path_prefix":"src","public":true}'],
    input: { root: ".", path_prefix: "src", public: true },
  },
] satisfies readonly CommandExample[]

export const listCapability = {
  command_id: "list",
  command: "list",
  category: "workflow",
  description: "List tethers filtered by path prefix, host kind, symbol, or public.",
  schemas: [listSchemaContract],
  examples: listExamples,
} satisfies CommandCapability

const toListed = (tether: Tether) => ({
  path: tether.path,
  host: tether.host,
  symbols: tether.symbols,
  refs: tether.refs,
  public: tether.public,
  doc: tether.doc,
})

const matchesPrefix = (tether: Tether, prefix: string): boolean => {
  if (prefix === ".") {
    return true
  }

  const hit = (value: string): boolean => value === prefix || value.startsWith(`${prefix}/`)
  return hit(tether.path) || hit(tether.host.path)
}

export const matchesListFilters = (
  tether: Tether,
  filters: {
    readonly path_prefix?: string
    readonly host_kind?: Host["kind"]
    readonly symbol?: string
    readonly public?: boolean
  },
): boolean => {
  if (filters.path_prefix !== undefined && !matchesPrefix(tether, filters.path_prefix)) {
    return false
  }
  if (filters.host_kind !== undefined && tether.host.kind !== filters.host_kind) {
    return false
  }
  if (filters.symbol !== undefined && !tetherMatchesSymbol(tether, filters.symbol)) {
    return false
  }
  if (filters.public !== undefined && tether.public !== filters.public) {
    return false
  }
  return true
}

const runList = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(ListInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    const extracted = yield* extractRepo(root)

    const rawPrefix = body.path_prefix?.trim()
    const path_prefix =
      rawPrefix !== undefined && rawPrefix.length > 0
        ? toRepoPath(extracted.root, rawPrefix.replace(/\/+$/, ""))
        : undefined
    const rawSymbol = body.symbol?.trim()
    const symbol = rawSymbol !== undefined && rawSymbol.length > 0 ? rawSymbol : undefined

    const tethers = extracted.tethers
      .filter((tether) =>
        matchesListFilters(tether, {
          ...(path_prefix === undefined ? {} : { path_prefix }),
          ...(body.host_kind === undefined ? {} : { host_kind: body.host_kind }),
          ...(symbol === undefined ? {} : { symbol }),
          ...(body.public === undefined ? {} : { public: body.public }),
        }),
      )
      .map(toListed)

    return {
      root: extracted.root,
      git_key: extracted.git_key,
      tethers,
    }
  })

export const listCommand = Command.make("list", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("list", runList(input)),
).pipe(Command.withDescription("List tethers filtered by path prefix, host kind, symbol, or public"))
