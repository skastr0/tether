import { normalizeRepoPath } from "../extract/resolve"
import type { ExampleBlock, Fact, Host, Tether } from "../extract/types"

export const WIKI_DIR = "wiki"
export const PUBLIC_DIR = "public"
export const PUBLIC_NAV = "nav.md"
export const PUBLIC_START = "<!-- tether:public -->"
export const PUBLIC_END = "<!-- /tether:public -->"

export interface CompileSnapshot {
  readonly tethers: readonly Tether[]
  readonly facts: readonly Fact[]
}

export interface WikiLayer {
  readonly host: Host
  readonly tethers: readonly Tether[]
}

export interface RenderedPage {
  readonly host: Host
  readonly title: string
  readonly relPath: string
  readonly facts: readonly Fact[]
  readonly markdown: string
  readonly public: boolean
}

export interface WikiCompile {
  readonly pages: readonly RenderedPage[]
  readonly publicPages: readonly RenderedPage[]
  readonly publicNav: string
  readonly readmeRegion: string
}

const kindRank = (kind: Host["kind"]): number => {
  switch (kind) {
    case "repository":
      return 0
    case "honorary_folder":
      return 1
    case "folder":
      return 2
    case "file":
      return 3
    case "symbol":
      return 4
  }
}

export const hostKey = (host: Host): string => {
  switch (host.kind) {
    case "symbol":
      return `symbol:${host.path}#${host.name}`
    case "file":
      return `file:${host.path}`
    case "folder":
      return `folder:${host.path}`
    case "repository":
      return "repository:."
    case "honorary_folder":
      return `honorary:${host.path}:${host.file}`
  }
}

const hostName = (host: Host): string => {
  switch (host.kind) {
    case "symbol":
      return host.name
    case "honorary_folder":
      return host.file
    default:
      return ""
  }
}

export const compareHosts = (left: Host, right: Host): number => {
  const byPath = left.path.localeCompare(right.path)
  if (byPath !== 0) {
    return byPath
  }
  const byKind = kindRank(left.kind) - kindRank(right.kind)
  if (byKind !== 0) {
    return byKind
  }
  return hostName(left).localeCompare(hostName(right))
}

const sanitizeSegment = (name: string): string => {
  const cleaned = name.replace(/[\\/]/g, "_").replace(/^\.+$/, "_")
  return cleaned.length > 0 ? cleaned : "_"
}

const posixJoin = (...parts: readonly string[]): string =>
  parts.filter((part) => part.length > 0 && part !== ".").join("/")

export const wikiRelPath = (host: Host): string => {
  switch (host.kind) {
    case "repository":
      return "index.md"
    case "folder":
      return posixJoin(host.path, "index.md") || "index.md"
    case "file":
      return posixJoin(host.path, "index.md")
    case "honorary_folder":
      return posixJoin(host.path, host.file)
    case "symbol":
      return posixJoin(host.path, `${sanitizeSegment(host.name)}.md`)
  }
}

const parentDirs = (repoPath: string): readonly string[] => {
  const normalized = normalizeRepoPath(repoPath)
  if (normalized.length === 0 || normalized === ".") {
    return []
  }
  const parts = normalized.split("/")
  const parents: string[] = []
  for (let index = parts.length - 1; index > 0; index -= 1) {
    parents.push(parts.slice(0, index).join("/"))
  }
  return parents
}

const pushHost = (chain: Host[], host: Host) => {
  const key = hostKey(host)
  if (chain.some((entry) => hostKey(entry) === key)) {
    return
  }
  chain.push(host)
}

/** Innermost first: symbol → file sidecar → enclosing folders → root. */
export const stackHosts = (host: Host): readonly Host[] => {
  const chain: Host[] = []
  pushHost(chain, host)

  switch (host.kind) {
    case "symbol":
      pushHost(chain, { kind: "file", path: host.path })
      for (const folder of parentDirs(host.path)) {
        pushHost(chain, { kind: "folder", path: folder })
      }
      break
    case "file":
      for (const folder of parentDirs(host.path)) {
        pushHost(chain, { kind: "folder", path: folder })
      }
      break
    case "folder":
      for (const folder of parentDirs(host.path)) {
        pushHost(chain, { kind: "folder", path: folder })
      }
      break
    case "honorary_folder":
      if (host.path !== "." && host.path.length > 0) {
        pushHost(chain, { kind: "folder", path: host.path })
      }
      for (const folder of parentDirs(host.path)) {
        pushHost(chain, { kind: "folder", path: folder })
      }
      break
    case "repository":
      return chain
  }

  pushHost(chain, { kind: "repository", path: "." })
  return chain
}

