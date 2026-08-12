import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode } from "../core/output"
import { lintRepo } from "../facts/lint"

export const LintInputSchema = Schema.Struct({
  root: Schema.String,
})

export type LintInput = typeof LintInputSchema.Type

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const lintSchemaContract = {
  command_id: "lint",
  command: "lint",
  schema_id: "lint.input/v1",
  description: "Emit closed fact kinds. Exit 1 when a fail_on kind is present.",
  schema: LintInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const lintExamples = [
  {
    command_id: "lint",
    command: "lint",
    name: "repo root",
    description: "Emit closed facts for the current git repository.",
    args: ["lint", '{"root":"."}'],
    input: { root: "." },
  },
  {
    command_id: "lint",
    command: "lint",
    name: "file input",
    description: "Lint from a JSON file payload.",
    args: ["lint", "@payload.json"],
    input: { root: "." },
  },
] satisfies readonly CommandExample[]

export const lintCapability = {
  command_id: "lint",
  command: "lint",
  category: "workflow",
  description: "Emit closed fact kinds. Exit 1 when a fail_on kind is present.",
  schemas: [lintSchemaContract],
  examples: lintExamples,
} satisfies CommandCapability

const runLint = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(LintInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    const report = yield* lintRepo(root)
    if (report.failed) {
      yield* setExitCode(1)
    }

    return {
      root: report.root,
      facts: report.facts,
      fail_on: report.fail_on,
      failed: report.failed,
    }
  })

export const lintCommand = Command.make("lint", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("lint", runLint(input)),
).pipe(Command.withDescription("Emit closed fact kinds. Exit 1 when a fail_on kind is present."))
