import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { extractRepo } from "../extract/walk"

const ExtractInputSchema = Schema.Struct({
  root: Schema.String,
})

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const runExtract = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(ExtractInputSchema, input)
    const root = body.root.trim()
    if (root.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "root",
          message: "root must not be empty",
        }),
      )
    }

    return yield* extractRepo(root)
  })

export const extractCommand = Command.make("extract", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("extract", runExtract(input)),
).pipe(Command.withDescription("Extract tethers from tracked git files"))