export const displayName = (host: Host, tethers: readonly Tether[]): string => {
  const named = tethers.find((tether) => tether.symbols[0] !== undefined)?.symbols[0]
  if (named !== undefined && named.length > 0) {
    return named
  }
  switch (host.kind) {
    case "symbol":
      return host.name
    case "honorary_folder":
      return host.file
    case "repository":
    case "file":
    case "folder":
      return host.path
  }
}

const yamlScalar = (value: string): string => {
  if (
    value.length === 0 ||
    /^(?:true|false|null|~)$/i.test(value) ||
    /[:#{}[\],&*?<>!%@`'"|]/.test(value) ||
    /\s/.test(value) ||
    /[\n\r]/.test(value) ||
    /^-/.test(value)
  ) {
    return JSON.stringify(value)
  }
  return value
}

export const renderFrontmatter = (facts: readonly Fact[]): string => {
  const lines = ["---"]
  if (facts.length === 0) {
    lines.push("facts: []")
  } else {
    lines.push("facts:")
    for (const fact of facts) {
      lines.push(`  - kind: ${yamlScalar(fact.kind)}`)
      lines.push(`    path: ${yamlScalar(fact.path)}`)
      if (fact.candidates !== undefined && fact.candidates.length > 0) {
        lines.push("    candidates:")
        for (const candidate of fact.candidates) {
          lines.push(`      - path: ${yamlScalar(candidate.path)}`)
          lines.push(`        name: ${yamlScalar(candidate.name)}`)
        }
      }
    }
  }
  lines.push("---")
  return lines.join("\n")
}

const fenceTicks = (body: string): string => {
  let ticks = "```"
  while (body.includes(ticks)) {
    ticks += "`"
  }
  return ticks
}

export const renderExample = (example: ExampleBlock): string => {
  const ticks = fenceTicks(example.body)
  return `${ticks}${example.lang}\n${example.body}\n${ticks}`
}

export const renderTetherBody = (tether: Tether): string => {
  const parts: string[] = []
  if (tether.doc.trim().length > 0) {
    parts.push(tether.doc.replace(/\s+$/u, ""))
  }
  for (const example of tether.examples) {
    parts.push(renderExample(example))
  }
  return parts.join("\n\n")
}

const slug = (text: string): string => {
  const value = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return value.length > 0 ? value : "section"
}

const groupTethers = (tethers: readonly Tether[]): Map<string, Tether[]> => {
  const grouped = new Map<string, Tether[]>()
  for (const tether of tethers) {
    const key = hostKey(tether.host)
    const bucket = grouped.get(key)
    if (bucket === undefined) {
      grouped.set(key, [tether])
    } else {
      bucket.push(tether)
    }
  }
  return grouped
}

const factPaths = (host: Host, tethers: readonly Tether[]): ReadonlySet<string> => {
  const paths = new Set<string>()
  paths.add(host.path)
  if (host.kind === "honorary_folder") {
    paths.add(host.path === "." ? host.file : `${host.path}/${host.file}`)
  }
  for (const tether of tethers) {
    paths.add(tether.path)
    paths.add(tether.host.path)
  }
  return paths
}

const factsFor = (host: Host, tethers: readonly Tether[], facts: readonly Fact[]): readonly Fact[] => {
  const paths = factPaths(host, tethers)
  return facts
    .filter((fact) => paths.has(fact.path))
    .slice()
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path))
}

const hostHasPublic = (tethers: readonly Tether[]): boolean => tethers.some((tether) => tether.public)

const layersFor = (host: Host, grouped: Map<string, Tether[]>): WikiLayer[] => {
  const layers: WikiLayer[] = []
  for (const layerHost of stackHosts(host)) {
    const tethers = grouped.get(hostKey(layerHost)) ?? []
    if (tethers.length > 0) {
      layers.push({ host: layerHost, tethers })
    }
  }
  return layers
}

