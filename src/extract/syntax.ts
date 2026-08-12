import type { LanguageId, LanguageProfile } from "./languages/index"
import type { ExampleBlock } from "./types"

export type ParseErrorReason =
  | "unclosed_block"
  | "unknown_directive"
  | "missing_argument"
  | "invalid_argument"

export interface ParseError {
  readonly line: number
  readonly reason: ParseErrorReason
  readonly token?: string
}

export interface ParsedRef {
  readonly raw: string
  readonly path?: string
  readonly name?: string
}

export interface ParsedTether {
  readonly symbols: readonly string[]
  readonly refs: readonly ParsedRef[]
  readonly public: boolean
  readonly doc: string
  readonly examples: readonly ExampleBlock[]
  readonly errors: readonly ParseError[]
}

const MARKER = "@tether"
const HASH_LANGUAGES: ReadonlySet<LanguageId> = new Set(["python", "ruby"])

const lineAt = (source: string, index: number): number => {
  let line = 1
  for (let i = 0; i < index; i++) if (source.charAt(i) === "\n") line++
  return line
}

const columnIndent = (source: string, index: number): number => {
  let i = index
  while (i > 0 && source.charAt(i - 1) !== "\n") i--
  return index - i
}

const atContentStart = (source: string, index: number): boolean => {
  let i = index
  while (i > 0 && source.charAt(i - 1) !== "\n") {
    const prev = source.charAt(i - 1)
    if (prev !== " " && prev !== "\t") return false
    i--
  }
  return true
}

const normalizeNewlines = (source: string): string => source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")

const dedent = (body: string): string => {
  const lines = body.split("\n")
  let min = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const indent = line.match(/^[ \t]*/)?.[0]?.length ?? 0
    if (indent < min) min = indent
  }
  if (!Number.isFinite(min) || min === 0) return body
  return lines.map((line) => (line.length >= min ? line.slice(min) : line)).join("\n")
}

const tidyBlock = (body: string): string => {
  let text = body
  if (text.startsWith("\n")) text = text.slice(1)
  if (text.endsWith("\n")) text = text.slice(0, -1)
  return dedent(text)
}

const unique = <T>(values: readonly T[], key: (value: T) => string): readonly T[] => {
  const seen = new Set<string>()
  const out: T[] = []
  for (const value of values) {
    const id = key(value)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(value)
  }
  return out
}

const commentPrefixes = (profile?: LanguageProfile): readonly string[] => {
  if (profile && HASH_LANGUAGES.has(profile.id)) return ["#"]
  if (profile) return ["///", "//!", "//"]
  return ["///", "//!", "//", "#"]
}

const stripJsdocPrefix = (line: string): string => {
  const match = /^[ \t]*\*(?:[ \t]|$)(.*)$/.exec(line)
  return match?.[1] ?? line
}

const unwrapHtmlComment = (text: string): string => {
  const start = text.indexOf("<!--")
  const end = text.lastIndexOf("-->")
  if (start === -1 || end === -1 || end < start) return text
  return text.slice(start + 4, end)
}

const unwrapBlockComment = (text: string): string => {
  const start = text.indexOf("/*")
  const end = text.lastIndexOf("*/")
  if (start === -1 || end === -1 || end < start) return text
  let inner = text.slice(start + 2, end)
  if (inner.startsWith("!")) inner = inner.slice(1)
  return inner.split("\n").map(stripJsdocPrefix).join("\n")
}

const stripLinePrefix = (line: string, prefixes: readonly string[]): string => {
  const trimmedStart = line.trimStart()
  const indent = line.slice(0, line.length - trimmedStart.length)
  for (const prefix of prefixes) {
    if (!trimmedStart.startsWith(prefix)) continue
    const rest = trimmedStart.slice(prefix.length)
    if (rest.length === 0) return ""
    if (rest.startsWith(" ") || rest.startsWith("\t")) return rest.slice(1)
    // Keep `#heading` (sidecar markdown). Slash comments may omit the space.
    if (prefix !== "#") return rest
    return indent + trimmedStart
  }
  return line
}

export const unwrapCommentText = (raw: string, profile?: LanguageProfile): string => {
  const text = normalizeNewlines(raw)
  const kinds = profile?.comment_kinds
  if ((kinds === undefined || kinds.includes("html_comment")) && /^\s*<!--/.test(text)) {
    return unwrapHtmlComment(text)
  }
  if (
    (kinds === undefined ||
      kinds.includes("block_comment") ||
      kinds.includes("multiline_comment") ||
      kinds.includes("comment")) &&
    /^\s*\/\*/.test(text)
  ) {
    return unwrapBlockComment(text)
  }
  return text
    .split("\n")
    .map((line) => stripLinePrefix(line, commentPrefixes(profile)))
    .join("\n")
}

