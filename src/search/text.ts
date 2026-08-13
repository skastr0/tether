import type { ExampleBlock, Host, Ref } from "../extract/types"

export interface EmbeddableTether {
  readonly doc: string
  readonly symbols: readonly string[]
  readonly refs: readonly Ref[]
}

const FTS_RESERVED = new Set(["and", "or", "not", "near"])

const quoteFtsLiteral = (value: string): string => `"${value.replaceAll('"', '""')}"`

export const compileFtsQuery = (raw: string): string | undefined => {
  const parts: string[] = []
  const token = /"([^"]+)"|(\S+)/g
  let match = token.exec(raw)
  while (match !== null) {
    const phrase = match[1]
    const loose = match[2]
    if (phrase !== undefined) {
      const trimmed = phrase.trim()
      if (trimmed.length > 0) {
        parts.push(quoteFtsLiteral(trimmed))
      }
    } else if (loose !== undefined) {
      const terms = loose.match(/[\p{L}\p{N}_-]+/gu) ?? []
      for (const term of terms) {
        if (FTS_RESERVED.has(term.toLowerCase())) {
          continue
        }
        parts.push(quoteFtsLiteral(term))
      }
    }
    match = token.exec(raw)
  }
  return parts.length === 0 ? undefined : parts.join(" AND ")
}

export const hostSearchText = (host: Host): string => {
  switch (host.kind) {
    case "symbol":
      return `symbol ${host.path} ${host.name}`
    case "file":
      return `file ${host.path}`
    case "folder":
      return `folder ${host.path}`
    case "repository":
      return "repository ."
    case "honorary_folder":
      return `honorary_folder ${host.path} ${host.file}`
  }
}

export const refsSearchText = (refs: readonly Ref[]): string =>
  refs
    .map((ref) => (ref.name === undefined ? `${ref.raw} ${ref.path}` : `${ref.raw} ${ref.path} ${ref.name}`))
    .join(" ")

export const examplesSearchText = (examples: readonly ExampleBlock[]): string =>
  examples.map((example) => `example ${example.lang}\n${example.body}`).join("\n\n")

export const tetherEmbedText = (tether: EmbeddableTether): string =>
  [tether.doc, tether.symbols.join(" "), refsSearchText(tether.refs)].join("\n")

export const rowEmbedText = (row: { readonly doc: string; readonly symbols: string; readonly refs: string }): string =>
  [row.doc, row.symbols, row.refs].join("\n")

export const fallbackSnippet = (doc: string): string => {
  const trimmed = doc.trim()
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}…`
}

export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`)
