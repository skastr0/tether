import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { Node } from "web-tree-sitter"

import { HONORARY_MARKDOWN } from "../core/constants"
import { GitCommandError, GitNotFoundError } from "../core/errors"
import { requireGitRepo } from "../core/git"
import { collectAdjacentBinds, declarationName } from "./adjacency"
import {
  ExtractParserError,
  initParser,
  languageForPath,
  loadLanguage,
  parseSource,
  profileForLanguage,
} from "./parser"
import type { LanguageId, LanguageProfile } from "./languages"
import {
  emitInlineTether,
  emitSidecarTether,
  makeDeclarationIndex,
  normalizeRepoPath,
  type IndexedDeclaration,
  type StatFn,
} from "./resolve"
import type { Fact, Tether } from "./types"

export interface ExtractData {
  readonly root: string
  readonly git_key: string
  readonly files: readonly string[]
  readonly tethers: readonly Tether[]
  readonly facts: readonly Fact[]
}

export interface ExtractedTethers {
  readonly tethers: readonly Tether[]
  readonly facts: readonly Fact[]
}

interface GitProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface PendingInline {
  readonly path: string
  readonly comment: string
  readonly bind: string
  readonly profile: LanguageProfile
}

interface PendingSidecar {
  readonly path: string
  readonly source: string
}

const isMissingGit = (cause: unknown) => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return (cause as { code?: string }).code === "ENOENT"
  }

  return cause instanceof Error && /ENOENT|not found/i.test(cause.message)
}

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async (): Promise<GitProcessResult> => {
      const process = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ])

      return { stdout, stderr: stderr.trim(), exitCode }
    },
    catch: (cause) => {
      if (isMissingGit(cause)) {
        return new GitNotFoundError({
          message: "git is not installed or not on PATH",
        })
      }

      return new GitCommandError({
        args: ["git", ...args],
        message: cause instanceof Error ? cause.message : "git command failed",
      })
    },
  })

export const isTetherSidecar = (repoPath: string): boolean => basename(repoPath).endsWith(".tether")

export const isHonoraryMarkdown = (repoPath: string): boolean =>
  (HONORARY_MARKDOWN as readonly string[]).includes(basename(repoPath))

export const statFromTracked = (files: readonly string[]): StatFn => {
  const set = new Set(files.map(normalizeRepoPath))

  return (repoPath) => {
    const path = normalizeRepoPath(repoPath)
    if (path.length === 0) {
      return "dir"
    }
    if (set.has(path)) {
      return "file"
    }
    const prefix = `${path}/`
    for (const file of set) {
      if (file.startsWith(prefix)) {
        return "dir"
      }
    }
    return "missing"
  }
}

export const collectDeclarations = (
  root: Node,
  profile: LanguageProfile,
  path: string,
): readonly IndexedDeclaration[] => {
  const out: IndexedDeclaration[] = []
  const visit = (node: Node): void => {
    if ((profile.declaration_kinds as readonly string[]).includes(node.type)) {
      const name = declarationName(node, profile)
      if (name !== undefined && name.length > 0) {
        out.push({ path, name })
      }
    }
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index)
      if (child !== null) {
        visit(child)
      }
    }
  }
  visit(root)
  return out
}

export const listTrackedFiles = (repoRoot: string) =>
  Effect.gen(function* () {
    const listed = yield* runGit(repoRoot, ["ls-files", "-z"])
    if (listed.exitCode !== 0) {
      return yield* Effect.fail(
        new GitCommandError({
          args: ["git", "ls-files", "-z"],
          message: "git ls-files failed",
          exitCode: listed.exitCode,
          stderr: listed.stderr,
        }),
      )
    }

    const files = listed.stdout
      .split("\0")
      .map((entry) => normalizeRepoPath(entry))
      .filter((entry) => entry.length > 0)

    return [...new Set(files)].sort((left, right) => left.localeCompare(right))
  })

const readTrackedFile = async (repoRoot: string, repoPath: string): Promise<string | undefined> => {
  try {
    return await readFile(join(repoRoot, repoPath), "utf8")
  } catch {
    return undefined
  }
}

const compareTethers = (left: Tether, right: Tether): number => {
  const byPath = left.path.localeCompare(right.path)
  if (byPath !== 0) {
    return byPath
  }
  const leftName = left.host.kind === "symbol" ? left.host.name : left.host.kind
  const rightName = right.host.kind === "symbol" ? right.host.name : right.host.kind
  return leftName.localeCompare(rightName)
}

