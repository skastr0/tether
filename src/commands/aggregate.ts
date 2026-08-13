import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { FACT_KINDS, type Tether } from "../extract/types"
import { resolveRepoFacts } from "./facts"

export const GroupBySchema = Schema.Literal("host_kind", "folder", "fact_kind")

export type GroupBy = typeof GroupBySchema.Type

export const AggregateInputSchema = Schema.Struct({
  root: Schema.String,
  group_by: GroupBySchema,
})

export type AggregateInput = typeof AggregateInputSchema.Type

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const aggregateSchemaContract = {
  command_id: "aggregate",
  command: "aggregate",
  schema_id: "aggregate.input/v1",
  description: "Count tethers or facts grouped by host kind, folder, or fact kind.",
  schema: AggregateInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const aggregateExamples = [
  {
    command_id: "aggregate",
    command: "aggregate",
    name: "by host kind",
    description: "Count tethers by host kind.",
    args: ["aggregate", '{"root":".","group_by":"host_kind"}'],
    input: { root: ".", group_by: "host_kind" },
  },
  {
    command_id: "aggregate",
    command: "aggregate",
    name: "by fact kind",
    description: "Count facts by closed kind.",
    args: ["aggregate", '{"root":".","group_by":"fact_kind"}'],
    input: { root: ".", group_by: "fact_kind" },
  },
] satisfies readonly CommandExample[]

export const aggregateCapability = {
  command_id: "aggregate",
  command: "aggregate",
  category: "workflow",
  description: "Count tethers or facts grouped by host kind, folder, or fact kind.",
  schemas: [aggregateSchemaContract],
  examples: aggregateExamples,
} satisfies CommandCapability

export const folderKey = (tether: Tether): string => {
  const hostPath = tether.host.path
  if (tether.host.kind === "repository") {
    return "."
  }
  if (tether.host.kind === "folder" || tether.host.kind === "honorary_folder") {
    return hostPath.length === 0 ? "." : hostPath
  }
  const slash = hostPath.lastIndexOf("/")
  return slash === -1 ? "." : hostPath.slice(0, slash)
}

const countKeys = (
  keys: readonly string[],
  order?: readonly string[],
): ReadonlyArray<{ readonly key: string; readonly count: number }> => {
  const counts = new Map<string, number>()
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const rank = new Map((order ?? []).map((key, index) => [key, index]))
  return [...counts.entries()]
    .sort(([left], [right]) => {
      const leftRank = rank.get(left)
      const rightRank = rank.get(right)
      if (leftRank !== undefined && rightRank !== undefined) {
        return leftRank - rightRank
      }
      if (leftRank !== undefined) {
        return -1
      }
      if (rightRank !== undefined) {
        return 1
      }
      return left.localeCompare(right)
    })
    .map(([key, count]) => ({ key, count }))
}

const runAggregate = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(AggregateInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    const resolved = yield* resolveRepoFacts(root)
    const tethers = resolved.extracted.tethers

    const keys =
      body.group_by === "host_kind"
        ? tethers.map((tether) => tether.host.kind)
        : body.group_by === "folder"
          ? tethers.map(folderKey)
          : resolved.facts.map((fact) => fact.kind)

    const groups = countKeys(keys, body.group_by === "fact_kind" ? FACT_KINDS : undefined)
    const total = keys.length

    return {
      root: resolved.extracted.root,
      git_key: resolved.extracted.git_key,
      group_by: body.group_by,
      groups,
      total,
      ...(body.group_by === "fact_kind" ? { facts_source: resolved.facts_source } : {}),
    }
  })

export const aggregateCommand = Command.make(
  "aggregate",
  { input: jsonInputArg },
  ({ input }) => executeJsonCommand("aggregate", runAggregate(input)),
).pipe(Command.withDescription("Count tethers or facts grouped by host kind, folder, or fact kind"))
