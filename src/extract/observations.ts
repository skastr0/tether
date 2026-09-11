import { Schema } from "effect"
import { createHash } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import { join } from "node:path"
import type { Node } from "web-tree-sitter"

import { collectAdjacentBinds, declarationName, isMarkedComment } from "./adjacency"
import { fingerprint, shapeFingerprint } from "./fingerprint"
import type { LanguageId } from "./languages"
import { languageReady, parseSource, profileForLanguage } from "./parser"
import type { SiblingKind } from "./resolve"

export class SourceObservationError extends Schema.TaggedError<SourceObservationError>()(
  "SourceObservationError",
  { path: Schema.String, message: Schema.String },
) {}

export interface DeclSnap {
  readonly name: string
  readonly kind: string
  readonly fingerprint: string
  readonly shape: string
}

export interface FileSnap {
  readonly source: string
  readonly fingerprint: string
  readonly decls: readonly DeclSnap[]
  readonly unboundMarked: boolean
  readonly inlines: ReadonlyArray<{
    readonly name: string
    readonly kind: string
    readonly fingerprint: string
    readonly comment: string
    readonly startLine: number
    readonly endLine: number
  }>
}

export interface SyntaxErrorPosition {
  readonly line: number
  readonly column: number
  readonly kind: string
}

export type LanguageSourceSnap =
  | { readonly status: "ok"; readonly snap: FileSnap }
  | { readonly status: "syntax_error"; readonly position: SyntaxErrorPosition }

export const asFileSnap = (result: LanguageSourceSnap | undefined): FileSnap | undefined =>
  result?.status === "ok" ? result.snap : undefined

export interface FileObservation {
  readonly kind: SiblingKind
  readonly source?: string
  readonly blobHash?: string
  readonly snap?: FileSnap
  readonly reason?: "grammar_unavailable" | "unsupported_language" | "excluded" | "symlink" | "syntax_error"
  readonly position?: SyntaxErrorPosition
}

export const isUncheckedHostReason = (
  reason: string | undefined,
): reason is "grammar_unavailable" | "symlink" | "syntax_error" =>
  reason === "grammar_unavailable" || reason === "symlink" || reason === "syntax_error"

export type Observations = ReadonlyMap<string, FileObservation>

const absent = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR")

// lstat deliberately does not follow symlinks into untracked or external content.
export const observePath = async (root: string, path: string): Promise<FileObservation> => {
  try {
    const parts = path.split("/").filter((part) => part !== "" && part !== ".")
    for (let index = 1; index < parts.length; index += 1) {
      if ((await lstat(join(root, ...parts.slice(0, index)))).isSymbolicLink()) {
        return { kind: "file", reason: "symlink" }
      }
    }
    const info = await lstat(join(root, path))
    if (info.isSymbolicLink()) return { kind: "file", reason: "symlink" }
    if (info.isDirectory()) return { kind: "dir" }
    if (!info.isFile()) throw new Error("not a regular file or directory")
    return { kind: "file" }
  } catch (cause) {
    if (absent(cause)) return { kind: "missing" }
    throw new SourceObservationError({ path, message: String(cause) })
  }
}

export const readObservedFile = async (root: string, path: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(join(root, path))
  } catch (cause) {
    if (absent(cause)) return undefined
    throw new SourceObservationError({ path, message: String(cause) })
  }
}

export const blobFingerprint = (source: string): string =>
  `blob:${createHash("sha256").update(source).digest("hex")}`

export const gitBlobHash = (bytes: Buffer, format: string): string =>
  createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex")

/** Working-tree git blob of a symlink (link target), same as mode 120000. */
export const symlinkBlobHash = async (
  root: string,
  path: string,
  objectFormat: string,
): Promise<string | undefined> => {
  try {
    const abs = join(root, path)
    if (!(await lstat(abs)).isSymbolicLink()) return undefined
    return gitBlobHash(Buffer.from(await readlink(abs)), objectFormat)
  } catch {
    return undefined
  }
}

const visitChildren = (node: Node, visit: (child: Node) => void) => {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child !== null) visit(child)
  }
}

