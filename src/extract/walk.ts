import { Effect } from "effect"
import { basename } from "node:path"

import { HONORARY_MARKDOWN } from "../core/constants"
import { GitCommandError } from "../core/errors"
import { requireGitRepo, runGit } from "../core/git"
import { ExtractParserError, languageForPath, profileForLanguage } from "./parser"
import type { LanguageProfile } from "./languages"
import { extractionCoverage, type AnalysisCoverage } from "../facts/evidence"
import {
  gitBlobHash,
  observePath,
  readObservedFile,
  snapLanguageSource,
  SourceObservationError,
  type FileObservation,
} from "./observations"
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
  readonly coverage: AnalysisCoverage
}

export interface ExtractedTethers {
  readonly tethers: readonly Tether[]
  readonly facts: readonly Fact[]
  readonly coverage: AnalysisCoverage
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

export const isTetherSidecar = (repoPath: string): boolean => basename(repoPath).endsWith(".tether")

export const isHonoraryMarkdown = (repoPath: string): boolean =>
  (HONORARY_MARKDOWN as readonly string[]).includes(basename(repoPath))

export const listTrackedFiles = (repoRoot: string) =>
  Effect.gen(function* () {
    const listed = yield* runGit(repoRoot, ["ls-files", "-z"], { trimStdout: false })
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

const collectPending = async (repoRoot: string, tracked: readonly string[], objectFormat: string) => {
  const declarations: IndexedDeclaration[] = []
  const inlines: PendingInline[] = []
  const sidecars: PendingSidecar[] = []
  const observations = new Map<string, FileObservation>()
  const unchecked: Array<{ path: string; reason: string }> = []
  const excluded: string[] = []
  const examined: string[] = []

  for (const path of tracked) {
    const info = await observePath(repoRoot, path)
    observations.set(path, info)
    if (info.kind === "missing") {
      examined.push(path)
      continue
    }
    if (info.kind !== "file" || info.reason === "symlink") {
      unchecked.push({ path, reason: info.reason ?? "not_regular_file" })
      continue
    }
    const bytes = await readObservedFile(repoRoot, path)
    if (bytes === undefined) {
      observations.set(path, { kind: "missing" })
      examined.push(path)
      continue
    }
    const source = bytes.toString("utf8")
    const base = { kind: "file", source, blobHash: gitBlobHash(bytes, objectFormat) } as const
    observations.set(path, base)
    if (isHonoraryMarkdown(path)) {
      excluded.push(path)
      observations.set(path, { ...base, reason: "excluded" })
    } else if (isTetherSidecar(path)) {
      sidecars.push({ path, source })
      const sibling = path.slice(0, -".tether".length)
      if (!observations.has(sibling)) observations.set(sibling, await observePath(repoRoot, sibling))
    } else {
      const language = languageForPath(path)
      if (language === undefined) {
        excluded.push(path)
        observations.set(path, { ...base, reason: "unsupported_language" })
        continue
      }
      let snap
      try {
        snap = await snapLanguageSource(source, language)
      } catch (cause) {
        if (cause instanceof SourceObservationError) {
          throw new SourceObservationError({ path, message: cause.message })
        }
        throw cause
      }
      if (snap === undefined) {
        unchecked.push({ path, reason: "grammar_unavailable" })
        observations.set(path, { ...base, reason: "grammar_unavailable" })
        continue
      }
      observations.set(path, { ...base, snap })
      examined.push(path)
      declarations.push(...snap.decls.map((decl) => ({ path, name: decl.name })))
      inlines.push(
        ...snap.inlines.map((inline) => ({
          path,
          comment: inline.comment,
          bind: inline.name,
          profile: profileForLanguage(language),
        })),
      )
    }
  }

  return {
    declarations,
    inlines,
    sidecars,
    observations,
    examined,
    coverage: extractionCoverage({
      status: unchecked.length === 0 ? "complete" : "partial",
      unchecked,
      excluded,
    }),
  }
}

const emitCollected = (
  tracked: readonly string[],
  pending: Awaited<ReturnType<typeof collectPending>>,
): ExtractedTethers => {
  const index = makeDeclarationIndex(pending.declarations, tracked, pending.examined)
  const stat: StatFn = (path) => pending.observations.get(normalizeRepoPath(path))?.kind ?? "missing"
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
    coverage: pending.coverage,
  }
}

export const extractTracked = async (
  repoRoot: string,
  files: readonly string[],
): Promise<ExtractedTethers> => {
  const tracked = files.map(normalizeRepoPath).filter((path) => path.length > 0)
  return emitCollected(tracked, await collectPending(repoRoot, tracked, "sha1"))
}

/** Internal observations are not part of extract.json or command output. */
export const observeRepo = (root: string) =>
  Effect.gen(function* () {
    const repo = yield* requireGitRepo(root)
    const files = yield* listTrackedFiles(repo.root)
    const format = yield* runGit(repo.root, ["rev-parse", "--show-object-format"])
    if (format.exitCode !== 0) {
      return yield* Effect.fail(
        new GitCommandError({
          args: ["git", "rev-parse", "--show-object-format"],
          message: format.stderr,
          exitCode: format.exitCode,
          stderr: format.stderr,
        }),
      )
    }
    const pending = yield* Effect.tryPromise({
      try: () => collectPending(repo.root, files, format.stdout),
      catch: (cause) =>
        cause instanceof SourceObservationError || cause instanceof ExtractParserError
          ? cause
          : new ExtractParserError({
              message: cause instanceof Error ? cause.message : "extract walk failed",
            }),
    })
    const emitted = emitCollected(files, pending)
    return {
      extracted: { root: repo.root, git_key: repo.gitKey, files, ...emitted } satisfies ExtractData,
      observations: pending.observations,
    }
  })

export const extractRepo = (root: string) => observeRepo(root).pipe(Effect.map(({ extracted }) => extracted))
