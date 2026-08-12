import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { python } from "../../src/extract/languages/python"
import { rust } from "../../src/extract/languages/rust"
import { typescript } from "../../src/extract/languages/typescript"
import {
  hasTetherMarker,
  parseComment,
  parseTetherSource,
  unwrapCommentText,
} from "../../src/extract/syntax"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
const fixture = (rel: string) => readFileSync(join(repoRoot, rel), "utf8")

describe("unwrapCommentText", () => {
  it("strips // lines using the typescript profile", () => {
    const raw = "// @tether\n// @symbol greet\n// Greeting is a rename."
    expect(unwrapCommentText(raw, typescript)).toBe("@tether\n@symbol greet\nGreeting is a rename.")
  })

  it("strips # lines using the python profile", () => {
    const raw = "# @tether\n# @symbol greet\n# Adjacency binds this comment to greet."
    expect(unwrapCommentText(raw, python)).toBe(
      "@tether\n@symbol greet\nAdjacency binds this comment to greet.",
    )
  })

  it("strips block and JSDoc stars", () => {
    const raw = "/** @tether\n * @ref ./session.ts#Session\n * Refresh is a rename.\n */"
    expect(unwrapCommentText(raw, typescript).trim()).toBe(
      "@tether\n@ref ./session.ts#Session\nRefresh is a rename.",
    )
  })

  it("strips rust line_comment prefixes", () => {
    const raw = "/// @tether\n/// @symbol greet"
    expect(unwrapCommentText(raw, rust)).toBe("@tether\n@symbol greet")
  })

  it("strips html comments", () => {
    expect(unwrapCommentText("<!-- @tether\n@symbol Foo\n-->", typescript)).toBe(" @tether\n@symbol Foo\n")
  })
})

describe("hasTetherMarker", () => {
  it("requires @tether as the first token", () => {
    expect(hasTetherMarker("// @tether\n// body", typescript)).toBe(true)
    expect(hasTetherMarker("// NOTE: @tether", typescript)).toBe(false)
    expect(hasTetherMarker("/* just a comment */", typescript)).toBe(false)
  })
})

describe("parseTetherSource", () => {
  it("parses closed directives, doc, example, and trailing body", () => {
    const parsed = parseTetherSource(`@symbol Session.refresh
@symbol Session.refresh
@ref ./session.ts#Session
@ref #refreshSession
@ref ./host.ts
@public

doc {
  Refresh is a rename.
}

example ts {
  await refreshSession(cookie)
}

Unfenced trailing body.
`)

    expect(parsed.errors).toEqual([])
    expect(parsed.symbols).toEqual(["Session.refresh"])
    expect(parsed.refs).toEqual([
      { raw: "./session.ts#Session", path: "./session.ts", name: "Session" },
      { raw: "#refreshSession", name: "refreshSession" },
      { raw: "./host.ts", path: "./host.ts" },
    ])
    expect(parsed.public).toBe(true)
    expect(parsed.doc).toBe("Refresh is a rename.\n\nUnfenced trailing body.")
    expect(parsed.examples).toEqual([{ lang: "ts", body: "await refreshSession(cookie)" }])
  })

  it("treats fenced braces inside doc as opaque", () => {
    const parsed = parseTetherSource(`doc {
before
\`\`\`
example ts {
  await refreshSession(cookie)
}
\`\`\`
after
}
`)
    expect(parsed.errors).toEqual([])
    expect(parsed.examples).toEqual([])
    expect(parsed.doc).toContain("example ts {")
    expect(parsed.doc).toContain("after")
  })

  it("parses this repo's root.tether", () => {
    const parsed = parseTetherSource(fixture("root.tether"))
    expect(parsed.errors).toEqual([])
    expect(parsed.symbols).toEqual(["Tether"])
    expect(parsed.refs).toEqual([{ raw: "./skills/tether/SKILL.md", path: "./skills/tether/SKILL.md" }])
    expect(parsed.public).toBe(true)
    expect(parsed.examples).toEqual([])
    expect(parsed.doc).toContain("# Invariants")
    expect(parsed.doc).toContain("Location is the bind")
    expect(parsed.doc).toContain("example ts {")
    expect(parsed.doc).toContain("This file is the repo host")
  })

  it("records ill-formed parse errors without dropping later directives", () => {
    const parsed = parseTetherSource(`@quartz Foo
@symbol
@ref
@ref #
@symbol greet
@public extra
doc {
  unclosed
`)
    expect(parsed.symbols).toEqual(["greet"])
    expect(parsed.public).toBe(true)
    expect(parsed.errors.map((error) => error.reason)).toEqual([
      "unknown_directive",
      "missing_argument",
      "missing_argument",
      "invalid_argument",
      "invalid_argument",
      "unclosed_block",
    ])
  })

  it("allows @tether on a sidecar and same-line remainder", () => {
    const parsed = parseTetherSource("@tether @symbol greet\n@ref #greet\nbody")
    expect(parsed.errors).toEqual([])
    expect(parsed.symbols).toEqual(["greet"])
    expect(parsed.refs).toEqual([{ raw: "#greet", name: "greet" }])
    expect(parsed.doc).toBe("body")
  })
})

describe("parseComment", () => {
  it("parses the typescript adjacency fixture bind", () => {
    const source = fixture("test/fixtures/typescript/adjacency.ts")
    const block = source.split("export function greet")[0] ?? ""
    const parsed = parseComment(block, typescript)
    expect(parsed).toBeDefined()
    expect(parsed?.symbols).toEqual(["greet"])
    expect(parsed?.doc).toContain("Greeting is a rename")
    expect(parsed?.errors).toEqual([])
  })

  it("returns undefined when the comment is not marked", () => {
    expect(parseComment("// just a comment\nexport const x = 1", typescript)).toBeUndefined()
  })
})
