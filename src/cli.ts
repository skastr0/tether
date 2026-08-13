#!/usr/bin/env bun

import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"

import {
  capabilitiesCommand,
  examplesCommand,
  schemaCommand,
} from "./commands/discovery"
import { aggregateCommand } from "./commands/aggregate"
import { compileCommand } from "./commands/compile"
import { doctorCommand } from "./commands/doctor"
import { extractCommand } from "./commands/extract"
import { factsCommand } from "./commands/facts"
import { getCommand } from "./commands/get"
import { lintCommand } from "./commands/lint"
import { listCommand } from "./commands/list"
import { searchCommand } from "./commands/search"
import { CLI_NAME, CLI_VERSION } from "./core/constants"
import { writeCauseEnvelope, writeFailureEnvelope, setExitCode } from "./core/output"

export const rootCommand = Command.make(CLI_NAME).pipe(
  Command.withDescription("Collocated doctrine with structural git+AST facts"),
  Command.withSubcommands([
    capabilitiesCommand,
    compileCommand,
    doctorCommand,
    examplesCommand,
    extractCommand,
    factsCommand,
    getCommand,
    lintCommand,
    listCommand,
    schemaCommand,
    searchCommand,
    aggregateCommand,
  ]),
)

const cli = Command.run(rootCommand, {
  name: CLI_NAME,
  version: CLI_VERSION,
})

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.suspend(() => cli(args)).pipe(
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(undefined, error))),
    ),
    Effect.catchAllCause((cause) =>
      setExitCode(1).pipe(Effect.zipRight(writeCauseEnvelope(undefined, cause))),
    ),
    Effect.provide(BunContext.layer),
  )

runCli(Bun.argv).pipe(BunRuntime.runMain)
