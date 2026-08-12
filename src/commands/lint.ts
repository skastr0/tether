import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode } from "../core/output"
import { lintRepo } from "../facts/lint"

const LintInputSchema = Schema.Struct({
  root: Schema.String,
})

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

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
