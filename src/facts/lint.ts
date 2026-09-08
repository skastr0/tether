import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"

import { DEFAULT_MARKDOWN_ALLOWLIST } from "../core/constants"
import { ConfigurationError, GitCommandError } from "../core/errors"
import { runGit, type RunGitOptions } from "../core/git"
import { findPublicSpan, hashPublicSurface, renderReadmeRegion } from "../compile/wiki"
import { languageForPath } from "../extract/parser"
import {
  blobFingerprint,
  observePath,
  readObservedFile,
  snapLanguageSource,
  SourceObservationError,
  uniqueDeclaration,
  type FileObservation,
  type Observations,
} from "../extract/observations"
import { FACT_KINDS, type Fact, type FactCandidate, type FactKind, type Tether } from "../extract/types"
import { isHonoraryMarkdown, observeRepo, type ExtractData } from "../extract/walk"
import { factsOnChangedPaths } from "./affected"
import type { AnalysisCoverage, Baseline, Comparison, Evidence } from "./evidence"

export interface LintConfig {
  readonly fail_on: readonly FactKind[]
  readonly allowlist: readonly string[]
}

export interface LintReport extends Evidence {
  readonly root: string
  readonly facts: readonly Fact[]
  readonly fail_on: readonly FactKind[]
  readonly failed: boolean
}

export interface LintOptions {
  readonly changed?: boolean | undefined
  readonly since?: string | undefined
}

export interface RepositoryAnalysis extends ExtractData, Evidence {
  readonly targets: ReadonlyArray<{
    readonly path: string
    readonly kind: FileObservation["kind"]
    readonly symbols?: readonly string[]
    readonly reason?: string
  }>
  readonly fail_on: readonly FactKind[]
}

const TETHER_JSON = ".tether.json"
const TetherJsonSchema = Schema.Struct({
  fail_on: Schema.optional(
    Schema.Union(Schema.Array(Schema.String), Schema.Record({ key: Schema.String, value: Schema.Boolean })),
  ),
  allowlist: Schema.optional(Schema.Array(Schema.String)),
})

const gitOk = (cwd: string, args: ReadonlyArray<string>, options?: RunGitOptions) =>
  runGit(cwd, args, options).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(result.stdout)
        : Effect.fail(
            new GitCommandError({
              args: ["git", ...args],
              message: result.stderr || "git command failed",
              exitCode: result.exitCode,
              stderr: result.stderr,
            }),
          ),
    ),
  )

const DEFAULT_FAIL_ON = new Set<FactKind>([
  "ill_formed",
  "rogue_document",
  "host_missing",
  "symbol_missing",
  "symbol_ambiguous",
  "ref_missing",
  "public_surface_stale",
])
export const defaultFailOn = (): readonly FactKind[] => FACT_KINDS.filter((kind) => DEFAULT_FAIL_ON.has(kind))

export const normalizeFailOn = (value: unknown): readonly FactKind[] => {
  if (value === undefined) return defaultFailOn()
  const known = new Set<string>(FACT_KINDS)
  const validate = (kind: unknown): FactKind => {
    if (typeof kind !== "string" || !known.has(kind)) {
      throw new ConfigurationError({
        field: "fail_on",
        message: `unknown fact kind in fail_on: ${String(kind)}`,
      })
    }
    return kind as FactKind
  }
  if (Array.isArray(value)) return value.map(validate)
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, enabled]) => {
      const kind = validate(key)
      if (typeof enabled !== "boolean") {
        throw new ConfigurationError({ field: "fail_on", message: `fail_on.${key} must be a boolean` })
      }
      return enabled ? [kind] : []
    })
  }
  throw new ConfigurationError({
    field: "fail_on",
    message: "fail_on must be an array of kinds or a kind-to-boolean map",
  })
}

export const isRogueDocument = (path: string, allowlist: readonly string[]): boolean => {
  const name = basename(path)
  if (isHonoraryMarkdown(path) || name === "SKILL.md") return false
  if (![".md", ".txt"].includes(extname(name).toLowerCase())) return false
  return !allowlist.includes(path) && !(allowlist.includes(name) && !path.includes("/"))
}