const firstToken = (source: string): string | undefined => /\S+/.exec(source)?.[0]

const tetherSource = (unwrapped: string): boolean => firstToken(unwrapped) === MARKER

export const hasTetherMarker = (raw: string, profile?: LanguageProfile): boolean =>
  tetherSource(unwrapCommentText(raw, profile))

const stripTetherMarker = (source: string): string =>
  source.replace(/^(?:[ \t]*\n)*[ \t]*@tether\b[ \t]*/, "")

const parseRefTarget = (raw: string): ParsedRef | undefined => {
  if (raw.length === 0) return undefined
  const hash = raw.indexOf("#")
  if (hash === -1) return { raw, path: raw }
  const path = raw.slice(0, hash)
  const name = raw.slice(hash + 1)
  if (name.length === 0) return undefined
  if (path.length === 0) return { raw, name }
  return { raw, path, name }
}

const fenceTicks = (source: string, index: number): string | undefined => {
  if (!source.startsWith("```", index)) return undefined
  let ticks = 0
  while (source.charAt(index + ticks) === "`") ticks++
  return ticks >= 3 ? "`".repeat(ticks) : undefined
}

const fenceCloses = (source: string, index: number, fence: string): boolean => {
  if (!source.startsWith(fence, index) || columnIndent(source, index) > 3) return false
  let i = index + fence.length
  while (i < source.length && source.charAt(i) !== "\n") {
    if (source.charAt(i) !== " " && source.charAt(i) !== "\t") return false
    i++
  }
  return true
}