// tree-sitter-typescript still prefers `foo < typeof import("m")` over a
// generic call. ERROR/MISSING nodes that sit on that valid type are a
// grammar gap, not a TypeScript syntax error.
const IMPORT_TYPE_IN_TYPE_POSITION =
  /(?:typeof\s+|readonly\s+|[<|&]|=>|:\s*|type\s+[^=]+=\s*)(?:typeof\s+|readonly\s+)*import\s*\(\s*(['"`])(?:\\.|[^\\])*?\1\s*\)/

const isImportTypeGrammarGap = (source: string, node: Node): boolean => {
  const from = Math.max(0, node.startIndex - 80)
  const to = Math.min(source.length, node.endIndex + 8)
  return IMPORT_TYPE_IN_TYPE_POSITION.test(source.slice(from, to))
}

// tree-sitter's lexer uses U+0000 as EOF, so a raw NUL inside a string or
// template is UNEXPECTED even though it is a valid SourceCharacter. The
// surrounding literal still closes; treat that ERROR as parsed.
const STRING_LITERAL_KINDS = new Set([
  "string",
  "template_string",
  "template_literal_type",
  "interpreted_string_literal",
  "raw_string_literal",
  "string_literal",
  "char_literal",
  "rune_literal",
])

const isNulInStringLiteral = (node: Node): boolean => {
  if (node.type !== "ERROR" || node.text !== "\0") {
    return false
  }
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (STRING_LITERAL_KINDS.has(parent.type)) {
      return true
    }
  }
  return false
}

const firstSyntaxError = (node: Node, source: string): Node | undefined => {
  if (node.type === "ERROR" || node.isMissing) {
    return isImportTypeGrammarGap(source, node) || isNulInStringLiteral(node) ? undefined : node
  }
  if (!node.hasError) return undefined
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child === null) continue
    const found = firstSyntaxError(child, source)
    if (found !== undefined) return found
  }
  return undefined
}

const syntaxErrorPosition = (node: Node): SyntaxErrorPosition => ({
  line: node.startPosition.row + 1,
  column: node.startPosition.column,
  kind: node.isMissing ? "MISSING" : node.type,
})

/** One parse produces extraction inputs and fingerprints; no tree escapes this call. */
export const snapLanguageSource = async (
  source: string,
  language: LanguageId,
): Promise<LanguageSourceSnap | undefined> => {
  if (!(await languageReady(language))) return undefined
  const profile = profileForLanguage(language)
  const tree = await parseSource(language, source)
  try {
    if (tree.rootNode.hasError) {
      const error = firstSyntaxError(tree.rootNode, source)
      if (error !== undefined) {
        return { status: "syntax_error", position: syntaxErrorPosition(error) }
      }
    }
    const decls: DeclSnap[] = []
    const walk = (node: Node): void => {
      if ((profile.declaration_kinds as readonly string[]).includes(node.type)) {
        const name = declarationName(node, profile)
        if (name !== undefined && name.length > 0) {
          decls.push({
            name,
            kind: node.type,
            fingerprint: fingerprint(node, profile),
            shape: shapeFingerprint(node, profile),
          })
        }
      }
      visitChildren(node, walk)
    }
    walk(tree.rootNode)
    const bound = new Set<number>()
    const inlines: Array<FileSnap["inlines"][number]> = []
    for (const bind of collectAdjacentBinds(tree.rootNode, source, profile)) {
      if (!bind.name) continue
      bound.add(bind.comment.startIndex)
      const first = bind.comment.nodes[0]
      const last = bind.comment.nodes.at(-1)
      if (first === undefined || last === undefined) continue
      inlines.push({
        name: bind.name,
        kind: bind.declaration.type,
        fingerprint: fingerprint(bind.declaration, profile),
        comment: bind.comment.text,
        startLine: first.startPosition.row + 1,
        endLine: last.endPosition.row + 1,
      })
    }
    let unboundMarked = false
    const visit = (node: Node): void => {
      if (
        (profile.comment_kinds as readonly string[]).includes(node.type) &&
        isMarkedComment(node.text) &&
        !bound.has(node.startIndex)
      )
        unboundMarked = true
      visitChildren(node, visit)
    }
    visit(tree.rootNode)
    return {
      status: "ok",
      snap: { source, fingerprint: fingerprint(tree.rootNode, profile), decls, inlines, unboundMarked },
    }
  } finally {
    tree.delete()
  }
}

export const uniqueDeclaration = (decls: readonly DeclSnap[], name: string): DeclSnap | undefined => {
  const matches = decls.filter((decl) => decl.name === name)
  return matches.length === 1 ? matches[0] : undefined
}