export const loadTetherJson = (repoRoot: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(join(repoRoot, TETHER_JSON), "utf8")
        } catch (cause) {
          if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
            return undefined
          throw cause
        }
      },
      catch: (cause) => new ConfigurationError({ field: TETHER_JSON, message: String(cause) }),
    })
    if (raw === undefined)
      return { fail_on: defaultFailOn(), allowlist: [...DEFAULT_MARKDOWN_ALLOWLIST] } satisfies LintConfig
    const parsed = yield* Schema.decodeUnknown(Schema.parseJson(TetherJsonSchema))(raw).pipe(
      Effect.mapError((error) => new ConfigurationError({ field: TETHER_JSON, message: error.message })),
    )
    const extras = parsed.allowlist ?? []
    if (extras.some((entry) => entry.trim().length === 0)) {
      return yield* Effect.fail(
        new ConfigurationError({ field: "allowlist", message: "allowlist entries must be non-empty" }),
      )
    }
    const failOn = yield* Effect.try({
      try: () => normalizeFailOn(parsed.fail_on),
      catch: (cause) =>
        cause instanceof ConfigurationError
          ? cause
          : new ConfigurationError({ field: "fail_on", message: String(cause) }),
    })
    return { fail_on: failOn, allowlist: [...DEFAULT_MARKDOWN_ALLOWLIST, ...extras] } satisfies LintConfig
  })

