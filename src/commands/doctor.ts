import { Args, Command } from "@effect/cli"
import { Effect, Option, Schema } from "effect"
import { LANGUAGE_VERSION, MIN_COMPATIBLE_VERSION } from "web-tree-sitter"

import { loadTetherConfig, loadWritableTetherConfig } from "../core/config"
import { CLI_NAME, CLI_VERSION, TETHER_HOME_ENV } from "../core/constants"
import { requireGitRepo } from "../core/git"
import { projectCacheDir } from "../core/home"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode, toErrorDetails } from "../core/output"
import { resolveRuntimeWasm } from "../extract/assets"
import { LANGUAGE_IDS, type LanguageId } from "../extract/languages"
import {
  ExtractParserError,
  initParser,
  loadLanguage,
  profileForLanguage,
  resolveGrammarWasm,
} from "../extract/parser"
import { FACT_KINDS } from "../extract/types"
import { commandExamples, commandSchemas, discoveryCapabilities } from "./discovery"

const DoctorInputSchema = Schema.Struct({
  root: Schema.optional(Schema.String),
})

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.optional,
  Args.withDescription("Optional JSON object, @file path, or - for stdin"),
)

interface DoctorCheck {
  readonly name: string
  readonly ok: boolean
  readonly details?: unknown
}

interface GrammarLanguageCheck {
  readonly id: LanguageId
  readonly ok: boolean
  readonly grammar: string
  readonly missing: boolean
  readonly path?: string
  readonly abi?: number
  readonly error?: ReturnType<typeof toErrorDetails>
}

const SCHEMA_COMMANDS = ["schema list", "schema show"] as const
const EXAMPLE_COMMANDS = ["examples list", "examples show"] as const

const asParserError = (cause: unknown) =>
  cause instanceof ExtractParserError
    ? cause
    : new ExtractParserError({
        message: cause instanceof Error ? cause.message : String(cause),
      })

const resolveRoot = (input: Option.Option<string>) =>
  Option.match(input, {
    onNone: () => Effect.succeed(process.cwd()),
    onSome: (raw) =>
      loadJsonInput(DoctorInputSchema, raw).pipe(
        Effect.map((body) => {
          const root = body.root?.trim()
          return root && root.length > 0 ? root : process.cwd()
        }),
      ),
  })

const inspectGit = (cwd: string) =>
  requireGitRepo(cwd).pipe(
    Effect.match({
      onFailure: (error) => ({
        name: "git.repository",
        ok: false,
        details: toErrorDetails(error),
      }),
      onSuccess: (repo) => ({
        name: "git.repository",
        ok: true,
        details: {
          root: repo.root,
          git_key: repo.gitKey,
          origin: repo.origin ?? null,
          project_dir: projectCacheDir(repo.gitKey),
        },
      }),
    }),
  )

const inspectHome = loadWritableTetherConfig().pipe(
  Effect.match({
    onFailure: (error) => ({
      name: "home.writable",
      ok: false,
      details: toErrorDetails(error),
    }),
    onSuccess: (writable) => ({
      name: "home.writable",
      ok: true,
      details: {
        env_var: TETHER_HOME_ENV,
        path: writable.home.tetherHome,
        projects_dir: writable.home.projectsDir,
      },
    }),
  }),
)

const inspectDiscovery = (): ReadonlyArray<DoctorCheck> => {
  const hasCommand = (command: string) =>
    discoveryCapabilities.some((capability) => capability.command === command)

  return [
    {
      name: "discovery.schema",
      ok: SCHEMA_COMMANDS.every(hasCommand),
      details: {
        schema_count: commandSchemas.length,
        commands: SCHEMA_COMMANDS,
      },
    },
    {
      name: "discovery.examples",
      ok: EXAMPLE_COMMANDS.every(hasCommand) && commandExamples.length > 0,
      details: {
        example_count: commandExamples.length,
        commands: EXAMPLE_COMMANDS,
      },
    },
  ]
}

const inspectGrammar = (id: LanguageId) =>
  Effect.tryPromise({
    try: async (): Promise<GrammarLanguageCheck> => {
      const grammar = profileForLanguage(id).grammar
      const path = resolveGrammarWasm(id)
      const language = await loadLanguage(id)
      return {
        id,
        ok: true,
        grammar,
        missing: false,
        path,
        abi: language.abiVersion,
      }
    },
    catch: asParserError,
  }).pipe(
    Effect.match({
      onFailure: (error): GrammarLanguageCheck => ({
        id,
        ok: false,
        grammar: profileForLanguage(id).grammar,
        missing: error.message.includes("grammar wasm not found"),
        error: toErrorDetails(error),
      }),
      onSuccess: (row) => row,
    }),
  )

const inspectRuntime = Effect.tryPromise({
  try: async () => {
    await initParser()
    return {
      ok: true as const,
      name: "web-tree-sitter",
      wasm: resolveRuntimeWasm(),
      abi: {
        min: MIN_COMPATIBLE_VERSION,
        max: LANGUAGE_VERSION,
      },
    }
  },
  catch: asParserError,
}).pipe(
  Effect.match({
    onFailure: (error) => ({
      ok: false as const,
      name: "web-tree-sitter",
      error: toErrorDetails(error),
    }),
    onSuccess: (row) => row,
  }),
)

const inspectGrammars = Effect.gen(function* () {
  const runtime = yield* inspectRuntime
  const languages = runtime.ok
    ? yield* Effect.forEach(LANGUAGE_IDS, inspectGrammar, { concurrency: "unbounded" })
    : LANGUAGE_IDS.map(
        (id): GrammarLanguageCheck => ({
          id,
          ok: false,
          grammar: profileForLanguage(id).grammar,
          missing: false,
        }),
      )
  const loadFailures = languages.filter((language) => !language.ok && !language.missing)

  return {
    name: "grammars.wasm",
    ok: runtime.ok && loadFailures.length === 0 && languages.some((language) => language.ok),
    details: {
      runtime,
      language_count: languages.length,
      loaded_count: languages.filter((language) => language.ok).length,
      missing_count: languages.filter((language) => language.missing).length,
      languages,
    },
  } satisfies DoctorCheck
})

const doctorReport = (cwd: string) =>
  Effect.gen(function* () {
    const config = yield* loadTetherConfig()
    const checks: ReadonlyArray<DoctorCheck> = [
      yield* inspectGit(cwd),
      yield* inspectGrammars,
      yield* inspectHome,
      ...inspectDiscovery(),
    ]
    const failed = checks.some((check) => !check.ok)

    if (failed) {
      yield* setExitCode(1)
    }

    return {
      cli: {
        name: CLI_NAME,
        version: CLI_VERSION,
      },
      runtime: {
        name: "bun",
        version: Bun.version,
      },
      status: failed ? "failed" : "ok",
      home: {
        env_var: TETHER_HOME_ENV,
        path: config.home.tetherHome,
      },
      languages: LANGUAGE_IDS,
      fact_kinds: FACT_KINDS,
      checks,
    }
  })

export const doctorCommand = Command.make("doctor", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "doctor",
    resolveRoot(input).pipe(Effect.flatMap(doctorReport)),
  ),
).pipe(Command.withDescription("Inspect git, wasm grammars, home directory, and discovery wiring"))