// Fences inside doc must not close the block: root.tether samples contain `{` / `}`.
const findMatchingBrace = (source: string, openIndex: number, fences: boolean): number => {
  let depth = 0
  let i = openIndex
  let fence: string | undefined
  while (i < source.length) {
    if (fences && atContentStart(source, i) && columnIndent(source, i) <= 3) {
      if (fence === undefined) {
        const opened = fenceTicks(source, i)
        if (opened !== undefined) {
          const lineEnd = source.indexOf("\n", i)
          i = lineEnd === -1 ? source.length : lineEnd + 1
          fence = opened
          continue
        }
      } else if (fenceCloses(source, i, fence)) {
        const lineEnd = source.indexOf("\n", i)
        i = lineEnd === -1 ? source.length : lineEnd + 1
        fence = undefined
        continue
      }
    }
    if (fence !== undefined) {
      i++
      continue
    }
    const ch = source.charAt(i)
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

const errorAt = (line: number, reason: ParseErrorReason, token?: string): ParseError =>
  token === undefined ? { line, reason } : { line, reason, token }

const readLine = (text: string, pos: number): { readonly raw: string; readonly next: number } => {
  const nl = text.indexOf("\n", pos)
  if (nl === -1) return { raw: text.slice(pos), next: text.length }
  return { raw: text.slice(pos, nl), next: nl + 1 }
}

const skipSpaces = (text: string, pos: number): number => {
  let i = pos
  while (i < text.length && (text.charAt(i) === " " || text.charAt(i) === "\t")) i++
  return i
}

const consumeOpenBrace = (text: string, pos: number): number | undefined => {
  let i = skipSpaces(text, pos)
  if (text.charAt(i) === "{") return i + 1
  if (text.charAt(i) !== "\n") return undefined
  i++
  i = skipSpaces(text, i)
  while (text.charAt(i) === "\n") i = skipSpaces(text, i + 1)
  return text.charAt(i) === "{" ? i + 1 : undefined
}

const takeBlock = (
  text: string,
  afterBrace: number,
  fences: boolean,
): { readonly body: string; readonly pos: number } | undefined => {
  const close = findMatchingBrace(text, afterBrace - 1, fences)
  if (close === -1) return undefined
  let pos = close + 1
  if (text.charAt(pos) === "\n") pos++
  return { body: tidyBlock(text.slice(afterBrace, close)), pos }
}

interface Acc {
  symbols: string[]
  refs: ParsedRef[]
  examples: ExampleBlock[]
  errors: ParseError[]
  public: boolean
}

const applyDirective = (acc: Acc, directive: string, argument: string, line: number): ParseError | "replay" | undefined => {
  if (directive === MARKER) return argument.length > 0 ? "replay" : undefined
  if (directive === "@public") {
    acc.public = true
    return argument.length > 0 ? errorAt(line, "invalid_argument", directive) : undefined
  }
  if (directive === "@symbol" || directive === "@ref") {
    if (argument.length === 0) return errorAt(line, "missing_argument", directive)
    const tokens = argument.split(/\s+/)
    const target = tokens[0] ?? ""
    if (tokens.length !== 1 || target.length === 0) return errorAt(line, "invalid_argument", directive)
    if (directive === "@symbol") {
      acc.symbols.push(target)
      return undefined
    }
    const parsed = parseRefTarget(target)
    if (parsed === undefined) return errorAt(line, "invalid_argument", directive)
    acc.refs.push(parsed)
    return undefined
  }
  return errorAt(line, "unknown_directive", directive)
}

export const parseTetherSource = (source: string): ParsedTether => {
  const text = normalizeNewlines(source)
  const acc: Acc = { symbols: [], refs: [], examples: [], errors: [], public: false }
  const bodyParts: string[] = []
  const unfenced: string[] = []
  let pos = 0

  const flushUnfenced = () => {
    const block = unfenced.join("\n").trim()
    unfenced.length = 0
    if (block.length > 0) bodyParts.push(block)
  }

  while (pos < text.length) {
    const rawStart = pos
    pos = skipSpaces(text, pos)
    if (pos >= text.length) break
    if (text.charAt(pos) === "\n") {
      if (unfenced.length > 0) unfenced.push("")
      pos++
      continue
    }

    const line = readLine(text, rawStart)
    const trimmed = line.raw.trim()
    const lineNumber = lineAt(text, pos)

    if (trimmed.startsWith("@")) {
      flushUnfenced()
      const match = /^(@[A-Za-z][\w-]*)(?:\s+(.*))?$/.exec(trimmed)
      if (match === null) {
        acc.errors.push(errorAt(lineNumber, "unknown_directive", trimmed.split(/\s+/)[0]))
        pos = line.next
        continue
      }
      const applied = applyDirective(acc, match[1] ?? "", match[2]?.trim() ?? "", lineNumber)
      if (applied === "replay") {
        const marker = /^\s*@tether\b[ \t]*/.exec(line.raw)?.[0] ?? MARKER
        pos = rawStart + marker.length
        continue
      }
      if (applied !== undefined) acc.errors.push(applied)
      pos = line.next
      continue
    }

    const doc = /^doc(?:\s*\{.*)?$/.exec(trimmed)
    const example = /^example\s+(\S+)(?:\s*\{.*)?$/.exec(trimmed)
    if (doc !== null || example !== null) {
      flushUnfenced()
      const kind = doc !== null ? "doc" : "example"
      const lang = example?.[1] ?? ""
      let cursor = skipSpaces(text, rawStart)
      cursor += kind === "doc" ? 3 : "example".length
      if (kind === "example") cursor = skipSpaces(text, cursor) + lang.length
      const afterBrace = consumeOpenBrace(text, cursor)
      const block = afterBrace === undefined ? undefined : takeBlock(text, afterBrace, kind === "doc")
      if (afterBrace === undefined) {
        acc.errors.push(errorAt(lineNumber, "invalid_argument", kind))
        pos = line.next
        continue
      }
      if (block === undefined) {
        acc.errors.push(errorAt(lineNumber, "unclosed_block", kind))
        pos = text.length
        continue
      }
      if (kind === "doc") {
        if (block.body.length > 0) bodyParts.push(block.body)
      } else {
        acc.examples.push({ lang, body: block.body })
      }
      pos = block.pos
      continue
    }

    unfenced.push(line.raw)
    pos = line.next
  }

  flushUnfenced()
  return {
    symbols: unique(acc.symbols, (value) => value),
    refs: unique(acc.refs, (ref) => ref.raw),
    public: acc.public,
    doc: bodyParts.join("\n\n"),
    examples: acc.examples,
    errors: acc.errors,
  }
}

export const parseComment = (raw: string, profile?: LanguageProfile): ParsedTether | undefined => {
  const unwrapped = unwrapCommentText(raw, profile)
  if (!tetherSource(unwrapped)) return undefined
  return parseTetherSource(stripTetherMarker(unwrapped))
}
