import { Effect } from "effect"

import { extractTracked } from "../../src/extract/walk"
import type { Fact, FactKind, Tether } from "../../src/extract/types"
import { lintRepo } from "../../src/facts/lint"
import { withTempDir } from "../helpers/cli"
import { commitAll, initGitRepo } from "../helpers/git-repo"

export const batteryRepo = async (
  prefix: string,
  files: Record<string, string>,
  use: (root: string) => Promise<void>,
) => {
  await withTempDir(prefix, async (root) => {
    await initGitRepo(root, files)
    await use(root)
  })
}

export const extractFiles = (root: string, files: readonly string[]) => extractTracked(root, files)

export const lintRoot = (root: string) => Effect.runPromise(lintRepo(root))

export const factsOf = (facts: readonly Fact[], kind: FactKind) =>
  facts.filter((fact) => fact.kind === kind)

export const tethersNamed = (tethers: readonly Tether[], name: string) =>
  tethers.filter((tether) => tether.symbols.includes(name) || (tether.host.kind === "symbol" && tether.host.name === name))
