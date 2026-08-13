import { describe, expect, it } from "vitest"

import { findPublicSpan, hashPublicSurface } from "../../src/compile/public-span"
import {
  compileWiki,
  compareHosts,
  displayName,
  hostKey,
  renderFrontmatter,
  renderTetherBody,
  replacePublicRegion,
  stackHosts,
  wikiRelPath,
} from "../../src/compile/wiki"
import type { Fact, Host, Tether } from "../../src/extract/types"

const tether = (input: Partial<Tether> & Pick<Tether, "path" | "host">): Tether => ({
  symbols: [],
  refs: [],
  public: false,
  doc: "",
  examples: [],
  ...input,
})

const symbolHost = (path: string, name: string): Host => ({ kind: "symbol", path, name })
const fileHost = (path: string): Host => ({ kind: "file", path })
const folderHost = (path: string): Host => ({ kind: "folder", path })
const repoHost: Host = { kind: "repository", path: "." }

describe("stackHosts", () => {
  it("orders symbol → file → enclosing folders → root", () => {
    expect(stackHosts(symbolHost("src/auth.ts", "login"))).toEqual([
      { kind: "symbol", path: "src/auth.ts", name: "login" },
      { kind: "file", path: "src/auth.ts" },
      { kind: "folder", path: "src" },
      { kind: "repository", path: "." },
    ])
    expect(stackHosts(fileHost("src/extract/parser.ts"))).toEqual([
      { kind: "file", path: "src/extract/parser.ts" },
      { kind: "folder", path: "src/extract" },
      { kind: "folder", path: "src" },
      { kind: "repository", path: "." },
    ])
    expect(stackHosts(folderHost("src"))).toEqual([
      { kind: "folder", path: "src" },
      { kind: "repository", path: "." },
    ])
    expect(stackHosts(repoHost)).toEqual([{ kind: "repository", path: "." }])
  })
})

describe("wikiRelPath", () => {
  it("mirrors hosts as a folder tree", () => {
    expect(wikiRelPath(repoHost)).toBe("index.md")
    expect(wikiRelPath(folderHost("src"))).toBe("src/index.md")
    expect(wikiRelPath(fileHost("src/auth.ts"))).toBe("src/auth.ts/index.md")
    expect(wikiRelPath(symbolHost("src/auth.ts", "login"))).toBe("src/auth.ts/login.md")
    expect(wikiRelPath({ kind: "honorary_folder", path: ".", file: "AGENTS.md" })).toBe("AGENTS.md")
  })
})

describe("frontmatter", () => {
  it("serializes facts only", () => {
    const facts: readonly Fact[] = [
      {
        kind: "ref_missing",
        path: "src/auth.ts",
        candidates: [{ path: "src/session.ts", name: "Session" }],
      },
    ]
    const yaml = renderFrontmatter(facts)
    expect(yaml.startsWith("---\n")).toBe(true)
    expect(yaml.endsWith("\n---")).toBe(true)
    expect(yaml).toContain("kind: ref_missing")
    expect(yaml).toContain("path: src/auth.ts")
    expect(yaml).toContain("name: Session")
    expect(yaml).not.toMatch(/^(title|host|severity|age|generated):/m)
    expect(renderFrontmatter([])).toBe("---\nfacts: []\n---")
  })
})

