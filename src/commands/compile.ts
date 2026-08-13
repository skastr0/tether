import { Args, Command } from "@effect/cli"
import { FileSystem } from "@effect/platform"
import { Effect, Schema } from "effect"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { CommandInputError, HomeDirectoryError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { requireProject } from "../core/project"
import { findPublicSpan, hashPublicSurface } from "../compile/public-span"
import {
  compileWiki,
  PUBLIC_DIR,
  PUBLIC_NAV,
  replacePublicRegion,
  WIKI_DIR,
  type RenderedPage,
} from "../compile/wiki"
import { extractRepo } from "../extract/walk"

export const CompileInputSchema = Schema.Struct({
  root: Schema.String,
  check: Schema.optional(Schema.Boolean),
})

export type CompileInput = typeof CompileInputSchema.Type

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const compileSchemaContract = {
  command_id: "compile",
  command: "compile",
  schema_id: "compile.input/v1",
  description: "Write derived wiki and public trees under the project cache dir. check=true hashes without writing.",
  schema: CompileInputSchema,
  accepts_batch: false,
  input_modes: ["inline-json", "@file", "stdin"],
} satisfies CommandSchemaContract

export const compileExamples = [
  {
    command_id: "compile",
    command: "compile",
    name: "repo root",
    description: "Compile every tether in the current git repository into the project cache.",
    args: ["compile", '{"root":"."}'],
    input: { root: "." },
  },
  {
    command_id: "compile",
    command: "compile",
    name: "check public surface",
    description: "Compare the README whole-line span to the would-be region without writing.",
    args: ["compile", '{"root":".","check":true}'],
    input: { root: ".", check: true },
  },
] satisfies readonly CommandExample[]

export const compileCapability = {
  command_id: "compile",
  command: "compile",
  category: "workflow",
  description: "Write a mirrored wiki and public tree under the project cache.",
  schemas: [compileSchemaContract],
  examples: compileExamples,
} satisfies CommandCapability

const isPathInside = (parent: string, child: string): boolean => {
  const from = resolve(parent)
  const to = resolve(child)
  const rel = relative(from, to)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const mapFsError = (path: string) => (error: { readonly message: string }) =>
  new HomeDirectoryError({
    path,
    message: error.message,
  })

const writePages = (base: string, pages: readonly RenderedPage[], extra: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.remove(base, { recursive: true }).pipe(Effect.ignore)
    yield* fileSystem.makeDirectory(base, { recursive: true }).pipe(Effect.mapError(mapFsError(base)))

    const files: Array<readonly [string, string]> = pages.map((page) => [page.relPath, page.markdown])
    files.push(...extra)

    yield* Effect.forEach(
      files,
      ([relPath, content]) =>
        Effect.gen(function* () {
          const abs = join(base, relPath)
          yield* fileSystem.makeDirectory(dirname(abs), { recursive: true }).pipe(Effect.mapError(mapFsError(abs)))
          yield* fileSystem.writeFileString(abs, content).pipe(Effect.mapError(mapFsError(abs)))
        }),
      { concurrency: 8 },
    )
  })

const readReadme = (repoRoot: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = join(repoRoot, "README.md")
    if (!(yield* fileSystem.exists(path))) {
      return undefined
    }

    return yield* fileSystem.readFileString(path).pipe(
      Effect.mapError(
        (error) =>
          new CommandInputError({
            field: "readme",
            message: error.message,
          }),
      ),
    )
  })

const updateReadme = (repoRoot: string, region: string) =>
  Effect.gen(function* () {
    const current = yield* readReadme(repoRoot)
    if (current === undefined) {
      return false
    }

    const next = replacePublicRegion(current, region)
    if (next === undefined || next === current) {
      return false
    }

    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.writeFileString(join(repoRoot, "README.md"), next).pipe(
      Effect.mapError(
        (error) =>
          new CommandInputError({
            field: "readme",
            message: error.message,
          }),
      ),
    )
    return true
  })

export const runCompile = (input: string) =>
  Effect.gen(function* () {
    const body = yield* loadJsonInput(CompileInputSchema, input)
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
    if (isPathInside(project.repo.root, project.projectDir)) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "project_dir",
          message: "project cache dir must not be inside the repository",
        }),
      )
    }

    const extracted = yield* extractRepo(project.repo.root)
    const compiled = compileWiki(extracted)
    const wikiDir = join(project.projectDir, WIKI_DIR)
    const publicDir = join(project.projectDir, PUBLIC_DIR)
    const publicCount = extracted.tethers.filter((tether) => tether.public).length
    const base = {
      root: project.repo.root,
      git_key: project.repo.gitKey,
      project_dir: project.projectDir,
      wiki_dir: wikiDir,
      public_dir: publicDir,
      wiki_pages: compiled.pages.map((page) => page.relPath),
      public_pages: compiled.publicPages.map((page) => page.relPath),
      tether_count: extracted.tethers.length,
      public_count: publicCount,
    }

    if (body.check === true) {
      const readme = yield* readReadme(project.repo.root)
      const span = readme === undefined ? undefined : findPublicSpan(readme)
      const surface = hashPublicSurface({
        region: compiled.readmeRegion,
        publicPages: compiled.publicPages,
      })
      const existingRegionHash =
        span === undefined ? undefined : hashPublicSurface({ region: span.inner, publicPages: [] }).region

      return {
        ...base,
        readme_updated: false,
        check: true,
        readme_fresh: existingRegionHash === surface.region,
        region_hash: surface.region,
        ...(surface.publicTree === undefined ? {} : { public_hash: surface.publicTree }),
      }
    }

    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem
      .makeDirectory(project.projectDir, { recursive: true })
      .pipe(Effect.mapError(mapFsError(project.projectDir)))
    yield* writePages(wikiDir, compiled.pages, [])
    yield* writePages(publicDir, compiled.publicPages, [[PUBLIC_NAV, compiled.publicNav]])
    const readmeUpdated = yield* updateReadme(project.repo.root, compiled.readmeRegion)

    return {
      ...base,
      readme_updated: readmeUpdated,
    }
  })

export const compileCommand = Command.make("compile", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand("compile", runCompile(input)),
).pipe(Command.withDescription("Write derived wiki and public trees under the project cache"))
