import type { LanguageProfile } from "./languages/index"
import { parseComment, parseTetherSource, type ParsedRef, type ParsedTether } from "./syntax"
import type { Fact, Host, Ref, Tether } from "./types"

export interface IndexedDeclaration {
  readonly path: string
  readonly name: string
}

export interface DeclarationIndex {
  readonly files: ReadonlySet<string>
  hasFile(path: string): boolean
  hasSymbol(path: string, name: string): boolean
  namesIn(path: string): ReadonlySet<string>
}

export type SiblingKind = "file" | "dir" | "missing"

export type StatFn = (repoPath: string) => SiblingKind

export interface EmitResult {
  readonly tether?: Tether
  readonly facts: readonly Fact[]
}

export interface InlineEmitInput {
  readonly path: string
  readonly comment: string
  readonly bind: string
  readonly profile?: LanguageProfile
}

export interface SidecarEmitInput {
  readonly path: string
  readonly source: string
  readonly stat?: StatFn
}

const HONORARY = new Set(["AGENTS.md", "CLAUDE.md"])

export const normalizeRepoPath = (value: string): string => {
  const parts: string[] = []
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}

const dirname = (repoPath: string): string => {
  const normalized = normalizeRepoPath(repoPath)
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : normalized.slice(0, index)
}

const basename = (repoPath: string): string => {
  const normalized = normalizeRepoPath(repoPath)
  const index = normalized.lastIndexOf("/")
  return index === -1 ? normalized : normalized.slice(index + 1)
}

const joinRepo = (dir: string, rel: string): string => {
  const prefix = dir === "" ? rel : `${dir}/${rel}`
  return normalizeRepoPath(prefix)
}

export const makeDeclarationIndex = (
  declarations: readonly IndexedDeclaration[],
  files: readonly string[] = [],
): DeclarationIndex => {
  const fileSet = new Set<string>()
  const names = new Map<string, Set<string>>()

  const addFile = (path: string) => {
    const normalized = normalizeRepoPath(path)
    if (normalized.length === 0) return
    fileSet.add(normalized)
    if (!names.has(normalized)) names.set(normalized, new Set())
  }

  for (const file of files) addFile(file)

  for (const declaration of declarations) {
    const path = normalizeRepoPath(declaration.path)
    if (path.length === 0 || declaration.name.length === 0) continue
    addFile(path)
    names.get(path)?.add(declaration.name)
  }

  return {
    files: fileSet,
    hasFile(path: string) {
      return fileSet.has(normalizeRepoPath(path))
    },
    hasSymbol(path: string, name: string) {
      return names.get(normalizeRepoPath(path))?.has(name) === true
    },
    namesIn(path: string) {
      return names.get(normalizeRepoPath(path)) ?? new Set()
    },
  }
}

export const hostForSidecar = (tetherPath: string, stat?: StatFn): Host => {
  const path = normalizeRepoPath(tetherPath)
  const name = basename(path)
  const dir = dirname(path)
  const folder = dir === "" ? "." : dir

  if (HONORARY.has(name) && (name === "AGENTS.md" || name === "CLAUDE.md")) {
    return { kind: "honorary_folder", path: folder, file: name }
  }

  if (name === "root.tether" && dir === "") {
    return { kind: "repository", path: "." }
  }

  if (name.endsWith(".tether")) {
    const stem = name.slice(0, -".tether".length)
    const sibling = dir === "" ? stem : `${dir}/${stem}`
    const kind = stat?.(sibling)
    if (kind === "dir") return { kind: "folder", path: sibling }
    if (kind === "file") return { kind: "file", path: sibling }
    if (stem.includes(".")) return { kind: "file", path: sibling }
    return { kind: "folder", path: sibling }
  }

  return { kind: "file", path }
}

const sameFilePath = (host: Host, tetherPath: string): string => {
  if (host.kind === "symbol" || host.kind === "file") return host.path
  return normalizeRepoPath(tetherPath)
}

const isExplicitRelative = (spec: string): boolean => spec.startsWith("./") || spec.startsWith("../")

const pickPath = (relative: string, repo: string, index: DeclarationIndex, explicitRelative: boolean): string => {
  const relHit = relative.length > 0 && (index.hasFile(relative) || index.namesIn(relative).size > 0)
  const repoHit = repo.length > 0 && (index.hasFile(repo) || index.namesIn(repo).size > 0)
  if (explicitRelative) {
    if (relHit) return relative
    if (repoHit) return repo
    return relative
  }
  if (repoHit) return repo
  if (relHit) return relative
  return repo.length > 0 ? repo : relative
}

export const resolveRef = (ref: ParsedRef, host: Host, tetherPath: string, index: DeclarationIndex): Ref => {
  const fromDir = dirname(tetherPath)
  const name = ref.name

  if (ref.path === undefined) {
    const path = sameFilePath(host, tetherPath)
    return name === undefined ? { raw: ref.raw, path } : { raw: ref.raw, path, name }
  }

  const spec = ref.path
  const relative = joinRepo(fromDir, spec)
  const repo = normalizeRepoPath(spec)
  const path = pickPath(relative, repo, index, isExplicitRelative(spec))
  return name === undefined ? { raw: ref.raw, path } : { raw: ref.raw, path, name }
}

const resolveRefs = (
  refs: readonly ParsedRef[],
  host: Host,
  tetherPath: string,
  index: DeclarationIndex,
): readonly Ref[] => refs.map((ref) => resolveRef(ref, host, tetherPath, index))

export const symbolMatchesBind = (symbol: string, bind: string): boolean => {
  if (symbol === bind) return true
  if (symbol.endsWith(`.${bind}`) || bind.endsWith(`.${symbol}`)) return true
  const symbolHead = symbol.split(".")[0]
  const bindHead = bind.split(".")[0]
  return (symbolHead !== undefined && symbolHead === bind) || (bindHead !== undefined && bindHead === symbol)
}

const symbolsMatchBind = (symbols: readonly string[], bind: string): boolean =>
  symbols.every((symbol) => symbolMatchesBind(symbol, bind))

const illFormed = (path: string): Fact => ({ kind: "ill_formed", path })

const toTether = (
  path: string,
  host: Host,
  parsed: ParsedTether,
  refs: readonly Ref[],
): Tether => ({
  path,
  host,
  symbols: parsed.symbols,
  refs,
  public: parsed.public,
  doc: parsed.doc,
  examples: parsed.examples,
})

const emitFromParsed = (
  parsed: ParsedTether,
  path: string,
  host: Host,
  index: DeclarationIndex,
  adjacencyName?: string,
): EmitResult => {
  const refs = resolveRefs(parsed.refs, host, path, index)
  const mismatch =
    adjacencyName !== undefined && parsed.symbols.length > 0 && !symbolsMatchBind(parsed.symbols, adjacencyName)
  const facts = parsed.errors.length > 0 || mismatch ? [illFormed(path)] : []
  return { tether: toTether(path, host, parsed, refs), facts }
}

export const emitInlineTether = (input: InlineEmitInput, index: DeclarationIndex): EmitResult => {
  const parsed = parseComment(input.comment, input.profile)
  if (parsed === undefined) return { facts: [] }
  const host: Host = { kind: "symbol", path: input.path, name: input.bind }
  return emitFromParsed(parsed, input.path, host, index, input.bind)
}

export const emitSidecarTether = (input: SidecarEmitInput, index: DeclarationIndex): EmitResult => {
  const parsed = parseTetherSource(input.source)
  const host = hostForSidecar(input.path, input.stat)
  return emitFromParsed(parsed, input.path, host, index)
}