const filterPublicLayers = (layers: readonly WikiLayer[]): WikiLayer[] =>
  layers
    .map((layer) => ({
      host: layer.host,
      tethers: layer.tethers.filter((tether) => tether.public),
    }))
    .filter((layer) => layer.tethers.length > 0)

const renderSections = (layers: readonly WikiLayer[]): string => {
  const blocks: string[] = []
  layers.forEach((layer, index) => {
    const title = displayName(layer.host, layer.tethers)
    blocks.push(`# ${title}`)
    for (const tether of layer.tethers) {
      const body = renderTetherBody(tether)
      if (body.length > 0) {
        blocks.push(body)
      }
    }
    if (index < layers.length - 1) {
      blocks.push("")
    }
  })
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
}

const renderPage = (
  host: Host,
  layers: readonly WikiLayer[],
  facts: readonly Fact[],
  isPublic: boolean,
): RenderedPage => {
  const included = layers.flatMap((layer) => layer.tethers)
  const own = layers[0]?.tethers ?? []
  const pageFacts = factsFor(host, included, facts)
  const body = renderSections(layers)
  const markdown = `${renderFrontmatter(pageFacts)}\n\n${body}\n`
  return {
    host,
    title: displayName(host, own),
    relPath: wikiRelPath(host),
    facts: pageFacts,
    markdown,
    public: isPublic,
  }
}

export const renderPublicNav = (pages: readonly RenderedPage[]): string => {
  const nav = ["# Public"]
  if (pages.length > 0) {
    nav.push("")
    for (const page of pages) {
      nav.push(`- [${page.title}](./${page.relPath})`)
    }
  }
  nav.push("")
  return nav.join("\n")
}

export const renderReadmeRegion = (tethers: readonly Tether[]): string => {
  const publicTethers = tethers.filter((tether) => tether.public).slice().sort((left, right) => compareHosts(left.host, right.host))
  const lines = ["# Public"]
  if (publicTethers.length === 0) {
    lines.push("")
    return lines.join("\n")
  }
  lines.push("")
  for (const tether of publicTethers) {
    lines.push(`- [${displayName(tether.host, [tether])}](#${slug(displayName(tether.host, [tether]))})`)
  }
  lines.push("")
  for (const tether of publicTethers) {
    const title = displayName(tether.host, [tether])
    lines.push(`## ${title}`)
    lines.push("")
    const body = renderTetherBody(tether)
    if (body.length > 0) {
      lines.push(body)
      lines.push("")
    }
  }
  return lines.join("\n").trimEnd()
}

export const replacePublicRegion = (readme: string, region: string): string | undefined => {
  const start = readme.indexOf(PUBLIC_START)
  const end = readme.indexOf(PUBLIC_END)
  if (start === -1 || end === -1 || end < start) {
    return undefined
  }
  const before = readme.slice(0, start + PUBLIC_START.length)
  const after = readme.slice(end)
  const body = region.length === 0 ? "\n" : `\n${region.replace(/^\n+|\n+$/g, "")}\n`
  return `${before}${body}${after}`
}

export const compileWiki = (snapshot: CompileSnapshot): WikiCompile => {
  const grouped = groupTethers(snapshot.tethers)
  const hosts = snapshot.tethers
    .map((tether) => tether.host)
    .filter((host, index, all) => all.findIndex((entry) => hostKey(entry) === hostKey(host)) === index)
    .sort(compareHosts)

  const pages: RenderedPage[] = []
  const publicPages: RenderedPage[] = []

  for (const host of hosts) {
    const own = grouped.get(hostKey(host)) ?? []
    const layers = layersFor(host, grouped)
    if (layers.length === 0) {
      continue
    }
    pages.push(renderPage(host, layers, snapshot.facts, hostHasPublic(own)))
    if (hostHasPublic(own)) {
      const publicLayers = filterPublicLayers(layers)
      if (publicLayers.length > 0) {
        publicPages.push(renderPage(host, publicLayers, snapshot.facts, true))
      }
    }
  }

  return {
    pages,
    publicPages,
    publicNav: renderPublicNav(publicPages),
    readmeRegion: renderReadmeRegion(snapshot.tethers),
  }
}
