import { createHash } from "node:crypto"
import type { Hash } from "node:crypto"
import type { Node } from "web-tree-sitter"

import type { LanguageProfile } from "./languages/index"

const NAME_PLACEHOLDER = "$NAME"

const isCommentExtra = (node: Node, profile: LanguageProfile): boolean =>
  node.isExtra && (profile.comment_kinds as readonly string[]).includes(node.type)

const addNameFieldIds = (node: Node, profile: LanguageProfile, ids: Set<number>) => {
  for (const field of profile.name_fields) {
    for (const child of node.childrenForFieldName(field)) {
      if (child !== null) {
        ids.add(child.id)
      }
    }
  }
}

// Decl name lives on the node, or one level down (variable_declarator / spec).
const declarationNameIds = (node: Node, profile: LanguageProfile): ReadonlySet<number> => {
  const ids = new Set<number>()
  addNameFieldIds(node, profile, ids)
  if (ids.size === 0) {
    for (const child of node.namedChildren) {
      if (child !== null) {
        addNameFieldIds(child, profile, ids)
      }
    }
  }
  return ids
}

const writePreorder = (
  hash: Hash,
  node: Node,
  profile: LanguageProfile,
  nameIds: ReadonlySet<number> | null,
): void => {
  if (isCommentExtra(node, profile)) {
    return
  }

  hash.update("n")
  hash.update(node.type)
  hash.update("\0")

  if (nameIds?.has(node.id) === true) {
    hash.update("t")
    hash.update(NAME_PLACEHOLDER)
    hash.update("\0")
    return
  }

  if (node.childCount === 0) {
    hash.update("t")
    hash.update(node.text)
    hash.update("\0")
    return
  }

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index)
    if (child !== null) {
      writePreorder(hash, child, profile, nameIds)
    }
  }
}

const digest = (
  node: Node,
  profile: LanguageProfile,
  nameIds: ReadonlySet<number> | null,
): string => {
  const hash = createHash("sha256")
  writePreorder(hash, node, profile, nameIds)
  return `${profile.id}@${node.tree.language.abiVersion}:${hash.digest("hex")}`
}

export const fingerprint = (node: Node, profile: LanguageProfile): string =>
  digest(node, profile, null)

export const shapeFingerprint = (node: Node, profile: LanguageProfile): string =>
  digest(node, profile, declarationNameIds(node, profile))
