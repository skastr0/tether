import type { Node } from "web-tree-sitter"

import type { LanguageProfile } from "./languages/index"

const WHITESPACE = /^\s*$/

export interface AdjacentComment {
  readonly nodes: readonly Node[]
  readonly startIndex: number
  readonly endIndex: number
  readonly text: string
}

export interface AdjacentBind {
  readonly comment: AdjacentComment
  readonly declaration: Node
  readonly name?: string
}

const childrenIncludingExtras = (node: Node): Node[] => {
  const children: Node[] = []
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child !== null) {
      children.push(child)
    }
  }
  return children
}

const stripHtmlComment = (text: string): string => {
  if (!text.startsWith("<!--")) {
    return text
  }
  return text.endsWith("-->") ? text.slice(4, -3) : text.slice(4)
}

const stripBlockComment = (text: string): string => {
  if (!text.startsWith("/*")) {
    return text
  }
  const inner = text.endsWith("*/") ? text.slice(2, -2) : text.slice(2)
  return inner.replace(/^[!*]/, "")
}

const stripLineComment = (text: string): string => {
  if (text.startsWith("///") || text.startsWith("//!")) {
    return text.slice(3)
  }
  if (text.startsWith("//")) {
    return text.slice(2)
  }
  if (text.startsWith("#")) {
    return text.slice(1)
  }
  return text
}

const firstLineBody = (text: string): string => {
  const stripped = stripLineComment(stripBlockComment(stripHtmlComment(text.trim())))
  const line = stripped.split("\n")[0] ?? ""
  return line.replace(/^\s*\*/, "").trim()
}

export const isMarkedComment = (text: string): boolean => /^@tether(?:\s|$)/.test(firstLineBody(text))

export const declarationName = (node: Node, profile: LanguageProfile): string | undefined => {
  for (const field of profile.name_fields) {
    const named = node.childForFieldName(field)
    if (named !== null) {
      return named.text
    }
  }

  for (const child of node.namedChildren) {
    if (child === null) {
      continue
    }
    for (const field of profile.name_fields) {
      const named = child.childForFieldName(field)
      if (named !== null) {
        return named.text
      }
    }
  }

  for (const child of node.namedChildren) {
    if (child === null) {
      continue
    }
    if (child.type === "identifier" || child.type === "type_identifier" || child.type === "property_identifier") {
      return child.text
    }
  }

  return undefined
}

const remainderIsWhitespace = (
  source: string,
  from: number,
  to: number,
  ranges: readonly (readonly [number, number])[],
): boolean => {
  const ordered = ranges
    .map((range) => [Math.max(range[0], from), Math.min(range[1], to)] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])

  let cursor = from
  for (const [start, end] of ordered) {
    if (start > cursor && !WHITESPACE.test(source.slice(cursor, start))) {
      return false
    }
    if (end > cursor) {
      cursor = end
    }
  }
  return WHITESPACE.test(source.slice(cursor, to))
}

// A callable is a function/method/arrow: it has a body and a parameter list.
const isCallableScope = (node: Node): boolean =>
  node.childForFieldName("body") !== null &&
  (node.childForFieldName("parameters") !== null || node.childForFieldName("parameter") !== null)

// Bind module/type members. Skip declarations nested in a function/method body.
const isInsideFunctionBody = (declaration: Node): boolean => {
  for (let scope = declaration.parent; scope !== null; scope = scope.parent) {
    if (!isCallableScope(scope)) {
      continue
    }
    const body = scope.childForFieldName("body")
    if (
      body !== null &&
      declaration.startIndex >= body.startIndex &&
      declaration.endIndex <= body.endIndex
    ) {
      return true
    }
  }
  return false
}

// Gap may hold whitespace, skip nodes, and an unwrap wrapper that starts in the gap.
const gapAllowed = (
  source: string,
  from: number,
  to: number,
  profile: LanguageProfile,
  root: Node,
): boolean => {
  if (from > to) {
    return false
  }
  if (from === to) {
    return true
  }

  const ignored: Array<[number, number]> = []
  const visit = (node: Node): void => {
    if (node.endIndex <= from || node.startIndex >= to) {
      return
    }

    if ((profile.skip_kinds as readonly string[]).includes(node.type)) {
      ignored.push([node.startIndex, node.endIndex])
      return
    }

    if (
      (profile.unwrap_kinds as readonly string[]).includes(node.type) &&
      node.startIndex >= from &&
      node.startIndex < to &&
      node.endIndex >= to
    ) {
      ignored.push([node.startIndex, to])
    }

    for (const child of childrenIncludingExtras(node)) {
      visit(child)
    }
  }

  visit(root)
  return remainderIsWhitespace(source, from, to, ignored)
}

const collectCommentRun = (
  children: readonly Node[],
  start: number,
  source: string,
  commentKinds: readonly string[],
): { readonly group: Node[]; readonly next: number } => {
  const group: Node[] = []
  let index = start
  while (index < children.length) {
    const child = children[index]
    if (child === undefined || !commentKinds.includes(child.type)) {
      break
    }
    const previous = group[group.length - 1]
    if (previous !== undefined && !WHITESPACE.test(source.slice(previous.endIndex, child.startIndex))) {
      break
    }
    group.push(child)
    index += 1
  }
  return { group, next: index }
}

const collect = (
  node: Node,
  source: string,
  profile: LanguageProfile,
  comments: AdjacentComment[],
  declarations: Node[],
): void => {
  const children = childrenIncludingExtras(node)
  let index = 0
  while (index < children.length) {
    const child = children[index]
    if (child === undefined) {
      index += 1
      continue
    }

    if ((profile.comment_kinds as readonly string[]).includes(child.type)) {
      const { group, next } = collectCommentRun(children, index, source, profile.comment_kinds)
      const first = group[0]
      const last = group[group.length - 1]
      if (first !== undefined && last !== undefined && isMarkedComment(first.text)) {
        comments.push({
          nodes: group,
          startIndex: first.startIndex,
          endIndex: last.endIndex,
          text: source.slice(first.startIndex, last.endIndex),
        })
      }
      index = next
      continue
    }

    if (
      (profile.declaration_kinds as readonly string[]).includes(child.type) &&
      !isInsideFunctionBody(child)
    ) {
      declarations.push(child)
    }

    collect(child, source, profile, comments, declarations)
    index += 1
  }
}

const toBind = (comment: AdjacentComment, declaration: Node, profile: LanguageProfile): AdjacentBind => {
  const name = declarationName(declaration, profile)
  if (name === undefined) {
    return { comment, declaration }
  }
  return { comment, declaration, name }
}

/** `source` is the full file. Node indexes are absolute into it. */
export const collectAdjacentBinds = (
  root: Node,
  source: string,
  profile: LanguageProfile,
): readonly AdjacentBind[] => {
  const comments: AdjacentComment[] = []
  const declarations: Node[] = []
  collect(root, source, profile, comments, declarations)

  const binds: AdjacentBind[] = []
  const claimed = new Set<number>()

  for (const comment of comments) {
    const declaration = declarations.find((node) => node.startIndex >= comment.endIndex)
    if (declaration === undefined || claimed.has(declaration.id)) {
      continue
    }
    if (!gapAllowed(source, comment.endIndex, declaration.startIndex, profile, root)) {
      continue
    }
    claimed.add(declaration.id)
    binds.push(toBind(comment, declaration, profile))
  }

  return binds
}
