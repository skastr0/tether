import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import type { Node } from "web-tree-sitter"

import {
  DEFAULT_MARKDOWN_ALLOWLIST,
} from "../core/constants"
import {
  ConfigurationError,
  GitCommandError,
  GitNotFoundError,
} from "../core/errors"
import { collectAdjacentBinds, declarationName, isMarkedComment } from "../extract/adjacency"
import { fingerprint, shapeFingerprint } from "../extract/fingerprint"
import type { LanguageId } from "../extract/languages"
import {
  ExtractParserError,
  languageForPath,
  parseSource,
  profileForLanguage,
} from "../extract/parser"
import { normalizeRepoPath, type StatFn } from "../extract/resolve"
import { FACT_KINDS, type Fact, type FactCandidate, type FactKind, type Host, type Ref, type Tether } from "../extract/types"
import {
  extractRepo,
  isHonoraryMarkdown,
  statFromTracked,
  type ExtractData,
} from "../extract/walk"

const TETHER_JSON = ".tether.json"

const PUBLIC_OPEN = "<!-- tether:public -->"
const PUBLIC_CLOSE = "<!-- /tether:public -->"

const ROGUE_EXTENSIONS = new Set([".md", ".txt"])
const MAX_CANDIDATES = 4
const ZERO_SHA = /^0+$/

interface LintConfig {
  readonly fail_on: readonly FactKind[]
  readonly allowlist: readonly string[]
}

interface LintReport {
  readonly root: string
  readonly facts: readonly Fact[]
  readonly fail_on: readonly FactKind[]
  readonly failed: boolean
}

interface GitProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface DeclSnap {
  readonly name: string
  readonly fingerprint: string
  readonly shape: string
}

interface FileSnap {
  readonly source: string
  readonly language: LanguageId | undefined
  readonly fingerprint: string
  readonly decls: readonly DeclSnap[]
  readonly unboundMarked: boolean
  readonly inlines: ReadonlyArray<{
    readonly name: string
    readonly startLine: number
    readonly endLine: number
  }>
}

interface BlameCommit {
  readonly sha: string
  readonly time: number
}

const FailOnSchema = Schema.Union(
  Schema.Array(Schema.String),
  Schema.Record({ key: Schema.String, value: Schema.Boolean }),
)

const TetherJsonSchema = Schema.Struct({
  fail_on: Schema.optional(FailOnSchema),
  allowlist: Schema.optional(Schema.Array(Schema.String)),
})

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

const gitOk = (cwd: string, args: ReadonlyArray<string>) =>
  runGit(cwd, args).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode !== 0) {
        return Effect.fail(
          new GitCommandError({
            args: ["git", ...args],
            message: result.stderr.length > 0 ? result.stderr : "git command failed",
            exitCode: result.exitCode,
            stderr: result.stderr,
          }),
        )
      }

      return Effect.succeed(result.stdout)
    }),
  )

export const defaultFailOn = (): readonly FactKind[] => [...FACT_KINDS]

const FACT_KIND_SET = new Set<string>(FACT_KINDS)

export const normalizeFailOn = (value: unknown): readonly FactKind[] => {
  if (value === undefined) {
    return defaultFailOn()
  }

  if (Array.isArray(value)) {
    const kinds: FactKind[] = []
    for (const entry of value) {
      if (typeof entry !== "string" || !FACT_KIND_SET.has(entry)) {
        throw new ConfigurationError({
          field: "fail_on",
          message: `unknown fact kind in fail_on: ${String(entry)}`,
        })
      }
      kinds.push(entry as FactKind)
    }
    return kinds
  }

  if (typeof value === "object" && value !== null) {
    const kinds: FactKind[] = []
    for (const [key, enabled] of Object.entries(value)) {
      if (!FACT_KIND_SET.has(key)) {
        throw new ConfigurationError({
          field: "fail_on",
          message: `unknown fact kind in fail_on: ${key}`,
        })
      }
      if (typeof enabled !== "boolean") {
        throw new ConfigurationError({
          field: "fail_on",
          message: `fail_on.${key} must be a boolean`,
        })
      }
      if (enabled) {
        kinds.push(key as FactKind)
      }
    }
    return kinds
  }

  throw new ConfigurationError({
    field: "fail_on",
    message: "fail_on must be an array of kinds or a kind-to-boolean map",
  })
}

