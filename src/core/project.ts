import { Effect } from "effect"

import { requireGitRepo, type GitRepo } from "./git"
import { ensureTetherHome, projectCacheDir, type TetherPaths } from "./home"

export interface ProjectContext {
  readonly repo: GitRepo
  readonly home: TetherPaths
  readonly projectDir: string
}

export const requireProject = (cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  Effect.gen(function* () {
    const repo = yield* requireGitRepo(cwd)
    const home = yield* ensureTetherHome(env)

    return {
      repo,
      home,
      projectDir: projectCacheDir(repo.gitKey, env),
    } satisfies ProjectContext
  })
