import { Effect } from "effect"

import {
  DEFAULT_MARKDOWN_ALLOWLIST,
  HONORARY_MARKDOWN,
  TETHER_HOME_ENV,
} from "./constants"
import { ensureTetherHome, resolveTetherPaths, type TetherPaths } from "./home"

export interface TetherConfig {
  readonly home: TetherPaths
  readonly allowlist: readonly string[]
  readonly honorary: readonly string[]
  readonly homeEnv: string
}

export const loadTetherConfig = (env: NodeJS.ProcessEnv = process.env) =>
  Effect.succeed({
    home: resolveTetherPaths(env),
    allowlist: DEFAULT_MARKDOWN_ALLOWLIST,
    honorary: HONORARY_MARKDOWN,
    homeEnv: TETHER_HOME_ENV,
  } satisfies TetherConfig)

export const loadWritableTetherConfig = (env: NodeJS.ProcessEnv = process.env) =>
  Effect.gen(function* () {
    const home = yield* ensureTetherHome(env)
    return {
      home,
      allowlist: DEFAULT_MARKDOWN_ALLOWLIST,
      honorary: HONORARY_MARKDOWN,
      homeEnv: TETHER_HOME_ENV,
    } satisfies TetherConfig
  })