const sortFacts = (facts: readonly Fact[]): readonly Fact[] => {
  const rank = new Map(FACT_KINDS.map((kind, index) => [kind, index]))
  const seen = new Set<string>()
  return [...facts]
    .sort((a, b) => rank.get(a.kind)! - rank.get(b.kind)! || a.path.localeCompare(b.path))
    .filter((entry) => {
      const key = `${entry.kind}:${entry.path}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const contains = (folder: string, path: string): boolean =>
  folder === "." || path === folder || path.startsWith(`${folder}/`)
const folderFingerprint = (entries: ReadonlyArray<readonly [string, string]>): string => {
  const hash = createHash("sha256")
  for (const [path, blob] of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
    hash.update(path).update("\0").update(blob).update("\n")
  }
  return `folder@1:${hash.digest("hex")}`
}

const showAt = (root: string, commit: string, path: string) =>
  runGit(root, ["show", `${commit}:${path}`], { trimStdout: false }).pipe(
    Effect.map((result) => (result.exitCode === 0 ? result.stdout : undefined)),
  )

// Latest blamed line is a mechanical baseline selection, not evidence of intentional review.
const parseBlame = (porcelain: string): string | undefined => {
  let sha: string | undefined
  let newest: { sha: string; time: number } | undefined
  for (const line of porcelain.split("\n")) {
    const header = /^([0-9a-f]{40,64})\s/.exec(line)
    if (header?.[1] !== undefined) {
      sha = header[1]
      if (/^0+$/.test(sha)) return undefined
    } else if (sha !== undefined && line.startsWith("committer-time ")) {
      const time = Number.parseInt(line.slice("committer-time ".length), 10)
      if (newest === undefined || time > newest.time) newest = { sha, time }
    }
  }
  return newest?.sha
}

const baselineFor = (root: string, tether: Tether, observations: Observations) =>
  Effect.gen(function* () {
    if (tether.host.kind === "symbol") {
      const name = tether.host.name
      const snap = observations.get(tether.path)?.snap
      if (snap === undefined || uniqueDeclaration(snap.decls, name) === undefined) return undefined
      const inlines = snap.inlines.filter((entry) => entry.name === name)
      if (inlines.length !== 1) return undefined
      const inline = inlines[0]!
      const result = yield* runGit(
        root,
        ["blame", "--line-porcelain", `-L${inline.startLine},${inline.endLine}`, "--", tether.path],
        { trimStdout: false },
      )
      const commit = result.exitCode === 0 ? parseBlame(result.stdout) : undefined
      return commit === undefined ? undefined : ({ commit, method: "inline_blame" } satisfies Baseline)
    }
    const commit = (yield* gitOk(root, ["log", "-1", "--format=%H", "--", tether.path])).trim()
    return commit.length === 0 ? undefined : ({ commit, method: "last_source_commit" } satisfies Baseline)
  })

type Target = { readonly path: string; readonly name?: string }
type FingerprintResult = { readonly value: string } | { readonly reason: string }

const currentFingerprint = (
  target: Target,
  observations: Observations,
  files: readonly string[],
): FingerprintResult => {
  const observed = observations.get(target.path)
  if (observed === undefined || observed.kind === "missing") return { reason: "current_target_missing" }
  if (target.name !== undefined) {
    if (observed.snap === undefined) return { reason: observed.reason ?? "not_tracked" }
    const matches = observed.snap.decls.filter((decl) => decl.name === target.name)
    if (matches.length !== 1)
      return { reason: matches.length === 0 ? "current_symbol_missing" : "current_symbol_ambiguous" }
    return { value: matches[0]!.fingerprint }
  }
  if (observed.kind === "dir") {
    const entries: Array<readonly [string, string]> = []
    for (const path of files.filter((path) => contains(target.path, path))) {
      const file = observations.get(path)
      if (file?.kind === "missing") continue
      if (file?.blobHash === undefined) return { reason: `folder_entry_unavailable:${path}` }
      entries.push([path, file.blobHash])
    }
    return { value: folderFingerprint(entries) }
  }
  if (observed.reason === "grammar_unavailable" || observed.reason === "symlink")
    return { reason: observed.reason }
  if (observed.snap !== undefined) return { value: observed.snap.fingerprint }
  return observed.source === undefined
    ? { reason: "not_tracked" }
    : { value: blobFingerprint(observed.source) }
}

const historicalFingerprint = (root: string, baseline: Baseline, target: Target, folder: boolean) =>
  Effect.gen(function* () {
    if (folder) {
      const result = yield* runGit(
        root,
        [
          "ls-tree",
          "-r",
          "-z",
          "--full-tree",
          baseline.commit,
          ...(target.path === "." ? [] : ["--", target.path]),
        ],
        { trimStdout: false },
      )
      if (result.exitCode !== 0) return { reason: "historical_tree_unavailable" } satisfies FingerprintResult
      const entries: Array<readonly [string, string]> = []
      for (const row of result.stdout.split("\0")) {
        if (!row) continue
        const tab = row.indexOf("\t")
        const path = row.slice(tab + 1)
        const blob = row.slice(0, tab).split(" ")[2]
        if (tab >= 0 && blob !== undefined && contains(target.path, path)) entries.push([path, blob])
      }
      if (entries.length === 0 && target.path !== ".")
        return { reason: "historical_target_missing" } satisfies FingerprintResult
      return { value: folderFingerprint(entries) } satisfies FingerprintResult
    }
    const source = yield* showAt(root, baseline.commit, target.path)
    if (source === undefined) return { reason: "historical_target_missing" } satisfies FingerprintResult
    const language = languageForPath(target.path)
    if (language === undefined)
      return target.name === undefined
        ? { value: blobFingerprint(source) }
        : { reason: "unsupported_language" }
    const parsed = yield* Effect.tryPromise({
      try: () => snapLanguageSource(source, language),
      catch: () => new SourceObservationError({ path: target.path, message: "historical parse unavailable" }),
    }).pipe(Effect.catchTag("SourceObservationError", () => Effect.succeed(undefined)))
    if (parsed === undefined) return { reason: "historical_parse_unavailable" } satisfies FingerprintResult
    if (target.name === undefined) return { value: parsed.fingerprint } satisfies FingerprintResult
    const matches = parsed.decls.filter((decl) => decl.name === target.name)
    if (matches.length !== 1)
      return {
        reason: matches.length === 0 ? "historical_symbol_missing" : "historical_symbol_ambiguous",
      } satisfies FingerprintResult
    return { value: matches[0]!.fingerprint } satisfies FingerprintResult
  })

const renameCandidates = (root: string, baseline: Baseline, target: Target, observations: Observations) =>
  Effect.gen(function* () {
    if (target.name === undefined) return undefined
    const source = yield* showAt(root, baseline.commit, target.path)
    const language = languageForPath(target.path)
    if (source === undefined || language === undefined) return undefined
    const parsed = yield* Effect.tryPromise({
      try: () => snapLanguageSource(source, language),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined))
    const previous = uniqueDeclaration(parsed?.decls ?? [], target.name)
    if (previous === undefined) return undefined
    const current = observations.get(target.path)?.snap?.decls ?? []
    const matches = current.filter((decl) => decl.shape === previous.shape && decl.name !== target.name)
    if (matches.length !== 1 || uniqueDeclaration(current, matches[0]!.name) === undefined) return undefined
    return matches.map((decl) => ({ path: target.path, name: decl.name }) satisfies FactCandidate)
  })

export const collectFacts = (extracted: ExtractData, config: LintConfig, observations: Observations) =>
  Effect.gen(function* () {
    const facts: Fact[] = [...extracted.facts]
    const comparisons: Comparison[] = []
    for (const path of extracted.files) {
      if (observations.get(path)?.kind === "missing") continue
      if (isRogueDocument(path, config.allowlist)) facts.push({ kind: "rogue_document", path })
      if (observations.get(path)?.snap?.unboundMarked) facts.push({ kind: "ill_formed", path })
    }
    // Explicit symbol names are file-scoped. Repetition across files is not a shared identity.
    const symbols = new Map<string, string[]>()
    for (const tether of extracted.tethers) {
      for (const name of new Set(tether.symbols)) {
        const key = `${tether.host.path}#${name}`
        symbols.set(key, [...(symbols.get(key) ?? []), tether.path])
      }
    }
    for (const paths of symbols.values()) {
      if (paths.length > 1) for (const path of new Set(paths)) facts.push({ kind: "duplicate_id", path })
    }
    const readme = observations.get("README.md")?.source
    const span = findPublicSpan(readme ?? "")
    const publicSurfaceReason =
      extracted.coverage.extraction.status !== "complete"
        ? "incomplete_extraction"
        : observations.get("README.md")?.reason === "symlink"
          ? "readme_unexamined"
          : undefined
    if (
      publicSurfaceReason === undefined &&
      (span !== undefined || extracted.tethers.some((tether) => tether.public))
    ) {
      const expected = hashPublicSurface({
        region: renderReadmeRegion(extracted.tethers),
        publicPages: [],
      }).region
      const actual =
        span === undefined ? undefined : hashPublicSurface({ region: span.inner, publicPages: [] }).region
      if (expected !== actual) facts.push({ kind: "public_surface_stale", path: "README.md" })
    }
    for (const tether of extracted.tethers) {
      const baseline = yield* baselineFor(extracted.root, tether, observations)
      const targets = [
        { check: "host_fingerprint" as const, target: tether.host },
        ...tether.refs.map((target) => ({ check: "ref_fingerprint" as const, target })),
      ]
      for (const { check, target } of targets) {
        const subject = {
          path: tether.path,
          host: tether.host,
          check,
          target: {
            path: target.path,
            ...("name" in target && target.name !== undefined ? { name: target.name } : {}),
          },
        }
        const observed = observations.get(target.path)
        const current = currentFingerprint(subject.target, observations, extracted.files)
        if (
          observed?.kind === "missing" ||
          ("reason" in current && current.reason === "current_symbol_missing")
        ) {
          const candidates =
            check === "ref_fingerprint" && baseline !== undefined
              ? yield* renameCandidates(extracted.root, baseline, subject.target, observations)
              : undefined
          facts.push({
            kind: check === "host_fingerprint" ? "host_missing" : "ref_missing",
            path: tether.path,
            ...(candidates === undefined ? {} : { candidates }),
          })
        }
        if ("reason" in current) {
          comparisons.push({
            ...subject,
            status: "unchecked",
            reason: current.reason,
            ...(baseline === undefined ? {} : { baseline }),
          })
        } else if (baseline === undefined) {
          comparisons.push({ ...subject, status: "unchecked", reason: "baseline_unavailable" })
        } else {
          const previous = yield* historicalFingerprint(
            extracted.root,
            baseline,
            subject.target,
            observed?.kind === "dir",
          )
          if ("reason" in previous)
            comparisons.push({ ...subject, status: "unchecked", reason: previous.reason, baseline })
          else {
            comparisons.push({
              ...subject,
              status: "compared",
              baseline,
              before: previous.value,
              after: current.value,
            })
            if (previous.value !== current.value)
              facts.push({
                kind: check === "host_fingerprint" ? "host_fingerprint_changed" : "ref_fingerprint_changed",
                path: tether.path,
              })
          }
        }
      }
      if (tether.host.kind === "file") {
        const observed = observations.get(tether.host.path)
        for (const name of tether.symbols) {
          if (observed?.snap === undefined && observed?.kind !== "missing") {
            comparisons.push({
              path: tether.path,
              host: tether.host,
              check: "symbol_resolution",
              target: { path: tether.host.path, name },
              status: "unchecked",
              reason: observed?.reason ?? "not_tracked",
            })
          } else {
            const count = observed?.snap?.decls.filter((decl) => decl.name === name).length ?? 0
            if (count === 0) facts.push({ kind: "symbol_missing", path: tether.path })
            if (count > 1) facts.push({ kind: "symbol_ambiguous", path: tether.path })
          }
        }
      }
    }
    return {
      facts: sortFacts(facts),
      comparisons,
      coverage: {
        ...extracted.coverage,
        history: "attempted",
        public_surface: publicSurfaceReason === undefined ? "readme_span" : "not_performed",
        ...(publicSurfaceReason === undefined
          ? {}
          : { public_surface_unchecked: { path: "README.md", reason: publicSurfaceReason } }),
      } satisfies AnalysisCoverage,
    }
  })