const uniqueFacts = (facts: readonly Fact[]): readonly Fact[] => {
  const seen = new Set<string>()
  const out: Fact[] = []
  for (const fact of facts) {
    const key = `${fact.kind}:${fact.path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(fact)
  }
  return out.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind))
}

const pushEmit = (
  result: { readonly tether?: Tether; readonly facts: readonly Fact[] },
  tethers: Tether[],
  facts: Fact[],
) => {
  if (result.tether !== undefined) {
    tethers.push(result.tether)
  }
  facts.push(...result.facts)
}

const missingGrammars = new Set<LanguageId>()

const languageReady = async (id: LanguageId): Promise<boolean> => {
  if (missingGrammars.has(id)) {
    return false
  }
  try {
    await loadLanguage(id)
    return true
  } catch (error) {
    if (error instanceof ExtractParserError && error.message.includes("grammar wasm not found")) {
      missingGrammars.add(id)
      return false
    }
    throw error
  }
}

const collectSourceFile = async (
  repoRoot: string,
  path: string,
  declarations: IndexedDeclaration[],
  inlines: PendingInline[],
) => {
  const language = languageForPath(path)
  if (language === undefined || !(await languageReady(language))) {
    return
  }

  const source = await readTrackedFile(repoRoot, path)
  if (source === undefined) {
    return
  }

  const profile = profileForLanguage(language)
  const tree = await parseSource(language, source)
  try {
    declarations.push(...collectDeclarations(tree.rootNode, profile, path))
    for (const bind of collectAdjacentBinds(tree.rootNode, source, profile)) {
      if (bind.name === undefined || bind.name.length === 0) {
        continue
      }
      inlines.push({
        path,
        comment: bind.comment.text,
        bind: bind.name,
        profile,
      })
    }
  } finally {
    tree.delete()
  }
}

const collectPending = async (repoRoot: string, tracked: readonly string[]) => {
  const declarations: IndexedDeclaration[] = []
  const inlines: PendingInline[] = []
  const sidecars: PendingSidecar[] = []

  for (const path of tracked) {
    if (isTetherSidecar(path) || isHonoraryMarkdown(path)) {
      const source = await readTrackedFile(repoRoot, path)
      if (source !== undefined) {
        sidecars.push({ path, source })
      }
      continue
    }
    await collectSourceFile(repoRoot, path, declarations, inlines)
  }

  return { declarations, inlines, sidecars }
}

const emitCollected = (
  tracked: readonly string[],
  pending: Awaited<ReturnType<typeof collectPending>>,
): ExtractedTethers => {
  const index = makeDeclarationIndex(pending.declarations, tracked)
  const stat = statFromTracked(tracked)
  const tethers: Tether[] = []
  const facts: Fact[] = []

  for (const sidecar of pending.sidecars) {
    pushEmit(emitSidecarTether({ path: sidecar.path, source: sidecar.source, stat }, index), tethers, facts)
  }

  for (const inline of pending.inlines) {
    pushEmit(emitInlineTether(inline, index), tethers, facts)
  }

  return {
    tethers: [...tethers].sort(compareTethers),
    facts: uniqueFacts(facts),
  }
}

export const extractTracked = async (
  repoRoot: string,
  files: readonly string[],
): Promise<ExtractedTethers> => {
  await initParser()
  const tracked = files.map(normalizeRepoPath).filter((path) => path.length > 0)
  return emitCollected(tracked, await collectPending(repoRoot, tracked))
}

export const extractRepo = (root: string) =>
  Effect.gen(function* () {
    const repo = yield* requireGitRepo(root)
    const files = yield* listTrackedFiles(repo.root)
    const extracted = yield* Effect.tryPromise({
      try: () => extractTracked(repo.root, files),
      catch: (cause) => {
        if (cause instanceof ExtractParserError) {
          return cause
        }

        return new ExtractParserError({
          message: cause instanceof Error ? cause.message : "extract walk failed",
        })
      },
    })

    return {
      root: repo.root,
      git_key: repo.gitKey,
      files,
      tethers: extracted.tethers,
      facts: extracted.facts,
    } satisfies ExtractData
  })