describe("compileWiki", () => {
  const snapshot = {
    tethers: [
      tether({
        path: "src/auth.ts",
        host: symbolHost("src/auth.ts", "login"),
        symbols: ["login"],
        doc: "Symbol body.",
        examples: [{ lang: "ts", body: "login()" }],
        public: true,
      }),
      tether({
        path: "src/auth.ts.tether",
        host: fileHost("src/auth.ts"),
        doc: "File body.",
      }),
      tether({
        path: "src.tether",
        host: folderHost("src"),
        symbols: ["Src"],
        doc: "Folder body.",
        public: true,
      }),
      tether({
        path: "root.tether",
        host: repoHost,
        symbols: ["Tether"],
        doc: "Root body.",
        public: true,
      }),
    ],
    facts: [
      { kind: "ill_formed" as const, path: "src/auth.ts.tether" },
      { kind: "rogue_document" as const, path: "docs/arch.md" },
    ],
  }

  it("stacks bodies innermost first and does not fuse them", () => {
    const compiled = compileWiki(snapshot)
    const login = compiled.pages.find((page) => page.relPath === "src/auth.ts/login.md")
    expect(login).toBeDefined()
    const text = login?.markdown ?? ""
    const symbolAt = text.indexOf("Symbol body.")
    const fileAt = text.indexOf("File body.")
    const folderAt = text.indexOf("Folder body.")
    const rootAt = text.indexOf("Root body.")
    expect(symbolAt).toBeGreaterThan(-1)
    expect(fileAt).toBeGreaterThan(symbolAt)
    expect(folderAt).toBeGreaterThan(fileAt)
    expect(rootAt).toBeGreaterThan(folderAt)
    expect(text).toContain("# login")
    expect(text).toContain("# src/auth.ts")
    expect(text).toContain("# Src")
    expect(text).toContain("# Tether")
    expect(text).toContain("```ts\nlogin()\n```")
    expect(text).not.toContain("Symbol body.File body.")
  })

  it("keeps file pages free of symbol bodies", () => {
    const compiled = compileWiki(snapshot)
    const file = compiled.pages.find((page) => page.relPath === "src/auth.ts/index.md")
    expect(file?.markdown).toContain("File body.")
    expect(file?.markdown).not.toContain("Symbol body.")
  })

  it("attaches matching facts and omits unrelated ones", () => {
    const compiled = compileWiki(snapshot)
    const file = compiled.pages.find((page) => page.relPath === "src/auth.ts/index.md")
    expect(file?.facts).toEqual([{ kind: "ill_formed", path: "src/auth.ts.tether" }])
    expect(file?.markdown).toContain("kind: ill_formed")
    expect(file?.markdown).not.toContain("rogue_document")
    expect(file?.markdown.startsWith("---\nfacts:\n")).toBe(true)
  })

  it("writes public pages only for @public hosts and a generated nav", () => {
    const compiled = compileWiki(snapshot)
    expect(compiled.publicPages.map((page) => page.relPath).sort()).toEqual([
      "index.md",
      "src/auth.ts/login.md",
      "src/index.md",
    ])
    const publicLogin = compiled.publicPages.find((page) => page.relPath === "src/auth.ts/login.md")
    expect(publicLogin?.markdown).toContain("Symbol body.")
    expect(publicLogin?.markdown).not.toContain("File body.")
    expect(compiled.publicNav).toContain("[Tether](./index.md)")
    expect(compiled.publicNav).toContain("[login](./src/auth.ts/login.md)")
    expect(compiled.publicNav).not.toContain("src/auth.ts/index.md")
  })

  it("renders README headings and nav without dumping doctrine bodies", () => {
    const compiled = compileWiki(snapshot)
    expect(compiled.readmeRegion).toContain("# Public")
    expect(compiled.readmeRegion).toContain("- [Tether](#tether)")
    expect(compiled.readmeRegion).toContain("## login")
    expect(compiled.readmeRegion).toContain("Symbol body.")
    expect(compiled.readmeRegion).not.toContain("File body.")
    expect(compiled.readmeRegion).not.toContain("```ts")

    const dump = compileWiki({
      tethers: [
        tether({
          path: "root.tether",
          host: repoHost,
          symbols: ["Tether"],
          public: true,
          doc: "# Invariants\n\nKeep this one line.\n\n# Hosts\n\nDo not dump.",
          examples: [{ lang: "ts", body: "secret()" }],
        }),
      ],
      facts: [],
    })
    expect(dump.readmeRegion).toContain("## Tether")
    expect(dump.readmeRegion).toContain("- [Tether](#tether)")
    expect(dump.readmeRegion).toContain("Keep this one line.")
    expect(dump.readmeRegion).not.toContain("# Invariants")
    expect(dump.readmeRegion).not.toContain("# Hosts")
    expect(dump.readmeRegion).not.toContain("Do not dump.")
    expect(dump.readmeRegion).not.toContain("secret()")
  })
})

describe("public span", () => {
  it("matches whole-line fences and ignores backticks or paragraph mentions", () => {
    const region = "# Public"
    const readme = `# Authored

keep me

See \`<!-- tether:public -->\` and a paragraph <!-- tether:public --> mention.

<!-- tether:public -->
old
<!-- /tether:public -->

after
`
    const span = findPublicSpan(readme)
    expect(span?.inner).toBe("old\n")
    const next = replacePublicRegion(readme, region)
    expect(next).toContain("# Authored")
    expect(next).toContain("keep me")
    expect(next).toContain("`<!-- tether:public -->`")
    expect(next).toContain("paragraph <!-- tether:public --> mention")
    expect(next).toContain("after")
    expect(next).toContain("# Public")
    expect(next).not.toContain("\nold\n")
    expect(replacePublicRegion("# no markers\n", region)).toBeUndefined()
    expect(replacePublicRegion("See `<!-- tether:public -->` only\n<!-- /tether:public -->\n", region)).toBeUndefined()
    expect(findPublicSpan("`<!-- tether:public -->`\n<!-- /tether:public -->\n")).toBeUndefined()

    const indented = "head\n  <!-- tether:public -->  \nbody\n\t<!-- /tether:public -->\n"
    expect(findPublicSpan(indented)?.inner).toBe("body\n")
    expect(replacePublicRegion(indented, "X")).toContain("\nX\n")
  })

  it("hashes the region and public pages independently of page order", () => {
    const pages = [
      { relPath: "b.md", markdown: "B" },
      { relPath: "a.md", markdown: "A" },
    ]
    const hashed = hashPublicSurface({ region: "\n# Public\n", publicPages: pages })
    const swapped = hashPublicSurface({
      region: "# Public",
      publicPages: pages.slice().reverse(),
    })
    expect(hashed.region).toBe(swapped.region)
    expect(hashed.publicTree).toBe(swapped.publicTree)
    expect(hashed.region).toMatch(/^[a-f0-9]{64}$/)
    expect(hashPublicSurface({ region: "", publicPages: [] }).publicTree).toBeUndefined()
    expect(hashPublicSurface({ region: "# Other", publicPages: pages }).region).not.toBe(hashed.region)
  })
})

describe("display helpers", () => {
  it("prefers @symbol for titles and keeps host keys stable", () => {
    expect(displayName(repoHost, [tether({ path: "root.tether", host: repoHost, symbols: ["Tether"] })])).toBe(
      "Tether",
    )
    expect(hostKey(symbolHost("src/auth.ts", "login"))).toBe("symbol:src/auth.ts#login")
    expect(compareHosts(repoHost, folderHost("src"))).toBeLessThan(0)
  })

  it("renders empty docs as empty bodies", () => {
    expect(renderTetherBody(tether({ path: "x", host: repoHost }))).toBe("")
  })
})