export const analyzeRepo = (root: string) =>
  Effect.gen(function* () {
    const { extracted, observations } = yield* observeRepo(root)
    const config = yield* loadTetherJson(extracted.root)
    const paths = new Set([
      ".",
      "README.md",
      ...extracted.tethers.flatMap((tether) => [tether.host.path, ...tether.refs.map((ref) => ref.path)]),
    ])
    for (const path of paths) {
      if (observations.has(path)) continue
      const info = yield* Effect.tryPromise({
        try: () => observePath(extracted.root, path),
        catch: (cause) =>
          cause instanceof SourceObservationError
            ? cause
            : new SourceObservationError({ path, message: String(cause) }),
      })
      // README is a derived surface even when not yet in the index. Other untracked content stays unexamined.
      if (path === "README.md" && info.kind === "file" && info.reason === undefined) {
        const bytes = yield* Effect.tryPromise({
          try: () => readObservedFile(extracted.root, path),
          catch: (cause) => new SourceObservationError({ path, message: String(cause) }),
        })
        observations.set(
          path,
          bytes === undefined ? { kind: "missing" } : { ...info, source: bytes.toString("utf8") },
        )
      } else observations.set(path, info)
    }
    const collected = yield* collectFacts(extracted, config, observations)
    return {
      ...extracted,
      ...collected,
      fail_on: config.fail_on,
      targets: [...observations].map(([path, info]) => ({
        path,
        kind: info.kind,
        ...(info.snap === undefined
          ? { reason: info.reason ?? "not_examined" }
          : { symbols: info.snap.decls.map((decl) => decl.name) }),
      })),
    } satisfies RepositoryAnalysis
  })

const listChangedPaths = (root: string, since: string) =>
  Effect.gen(function* () {
    const paths = new Set<string>()
    for (const args of [[since], [], ["--cached"]]) {
      const stdout = yield* gitOk(root, ["diff", "--no-renames", "--name-only", "-z", ...args], {
        trimStdout: false,
      })
      for (const path of stdout.split("\0")) if (path.length > 0) paths.add(path)
    }
    return paths
  })

export const lintRepo = (root: string, options?: LintOptions) =>
  Effect.gen(function* () {
    const analysis = yield* analyzeRepo(root)
    const facts =
      options?.changed === true
        ? factsOnChangedPaths(
            analysis.facts,
            analysis.tethers,
            yield* listChangedPaths(analysis.root, options.since?.trim() || "HEAD"),
          )
        : analysis.facts
    return {
      root: analysis.root,
      facts,
      fail_on: analysis.fail_on,
      failed: facts.some((entry) => analysis.fail_on.includes(entry.kind)),
      coverage: analysis.coverage,
      comparisons: analysis.comparisons,
    } satisfies LintReport
  })
