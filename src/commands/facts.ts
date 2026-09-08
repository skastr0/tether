import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { analyzeRepo } from "../facts/lint"

export const FactsInputSchema = Schema.Struct({
  root: Schema.String,
})

export type FactsInput = typeof FactsInputSchema.Type

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const factsSchemaContract = {
  command_id: "facts",
  command: "facts",
  schema_id: "facts.input/v1",
  description: "Return the closed fact list for a repository.",
  schema: FactsInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const factsExamples = [
  {
    command_id: "facts",
    command: "facts",
    name: "repo root",
    description: "List recomputed facts for the current git repository.",
    args: ["facts", '{"root":"."}'],
    input: { root: "." },
  },
] satisfies readonly CommandExample[]

export const factsCapability = {
  command_id: "facts",
  command: "facts",
  category: "workflow",
  description: "Return the closed fact list for a repository.",
  schemas: [factsSchemaContract],
  examples: factsExamples,
} satisfies CommandCapability

const runFacts = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(FactsInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    const resolved = yield* analyzeRepo(root)
    return {
      root: resolved.root,
      git_key: resolved.git_key,
      facts: resolved.facts,
      facts_source: "lint",
      coverage: resolved.coverage,
      comparisons: resolved.comparisons,
    }
  })

export const factsCommand = Command.make("facts", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("facts", runFacts(input)),
).pipe(Command.withDescription("Return the closed fact list for a repository"))
