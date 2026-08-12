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
  countSymbol(path: string, name: string): number
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

export const makeDeclarationIndex = (
  declarations: readonly IndexedDeclaration[],
  files: readonly string[] = [],
): DeclarationIndex => {
  const fileSet = new Set<string>()
  const names = new Map<string, Set<string>>()
  const counts = new Map<string, Map<string, number>>()

  const addFile = (path: string) => {
    const normalized = normalizeRepoPath(path)
    if (normalized.length === 0) return
    fileSet.add(normalized)
    if (!names.has(normalized)) names.set(normalized, new Set())
    if (!counts.has(normalized)) counts.set(normalized, new Map())
  }

  for (const file of files) addFile(file)

  for (const declaration of declarations) {
    const path = normalizeRepoPath(declaration.path)
    if (path.length === 0 || declaration.name.length === 0) continue
    addFile(path)
    names.get(path)?.add(declaration.name)
    const perFile = counts.get(path)
    if (perFile !== undefined) {
      perFile.set(declaration.name, (perFile.get(declaration.name) ?? 0) + 1)
    }
  }

  return {
    files: fileSet,
    hasFile(path: string) {
      return fileSet.has(normalizeRepoPath(path))
    },
    hasSymbol(path: string, name: string) {
      return names.get(normalizeRepoPath(path))?.has(name) === true
    },
    countSymbol(path: string, name: string) {
      return counts.get(normalizeRepoPath(path))?.get(name) ?? 0
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

export const pathEscapesRoot = (spec: string): boolean =>
  spec.split(/[\\/]/).includes("..")

export const resolveRef = (ref: ParsedRef, host: Host, tetherPath: string, _index: DeclarationIndex): Ref => {
  const name = ref.name

  if (ref.path === undefined) {
    const path = sameFilePath(host, tetherPath)
    return name === undefined ? { raw: ref.raw, path } : { raw: ref.raw, path, name }
  }

  const path = normalizeRepoPath(ref.path)
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

const symbolFact = (kind: "symbol_missing" | "symbol_ambiguous", path: string): Fact => ({ kind, path })

const hostAllowsSymbol = (host: Host): boolean => host.kind === "symbol" || host.kind === "file"

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
  const facts: Fact[] = []
  const mismatch =
    adjacencyName !== undefined && parsed.symbols.length > 0 && !symbolsMatchBind(parsed.symbols, adjacencyName)
  const badRefPath = parsed.refs.some((ref) => ref.path !== undefined && pathEscapesRoot(ref.path))
  if (parsed.errors.length > 0 || mismatch || badRefPath) {
    facts.push(illFormed(path))
  }
  if (parsed.symbols.length > 0 && !hostAllowsSymbol(host)) {
    facts.push(illFormed(path))
  }
  if (host.kind === "file") {
    for (const symbol of parsed.symbols) {
      const count = index.countSymbol(host.path, symbol)
      if (count === 0) facts.push(symbolFact("symbol_missing", path))
      if (count > 1) facts.push(symbolFact("symbol_ambiguous", path))
    }
  }
  return { tether: toTether(path, host, parsed, refs), facts }
}

export const emitInlineTether = (input: InlineEmitInput, index: DeclarationIndex): EmitResult => {
  const parsed = parseComment(input.comment, input.profile)
  if (parsed === undefined) return { facts: [] }
  const host: Host = { kind: "symbol", path: input.path, name: input.bind }
  return emitFromParsed(parsed, input.path, host, index, input.bind)
}

export const emitSidecarTether = (input: SidecarEmitInput, index: DeclarationIndex): EmitResult => {
  const host = hostForSidecar(input.path, input.stat)
  if (host.kind === "honorary_folder") {
    return { facts: [] }
  }
  const parsed = parseTetherSource(input.source)
  return emitFromParsed(parsed, input.path, host, index)
}


