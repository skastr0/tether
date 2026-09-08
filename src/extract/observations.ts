import { Schema } from "effect"
import { createHash } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
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
    readonly comment: string
    readonly startLine: number
    readonly endLine: number
  }>
}

export interface FileObservation {
  readonly kind: SiblingKind
  readonly source?: string
  readonly blobHash?: string
  readonly snap?: FileSnap
  readonly reason?: "grammar_unavailable" | "unsupported_language" | "excluded" | "symlink"
}

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

const visitChildren = (node: Node, visit: (child: Node) => void) => {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child !== null) visit(child)
  }
}

/** One parse produces extraction inputs and fingerprints; no tree escapes this call. */
export const snapLanguageSource = async (
  source: string,
  language: LanguageId,
): Promise<FileSnap | undefined> => {
  if (!(await languageReady(language))) return undefined
  const profile = profileForLanguage(language)
  const tree = await parseSource(language, source)
  try {
    if (tree.rootNode.hasError) {
      throw new SourceObservationError({
        path: language,
        message: "source has syntax errors; structural analysis unavailable",
      })
    }
    const decls: DeclSnap[] = []
    const walk = (node: Node): void => {
      if ((profile.declaration_kinds as readonly string[]).includes(node.type)) {
        const name = declarationName(node, profile)
        if (name !== undefined && name.length > 0) {
          decls.push({
            name,
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
    return { source, fingerprint: fingerprint(tree.rootNode, profile), decls, inlines, unboundMarked }
  } finally {
    tree.delete()
  }
}

export const uniqueDeclaration = (decls: readonly DeclSnap[], name: string): DeclSnap | undefined => {
  const matches = decls.filter((decl) => decl.name === name)
  return matches.length === 1 ? matches[0] : undefined
}
