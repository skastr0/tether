import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { DEFAULT_TETHER_HOME, TETHER_HOME_ENV } from "./constants"
import { HomeDirectoryError } from "./errors"

export interface TetherPaths {
  readonly homeDir: string
  readonly tetherHome: string
  readonly projectsDir: string
}

const expandHomePath = (value: string, homeDir: string) => {
  if (value === "~") {
    return homeDir
  }

  return value.startsWith("~/") ? join(homeDir, value.slice(2)) : value
}

const optionalEnv = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : undefined
}

export const resolveTetherPaths = (env: NodeJS.ProcessEnv = process.env): TetherPaths => {
  const homeDir = optionalEnv(env, "HOME") ?? homedir()
  const tetherHome = resolve(
    expandHomePath(optionalEnv(env, TETHER_HOME_ENV) ?? DEFAULT_TETHER_HOME, homeDir),
  )

  return {
    homeDir,
    tetherHome,
    projectsDir: join(tetherHome, "projects"),
  }
}

export const projectCacheDir = (gitKey: string, env: NodeJS.ProcessEnv = process.env) =>
  join(resolveTetherPaths(env).projectsDir, gitKey)

export const ensureTetherHome = (env: NodeJS.ProcessEnv = process.env) =>
  Effect.gen(function* () {
    const paths = resolveTetherPaths(env)
    const fileSystem = yield* FileSystem.FileSystem

    yield* fileSystem.makeDirectory(paths.tetherHome, { recursive: true }).pipe(
      Effect.mapError(
        (error) =>
          new HomeDirectoryError({
            path: paths.tetherHome,
            message: error.message,
          }),
      ),
    )

    const probe = join(paths.tetherHome, ".write-probe")
    yield* fileSystem.writeFileString(probe, "ok").pipe(
      Effect.mapError(
        (error) =>
          new HomeDirectoryError({
            path: paths.tetherHome,
            message: error.message,
          }),
      ),
    )
    yield* fileSystem.remove(probe).pipe(Effect.ignore)

    return paths
  })
