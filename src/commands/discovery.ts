import { Args, Command } from "@effect/cli"
import { Effect } from "effect"

import { loadTetherConfig, loadWritableTetherConfig } from "../core/config"
import {
  CLI_NAME,
  CLI_VERSION,
  PROTOCOL_VERSION,
  TETHER_HOME_ENV,
} from "../core/constants"
import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { renderSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { requireGitRepo } from "../core/git"
import { projectCacheDir } from "../core/home"
import { executeJsonCommand, setExitCode, toErrorDetails } from "../core/output"
import { LANGUAGE_IDS } from "../extract/languages/index"
import { FACT_KINDS } from "../extract/types"

const discoveryCapabilities: ReadonlyArray<CommandCapability> = [
  {
    command_id: "doctor",
    command: "doctor",
    category: "diagnostic",
    description: "Inspect git, home directory, and discovery wiring.",
  },
  {
    command_id: "capabilities",
    command: "capabilities",
    category: "discovery",
    description: "Describe supported protocol conventions and commands.",
  },
  {
    command_id: "schema.list",
    command: "schema list",
    category: "discovery",
    description: "List JSON input schemas exposed by commands.",
  },
  {
    command_id: "schema.show",
    command: "schema show",
    category: "discovery",
    description: "Show one JSON input schema by schema id, command id, or command name.",
  },
  {
    command_id: "examples.list",
    command: "examples list",
    category: "discovery",
    description: "List executable command examples.",
  },
  {
    command_id: "examples.show",
    command: "examples show",
    category: "discovery",
    description: "Show examples for one command by command id or command name.",
  },
]

const commandCapabilities: ReadonlyArray<CommandCapability> = [...discoveryCapabilities]

const commandSchemas: ReadonlyArray<CommandSchemaContract> = commandCapabilities.flatMap(
  (capability) => capability.schemas ?? [],
)

const commandExamples: ReadonlyArray<CommandExample> = [
  {
    command_id: "doctor",
    command: "doctor",
    name: "health",
    description: "Inspect git, TETHER_HOME, and discovery wiring.",
    args: ["doctor"],
  },
  {
    command_id: "capabilities",
    command: "capabilities",
    name: "protocol",
    description: "Describe JSON-first protocol conventions.",
    args: ["capabilities"],
  },
]

const targetArg = Args.text({ name: "target" }).pipe(
  Args.withDescription("Schema id, command id, or command name"),
)

const matchesTarget = (
  target: string,
  entry: { readonly command_id: string; readonly command: string; readonly schema_id?: string },
) => {
  const normalized = target.trim()

  return (
    entry.command_id === normalized ||
    entry.command === normalized ||
    entry.schema_id === normalized
  )
}

const compactExample = (example: CommandExample) => ({
  command_id: example.command_id,
  command: example.command,
  name: example.name,
  ...(example.description ? { description: example.description } : {}),
})

const renderExample = (example: CommandExample) => ({
  name: example.name,
  ...(example.description ? { description: example.description } : {}),
  ...(example.args ? { args: example.args } : {}),
  ...(example.input !== undefined ? { input: example.input } : {}),
})

const renderCapability = (capability: CommandCapability) => ({
  command_id: capability.command_id,
  command: capability.command,
  category: capability.category,
  description: capability.description,
  ...(capability.schemas
    ? {
        schemas: capability.schemas.map((schema) => ({
          schema_id: schema.schema_id,
          description: schema.description,
          accepts_batch: schema.accepts_batch ?? false,
        })),
      }
    : {}),
  ...(capability.examples
    ? {
        examples: capability.examples.map((example) => ({
          name: example.name,
          ...(example.description ? { description: example.description } : {}),
        })),
      }
    : {}),
  ...(capability.batch ? { batch: capability.batch } : {}),
})

interface DoctorCheck {
  readonly name: string
  readonly ok: boolean
  readonly details?: unknown
}

const doctorReport = Effect.gen(function* () {
  const cwd = process.cwd()
  const config = yield* loadTetherConfig()
  const gitCheck = yield* requireGitRepo(cwd).pipe(
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
  const homeCheck = yield* loadWritableTetherConfig().pipe(
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
  const schemaCheck = {
    name: "discovery.schema",
    ok: true,
    details: {
      schema_count: commandSchemas.length,
    },
  } satisfies DoctorCheck
  const examplesCheck = {
    name: "discovery.examples",
    ok: commandExamples.length > 0,
    details: {
      example_count: commandExamples.length,
    },
  } satisfies DoctorCheck
  const checks: ReadonlyArray<DoctorCheck> = [gitCheck, homeCheck, schemaCheck, examplesCheck]
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

const capabilities = Effect.succeed({
  cli: {
    name: CLI_NAME,
    version: CLI_VERSION,
  },
  protocol_version: PROTOCOL_VERSION,
  input_modes: ["inline-json", "@file", "stdin"],
  output: {
    success: { stream: "stdout", envelope: "{ ok: true, command, data }" },
    failure: { stream: "stderr", envelope: "{ ok: false, command, error }" },
  },
  git: {
    required: true,
    policy: "Extraction and facts are functions of the tree plus history. There is no second ledger.",
  },
  state: {
    policy:
      "No repo-local .tether/ cache. Project state is $TETHER_HOME or ~/.config/tether/projects/<git-key>/.",
    env_var: TETHER_HOME_ENV,
    default_home: "~/.config/tether",
  },
  discovery: {
    commands: discoveryCapabilities.map((capability) => capability.command),
  },
  languages: LANGUAGE_IDS,
  fact_kinds: FACT_KINDS,
  commands: commandCapabilities.map(renderCapability),
})

const listSchemas = Effect.succeed({
  schemas: commandSchemas.map((schema) => ({
    command_id: schema.command_id,
    command: schema.command,
    schema_id: schema.schema_id,
    description: schema.description,
  })),
})

const showSchema = (target: string) =>
  Effect.gen(function* () {
    const schema = commandSchemas.find((entry) => matchesTarget(target, entry))

    if (!schema) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "target",
          message: `No schema found for ${target}`,
        }),
      )
    }

    return renderSchemaContract(schema)
  })

const listExamples = Effect.succeed({
  examples: commandExamples.map(compactExample),
})

const showExamples = (target: string) =>
  Effect.gen(function* () {
    const examples = commandExamples.filter((entry) => matchesTarget(target, entry))
    const first = examples[0]

    if (!first) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "target",
          message: `No examples found for ${target}`,
        }),
      )
    }

    return {
      command_id: first.command_id,
      command: first.command,
      examples: examples.map(renderExample),
    }
  })

export const doctorCommand = Command.make("doctor", {}, () =>
  executeJsonCommand("doctor", doctorReport),
).pipe(Command.withDescription("Inspect git, home directory, and discovery wiring"))

export const capabilitiesCommand = Command.make("capabilities", {}, () =>
  executeJsonCommand("capabilities", capabilities),
).pipe(Command.withDescription("Describe supported protocol conventions and commands"))

const schemaListCommand = Command.make("list", {}, () =>
  executeJsonCommand("schema list", listSchemas),
).pipe(Command.withDescription("List JSON input schemas exposed by commands"))

const schemaShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  executeJsonCommand("schema show", showSchema(target)),
).pipe(Command.withDescription("Show one JSON input schema"))

export const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
)

const examplesListCommand = Command.make("list", {}, () =>
  executeJsonCommand("examples list", listExamples),
).pipe(Command.withDescription("List executable command examples"))

const examplesShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  executeJsonCommand("examples show", showExamples(target)),
).pipe(Command.withDescription("Show examples for one command"))

export const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Example discovery commands"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
)
