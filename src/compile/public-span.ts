import { createHash } from "node:crypto"

export const PUBLIC_START = "<!-- tether:public -->"
export const PUBLIC_END = "<!-- /tether:public -->"

export interface PublicSpan {
  readonly openStart: number
  readonly openEnd: number
  readonly closeStart: number
  readonly closeEnd: number
  readonly inner: string
}

export interface PublicPageDigest {
  readonly relPath: string
  readonly markdown: string
}

export interface PublicSurfaceHash {
  readonly region: string
  readonly publicTree?: string
}

const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")

const normalizeRegion = (region: string): string => region.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "")

/** Marker is the only content on the line (optional surrounding whitespace). */
const isFenceLine = (line: string, marker: string): boolean => line.trim() === marker

export const findPublicSpan = (readme: string): PublicSpan | undefined => {
  let offset = 0
  let open: { readonly start: number; readonly end: number } | undefined

  while (offset < readme.length) {
    const nl = readme.indexOf("\n", offset)
    const end = nl === -1 ? readme.length : nl + 1
    const content = readme.slice(offset, end).replace(/\r?\n$/, "")

    if (open === undefined) {
      if (isFenceLine(content, PUBLIC_START)) {
        open = { start: offset, end }
      }
    } else if (isFenceLine(content, PUBLIC_END)) {
      return {
        openStart: open.start,
        openEnd: open.end,
        closeStart: offset,
        closeEnd: end,
        inner: readme.slice(open.end, offset),
      }
    }

    offset = end
  }

  return undefined
}

export const hashPublicSurface = (input: {
  readonly region: string
  readonly publicPages: readonly PublicPageDigest[]
}): PublicSurfaceHash => {
  const region = digest(normalizeRegion(input.region))
  if (input.publicPages.length === 0) {
    return { region }
  }

  const tree = input.publicPages
    .slice()
    .sort((left, right) => left.relPath.localeCompare(right.relPath) || left.markdown.localeCompare(right.markdown))
    .map((page) => `${page.relPath}\0${page.markdown}`)
    .join("\0\0")

  return { region, publicTree: digest(tree) }
}
