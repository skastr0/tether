import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import type { Fact } from "../extract/types"
import { extractRepo, type ExtractData } from "../extract/walk"
import * as lintFacts from "../facts/lint"

export const FactsInputSchema = Schema.Struct({
  root: Schema.String,
})

export type FactsInput = typeof FactsInputSchema.Type

export type FactsSource = "lint" | "extract"

export interface ResolvedFacts {
  readonly extracted: ExtractData
  readonly facts: readonly Fact[]
  readonly facts_source: FactsSource
}

type CollectFacts = (
  extracted: ExtractData,
  config: unknown,
) => Effect.Effect<readonly Fact[], unknown>

type LoadTetherJson = (repoRoot: string) => Effect.Effect<unknown, unknown>

// Prefer lint collectFacts when that module exports it; otherwise parse-time extract facts.
const maybeCollectFacts = (lintFacts as { collectFacts?: CollectFacts }).collectFacts
const maybeLoadTetherJson = (lintFacts as { loadTetherJson?: LoadTetherJson }).loadTetherJson

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

export const resolveRepoFacts = (root: string) =>
  Effect.gen(function* () {
    const extracted = yield* extractRepo(root)
    if (maybeCollectFacts !== undefined && maybeLoadTetherJson !== undefined) {
      const config = yield* maybeLoadTetherJson(extracted.root)
      const facts = yield* maybeCollectFacts(extracted, config)
      return {
        extracted,
        facts,
        facts_source: "lint",
      } satisfies ResolvedFacts
    }

    return {
      extracted,
      facts: extracted.facts,
      facts_source: "extract",
    } satisfies ResolvedFacts
  })

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

    const resolved = yield* resolveRepoFacts(root)
    return {
      root: resolved.extracted.root,
      git_key: resolved.extracted.git_key,
      facts: resolved.facts,
      facts_source: resolved.facts_source,
    }
  })

export const factsCommand = Command.make("facts", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("facts", runFacts(input)),
).pipe(Command.withDescription("Return the closed fact list for a repository"))