export const isRogueDocument = (repoPath: string, allowlist: readonly string[]): boolean => {
  const name = basename(repoPath)
  if (isHonoraryMarkdown(repoPath) || name === "SKILL.md") {
    return false
  }

  const extension = extname(name).toLowerCase()
  if (!ROGUE_EXTENSIONS.has(extension)) {
    return false
  }

  if (allowlist.includes(repoPath)) {
    return false
  }

  return !(allowlist.includes(name) && !repoPath.includes("/"))
}

const honoraryPath = (host: Extract<Host, { kind: "honorary_folder" }>): string =>
  host.path === "." ? host.file : `${host.path}/${host.file}`

const skipHonoraryStaleness = (tether: Tether): boolean =>
  tether.host.kind === "honorary_folder" && tether.refs.length === 0 && tether.symbols.length === 0

const fact = (kind: FactKind, path: string, candidates?: readonly FactCandidate[]): Fact =>
  candidates === undefined || candidates.length === 0 ? { kind, path } : { kind, path, candidates }

const sortFacts = (facts: readonly Fact[]): readonly Fact[] => {
  const rank = new Map(FACT_KINDS.map((kind, index) => [kind, index]))
  const seen = new Set<string>()
  const out: Fact[] = []

  const ordered = [...facts].sort((left, right) => {
    const byKind = (rank.get(left.kind) ?? 99) - (rank.get(right.kind) ?? 99)
    if (byKind !== 0) {
      return byKind
    }
    return left.path.localeCompare(right.path)
  })

  for (const entry of ordered) {
    const key = `${entry.kind}:${entry.path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(entry)
  }

  return out
}

const visitChildren = (node: Node, visit: (child: Node) => void) => {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child !== null) {
      visit(child)
    }
  }
}

const collectDecls = (root: Node, language: LanguageId): readonly DeclSnap[] => {
  const profile = profileForLanguage(language)
  const out: DeclSnap[] = []
  const walk = (node: Node): void => {
    if ((profile.declaration_kinds as readonly string[]).includes(node.type)) {
      const name = declarationName(node, profile)
      if (name !== undefined && name.length > 0) {
        out.push({
          name,
          fingerprint: fingerprint(node, profile),
          shape: shapeFingerprint(node, profile),
        })
      }
    }
    visitChildren(node, walk)
  }
  walk(root)
  return out
}

const fileFingerprint = (root: Node, language: LanguageId): string =>
  fingerprint(root, profileForLanguage(language))

const blobFingerprint = (content: string): string =>
  `blob:${createHash("sha256").update(content).digest("hex")}`

const folderFingerprint = (entries: ReadonlyArray<readonly [string, string]>): string => {
  const rows = [...entries].sort((left, right) => left[0].localeCompare(right[0]))
  const hash = createHash("sha256")
  for (const [path, blob] of rows) {
    hash.update(path)
    hash.update("\0")
    hash.update(blob)
    hash.update("\n")
  }
  return `folder@1:${hash.digest("hex")}`
}

const parseLanguageSource = async (
  language: LanguageId,
  source: string,
): Promise<{ readonly fingerprint: string; readonly decls: readonly DeclSnap[] }> => {
  const tree = await parseSource(language, source)
  try {
    return {
      fingerprint: fileFingerprint(tree.rootNode, language),
      decls: collectDecls(tree.rootNode, language),
    }
  } finally {
    tree.delete()
  }
}

const snapLanguageFile = async (path: string, source: string, language: LanguageId): Promise<FileSnap> => {
  const profile = profileForLanguage(language)
  const tree = await parseSource(language, source)
  try {
    const inlines: Array<{ readonly name: string; readonly startLine: number; readonly endLine: number }> = []
    const bound = new Set<number>()
    for (const bind of collectAdjacentBinds(tree.rootNode, source, profile)) {
      if (bind.name === undefined || bind.name.length === 0) {
        continue
      }
      bound.add(bind.comment.startIndex)
      const first = bind.comment.nodes[0]
      const last = bind.comment.nodes[bind.comment.nodes.length - 1]
      if (first === undefined || last === undefined) {
        continue
      }
      inlines.push({
        name: bind.name,
        startLine: first.startPosition.row + 1,
        endLine: last.endPosition.row + 1,
      })
    }

    let unboundMarked = false
    const visit = (node: Node): void => {
      if (unboundMarked) {
        return
      }
      if ((profile.comment_kinds as readonly string[]).includes(node.type) && isMarkedComment(node.text)) {
        if (!bound.has(node.startIndex)) {
          unboundMarked = true
          return
        }
      }
      visitChildren(node, visit)
    }
    visit(tree.rootNode)

    return {
      source,
      language,
      fingerprint: fileFingerprint(tree.rootNode, language),
      decls: collectDecls(tree.rootNode, language),
      unboundMarked,
      inlines,
    }
  } finally {
    tree.delete()
  }
}

const readWorkingFile = async (repoRoot: string, repoPath: string): Promise<string | undefined> => {
  try {
    return await readFile(join(repoRoot, repoPath), "utf8")
  } catch {
    return undefined
  }
}

const loadTetherJson = (repoRoot: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(join(repoRoot, TETHER_JSON), "utf8")
        } catch (cause) {
          if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") {
            return undefined
          }
          throw cause
        }
      },
      catch: (cause) =>
        new ConfigurationError({
          field: TETHER_JSON,
          message: cause instanceof Error ? cause.message : `failed to read ${TETHER_JSON}`,
        }),
    })

    if (raw === undefined) {
      return {
        fail_on: defaultFailOn(),
        allowlist: [...DEFAULT_MARKDOWN_ALLOWLIST],
      } satisfies LintConfig
    }

    const parsed = yield* Schema.decodeUnknown(Schema.parseJson(TetherJsonSchema))(raw).pipe(
      Effect.mapError(
        (error) =>
          new ConfigurationError({
            field: TETHER_JSON,
            message: error.message,
          }),
      ),
    )

    const extras = parsed.allowlist ?? []
    for (const entry of extras) {
      if (entry.trim().length === 0) {
        return yield* Effect.fail(
          new ConfigurationError({
            field: "allowlist",
            message: "allowlist entries must be non-empty",
          }),
        )
      }
    }

    const failOn = yield* Effect.try({
      try: () => normalizeFailOn(parsed.fail_on),
      catch: (cause) =>
        cause instanceof ConfigurationError
          ? cause
          : new ConfigurationError({
              field: "fail_on",
              message: cause instanceof Error ? cause.message : "invalid fail_on",
            }),
    })

    return {
      fail_on: failOn,
      allowlist: [...DEFAULT_MARKDOWN_ALLOWLIST, ...extras],
    } satisfies LintConfig
  })

const lastCommitForPath = (repoRoot: string, repoPath: string) =>
  gitOk(repoRoot, ["log", "-1", "--format=%H", "--", repoPath]).pipe(
    Effect.map((stdout) => {
      const sha = stdout.trim()
      return sha.length === 0 ? undefined : sha
    }),
  )

const parseBlame = (porcelain: string): BlameCommit | undefined => {
  const commits = new Map<string, number>()
  const lines = porcelain.split("\n")
  let sha: string | undefined
  let time = 0

  const flush = () => {
    if (sha === undefined) {
      return
    }
    const previous = commits.get(sha)
    if (previous === undefined || time > previous) {
      commits.set(sha, time)
    }
  }

  for (const line of lines) {
    const header = /^([0-9a-f]{40}|0{40})\s/.exec(line)
    if (header?.[1] !== undefined) {
      flush()
      sha = header[1]
      time = 0
      continue
    }
    if (line.startsWith("committer-time ")) {
      time = Number.parseInt(line.slice("committer-time ".length), 10) || 0
    }
  }
  flush()

  let newest: BlameCommit | undefined
  for (const [commit, stamp] of commits) {
    if (ZERO_SHA.test(commit)) {
      return undefined
    }
    if (newest === undefined || stamp > newest.time) {
      newest = { sha: commit, time: stamp }
    }
  }
  return newest
}

const lastInlineCommit = (repoRoot: string, repoPath: string, startLine: number, endLine: number) =>
  runGit(repoRoot, ["blame", "--line-porcelain", `-L${startLine},${endLine}`, "--", repoPath]).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) {
        return undefined
      }
      return parseBlame(result.stdout)?.sha
    }),
  )

const showAt = (repoRoot: string, commit: string, repoPath: string) =>
  runGit(repoRoot, ["show", `${commit}:${repoPath}`]).pipe(
    Effect.map((result) => (result.exitCode === 0 ? result.stdout : undefined)),
  )

const hashObject = (repoRoot: string, repoPath: string) =>
  gitOk(repoRoot, ["hash-object", "--", repoPath]).pipe(Effect.map((stdout) => stdout.trim()))

const currentFolderEntries = (repoRoot: string, folder: string, files: readonly string[]) =>
  Effect.gen(function* () {
    const prefix = folder === "." ? "" : `${normalizeRepoPath(folder)}/`
    const rows: Array<readonly [string, string]> = []
    for (const file of files) {
      if (folder !== "." && file !== folder && !file.startsWith(prefix)) {
        continue
      }
      const hash = yield* hashObject(repoRoot, file)
      rows.push([file, hash])
    }
    return rows
  })

const historicalFolderEntries = (repoRoot: string, commit: string, folder: string) =>
  runGit(repoRoot, [
    "ls-tree",
    "-r",
    "--full-tree",
    commit,
    ...(folder === "." ? [] : [folder]),
  ]).pipe(
    Effect.map((result) => {
      if (result.exitCode !== 0) {
        return undefined
      }

      const rows: Array<readonly [string, string]> = []
      const prefix = folder === "." ? "" : `${normalizeRepoPath(folder)}/`
      for (const line of result.stdout.split("\n")) {
        if (line.length === 0) {
          continue
        }
        const tab = line.indexOf("\t")
        if (tab === -1) {
          continue
        }
        const meta = line.slice(0, tab)
        const path = normalizeRepoPath(line.slice(tab + 1))
        const parts = meta.split(" ")
        const hash = parts[2]
        if (hash === undefined || path.length === 0) {
          continue
        }
        if (folder !== "." && path !== folder && !path.startsWith(prefix)) {
          continue
        }
        rows.push([path, hash])
      }
      return rows
    }),
  )

const namesIn = (snaps: ReadonlyMap<string, FileSnap>, path: string): ReadonlySet<string> =>
  new Set((snaps.get(path)?.decls ?? []).map((decl) => decl.name))

const hasSymbol = (snaps: ReadonlyMap<string, FileSnap>, path: string, name: string): boolean =>
  namesIn(snaps, path).has(name)

const hasHost = (
  host: Host,
  files: ReadonlySet<string>,
  stat: StatFn,
  snaps: ReadonlyMap<string, FileSnap>,
): boolean => {
  switch (host.kind) {
    case "repository":
      return true
    case "folder":
      return stat(host.path) === "dir"
    case "file":
      return files.has(host.path) || stat(host.path) === "file"
    case "honorary_folder":
      return files.has(honoraryPath(host))
    case "symbol":
      return hasSymbol(snaps, host.path, host.name)
  }
}

const refExists = (
  ref: Ref,
  files: ReadonlySet<string>,
  stat: StatFn,
  snaps: ReadonlyMap<string, FileSnap>,
): boolean => {
  if (ref.name !== undefined) {
    return hasSymbol(snaps, ref.path, ref.name)
  }
  return files.has(ref.path) || stat(ref.path) !== "missing"
}

// Sidecar @symbol names a declaration on a file host. Folder/repo @symbol is an id only.
const symbolCount = (snaps: ReadonlyMap<string, FileSnap>, path: string, name: string): number =>
  snaps.get(path)?.decls.filter((decl) => decl.name === name).length ?? 0

const lastTouchForTether = (
  repoRoot: string,
  tether: Tether,
  snaps: ReadonlyMap<string, FileSnap>,
) =>
  Effect.gen(function* () {
    if (tether.host.kind === "symbol") {
      const bindName = tether.host.name
      const inline = snaps
        .get(tether.path)
        ?.inlines.find((entry) => entry.name === bindName)
      if (inline !== undefined) {
        const blamed = yield* lastInlineCommit(repoRoot, tether.path, inline.startLine, inline.endLine)
        if (blamed !== undefined) {
          return blamed
        }
      }
    }

    return yield* lastCommitForPath(repoRoot, tether.path)
  })

const currentHostFingerprint = (
  repoRoot: string,
  host: Host,
  files: readonly string[],
  snaps: ReadonlyMap<string, FileSnap>,
) =>
  Effect.gen(function* () {
    switch (host.kind) {
      case "symbol": {
        const decl = snaps.get(host.path)?.decls.find((entry) => entry.name === host.name)
        return decl?.fingerprint
      }
      case "file": {
        const snap = snaps.get(host.path)
        if (snap !== undefined) {
          return snap.fingerprint
        }
        const source = yield* Effect.promise(() => readWorkingFile(repoRoot, host.path))
        return source === undefined ? undefined : blobFingerprint(source)
      }
      case "folder":
      case "repository": {
        const folder = host.kind === "repository" ? "." : host.path
        const entries = yield* currentFolderEntries(repoRoot, folder, files)
        return folderFingerprint(entries)
      }
      case "honorary_folder":
        return undefined
    }
  })

const historicalLanguageFingerprint = async (
  source: string,
  language: LanguageId,
  name?: string,
): Promise<string | undefined> => {
  const parsed = await parseLanguageSource(language, source)
  if (name === undefined) {
    return parsed.fingerprint
  }
  return parsed.decls.find((decl) => decl.name === name)?.fingerprint
}

const historicalHostFingerprint = (
  repoRoot: string,
  commit: string,
  host: Host,
) =>
  Effect.gen(function* () {
    switch (host.kind) {
      case "symbol": {
        const source = yield* showAt(repoRoot, commit, host.path)
        if (source === undefined) {
          return undefined
        }
        const language = languageForPath(host.path)
        if (language === undefined) {
          return blobFingerprint(source)
        }
        return yield* Effect.tryPromise({
          try: () => historicalLanguageFingerprint(source, language, host.name),
          catch: (cause) =>
            cause instanceof ExtractParserError
              ? cause
              : new ExtractParserError({
                  message: cause instanceof Error ? cause.message : "historical parse failed",
                }),
        })
      }
      case "file": {
        const source = yield* showAt(repoRoot, commit, host.path)
        if (source === undefined) {
          return undefined
        }
        const language = languageForPath(host.path)
        if (language === undefined) {
          return blobFingerprint(source)
        }
        return yield* Effect.tryPromise({
          try: () => historicalLanguageFingerprint(source, language),
          catch: (cause) =>
            cause instanceof ExtractParserError
              ? cause
              : new ExtractParserError({
                  message: cause instanceof Error ? cause.message : "historical parse failed",
                }),
        })
      }
      case "folder":
      case "repository": {
        const folder = host.kind === "repository" ? "." : host.path
        const entries = yield* historicalFolderEntries(repoRoot, commit, folder)
        return entries === undefined ? undefined : folderFingerprint(entries)
      }
      case "honorary_folder":
        return undefined
    }
  })

const currentRefFingerprint = (
  repoRoot: string,
  ref: Ref,
  snaps: ReadonlyMap<string, FileSnap>,
) =>
  Effect.gen(function* () {
    const snap = snaps.get(ref.path)
    if (ref.name !== undefined) {
      return snap?.decls.find((decl) => decl.name === ref.name)?.fingerprint
    }
    if (snap !== undefined) {
      return snap.fingerprint
    }
    const source = yield* Effect.promise(() => readWorkingFile(repoRoot, ref.path))
    return source === undefined ? undefined : blobFingerprint(source)
  })

const historicalRefFingerprint = (repoRoot: string, commit: string, ref: Ref) =>
  Effect.gen(function* () {
    const source = yield* showAt(repoRoot, commit, ref.path)
    if (source === undefined) {
      return undefined
    }
    const language = languageForPath(ref.path)
    if (language === undefined) {
      return blobFingerprint(source)
    }
    return yield* Effect.tryPromise({
      try: () => historicalLanguageFingerprint(source, language, ref.name),
      catch: (cause) =>
        cause instanceof ExtractParserError
          ? cause
          : new ExtractParserError({
              message: cause instanceof Error ? cause.message : "historical parse failed",
            }),
    })
  })

const renameCandidates = (repoRoot: string, commit: string, ref: Ref, snaps: ReadonlyMap<string, FileSnap>) =>
  Effect.gen(function* () {
    if (ref.name === undefined) {
      return undefined
    }

    const source = yield* showAt(repoRoot, commit, ref.path)
    if (source === undefined) {
      return undefined
    }

    const language = languageForPath(ref.path)
    if (language === undefined) {
      return undefined
    }

    const parsed = yield* Effect.tryPromise({
      try: () => parseLanguageSource(language, source),
      catch: (cause) =>
        cause instanceof ExtractParserError
          ? cause
          : new ExtractParserError({
              message: cause instanceof Error ? cause.message : "historical parse failed",
            }),
    })

    const previous = parsed.decls.find((decl) => decl.name === ref.name)
    if (previous === undefined) {
      return undefined
    }

    const current = snaps.get(ref.path)?.decls ?? []
    const matches = current.filter((decl) => decl.shape === previous.shape && decl.name !== ref.name)
    const uniqueShapes = new Set(matches.map((decl) => decl.shape))
    if (matches.length === 0 || uniqueShapes.size !== matches.length) {
      return undefined
    }
    if (matches.length > MAX_CANDIDATES) {
      return undefined
    }

    return matches.map((decl) => ({ path: ref.path, name: decl.name }) satisfies FactCandidate)
  })

const publicSpanState = (readme: string | undefined): "missing" | "empty" | "present" => {
  if (readme === undefined) {
    return "missing"
  }

  const start = readme.indexOf(PUBLIC_OPEN)
  const end = readme.indexOf(PUBLIC_CLOSE)
  if (start === -1 || end === -1 || end < start) {
    return "missing"
  }

  const inner = readme.slice(start + PUBLIC_OPEN.length, end).trim()
  return inner.length === 0 ? "empty" : "present"
}

const buildSnaps = (repoRoot: string, files: readonly string[]) =>
  Effect.tryPromise({
    try: async (): Promise<{
      readonly snaps: ReadonlyMap<string, FileSnap>
      readonly unbound: readonly string[]
    }> => {
      const snaps = new Map<string, FileSnap>()
      const unbound: string[] = []

      for (const path of files) {
        const language = languageForPath(path)
        if (language === undefined) {
          continue
        }
        const source = await readWorkingFile(repoRoot, path)
        if (source === undefined) {
          continue
        }

        const snap = await snapLanguageFile(path, source, language)
        snaps.set(path, snap)
        if (snap.unboundMarked) {
          unbound.push(path)
        }
      }

      return { snaps, unbound }
    },
    catch: (cause) =>
      cause instanceof ExtractParserError
        ? cause
        : new ExtractParserError({
            message: cause instanceof Error ? cause.message : "lint parse failed",
          }),
  })

const collectFacts = (extracted: ExtractData, config: LintConfig) =>
  Effect.gen(function* () {
    const files = extracted.files
    const fileSet = new Set(files)
    const stat = statFromTracked(files)
    const { snaps, unbound } = yield* buildSnaps(extracted.root, files)
    const facts: Fact[] = [...extracted.facts]

    for (const path of unbound) {
      facts.push(fact("ill_formed", path))
    }

    for (const path of files) {
      if (isRogueDocument(path, config.allowlist)) {
        facts.push(fact("rogue_document", path))
      }
    }

    const bySymbol = new Map<string, string[]>()
    for (const tether of extracted.tethers) {
      for (const symbol of tether.symbols) {
        const paths = bySymbol.get(symbol) ?? []
        paths.push(tether.path)
        bySymbol.set(symbol, paths)
      }
    }
    for (const paths of bySymbol.values()) {
      if (new Set(paths).size < 2) {
        continue
      }
      for (const path of new Set(paths)) {
        facts.push(fact("duplicate_id", path))
      }
    }

    const readme = yield* Effect.promise(() => readWorkingFile(extracted.root, "README.md"))
    if (extracted.tethers.some((tether) => tether.public) && publicSpanState(readme) !== "present") {
      facts.push(fact("public_surface_stale", "README.md"))
    }

    for (const tether of extracted.tethers) {
      if (!hasHost(tether.host, fileSet, stat, snaps)) {
        facts.push(fact("host_missing", tether.path))
      }

      if (skipHonoraryStaleness(tether)) {
        continue
      }

      const touch = yield* lastTouchForTether(extracted.root, tether, snaps)

      if (tether.host.kind !== "honorary_folder" && touch !== undefined) {
        const current = yield* currentHostFingerprint(extracted.root, tether.host, files, snaps)
        const previous = yield* historicalHostFingerprint(extracted.root, touch, tether.host)
        if (current !== undefined && previous !== undefined && current !== previous) {
          facts.push(fact("host_fingerprint_changed", tether.path))
        }
      }

      for (const ref of tether.refs) {
        if (!refExists(ref, fileSet, stat, snaps)) {
          const candidates =
            touch === undefined ? undefined : yield* renameCandidates(extracted.root, touch, ref, snaps)
          facts.push(fact("ref_missing", tether.path, candidates))
          continue
        }

        if (touch === undefined) {
          continue
        }

        const current = yield* currentRefFingerprint(extracted.root, ref, snaps)
        const previous = yield* historicalRefFingerprint(extracted.root, touch, ref)
        if (current !== undefined && previous !== undefined && current !== previous) {
          facts.push(fact("ref_fingerprint_changed", tether.path))
        }
      }

      if (tether.host.kind === "file") {
        for (const symbol of tether.symbols) {
          const count = symbolCount(snaps, tether.host.path, symbol)
          if (count === 0) facts.push(fact("symbol_missing", tether.path))
          if (count > 1) facts.push(fact("symbol_ambiguous", tether.path))
        }
      }

      if (
        tether.symbols.length > 0 &&
        tether.host.kind !== "file" &&
        tether.host.kind !== "symbol"
      ) {
        facts.push(fact("ill_formed", tether.path))
      }
    }

    return sortFacts(facts)
  })

export const lintRepo = (root: string) =>
  Effect.gen(function* () {
    const extracted = yield* extractRepo(root)
    const config = yield* loadTetherJson(extracted.root)
    const facts = yield* collectFacts(extracted, config)
    const failing = new Set(config.fail_on)
    const failed = facts.some((entry) => failing.has(entry.kind))

    return {
      root: extracted.root,
      facts,
      fail_on: config.fail_on,
      failed,
    } satisfies LintReport
  })
