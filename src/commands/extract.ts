import { Args, Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { join } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError, HomeDirectoryError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { requireProject } from "../core/project"
import { extractRepo, type ExtractData } from "../extract/walk"

export const ExtractInputSchema = Schema.Struct({
  root: Schema.String,
})

export type ExtractInput = typeof ExtractInputSchema.Type

const EXTRACT_CACHE_NAME = "extract.json"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const extractSchemaContract = {
  command_id: "extract",
  command: "extract",
  schema_id: "extract.input/v1",
  description: "Extract tethers from tracked git files.",
  schema: ExtractInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const extractExamples = [
  {
    command_id: "extract",
    command: "extract",
    name: "repo root",
    description: "Extract tethers from tracked files in the current git repository.",
    args: ["extract", '{"root":"."}'],
    input: { root: "." },
  },
  {
    command_id: "extract",
    command: "extract",
    name: "file input",
    description: "Extract from a JSON file payload.",
    args: ["extract", "@payload.json"],
    input: { root: "." },
  },
] satisfies readonly CommandExample[]

export const extractCapability = {
  command_id: "extract",
  command: "extract",
  category: "workflow",
  description: "Extract tethers from tracked git files.",
  schemas: [extractSchemaContract],
  examples: extractExamples,
} satisfies CommandCapability

const mapFsError = (path: string) => (error: { readonly message: string }) =>
  new HomeDirectoryError({
    path,
    message: error.message,
  })

const persistExtractCache = (projectDir: string, extracted: ExtractData) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem
      .makeDirectory(projectDir, { recursive: true })
      .pipe(Effect.mapError(mapFsError(projectDir)))

    const cachePath = join(projectDir, EXTRACT_CACHE_NAME)
    yield* fileSystem
      .writeFileString(cachePath, `${JSON.stringify(extracted, null, 2)}\n`)
      .pipe(Effect.mapError(mapFsError(cachePath)))
  })

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

    const project = yield* requireProject(root)
    const extracted = yield* extractRepo(root)
    yield* persistExtractCache(project.projectDir, extracted)
    return extracted
  })

export const extractCommand = Command.make("extract", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("extract", runExtract(input)),
).pipe(Command.withDescription("Extract tethers from tracked git files"))
