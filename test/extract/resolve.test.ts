import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { python } from "../../src/extract/languages/python"
import { typescript } from "../../src/extract/languages/typescript"
import {
  emitInlineTether,
  emitSidecarTether,
  hostForSidecar,
  makeDeclarationIndex,
  resolveRef,
  symbolMatchesBind,
} from "../../src/extract/resolve"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")

const index = makeDeclarationIndex(
  [
    { path: "src/session.ts", name: "Session" },
    { path: "src/session.ts", name: "refreshSession" },
    { path: "src/auth.ts", name: "login" },
  ],
  ["src/session.ts", "src/auth.ts", "skills/tether/SKILL.md", "src/host.ts"],
)

describe("hostForSidecar", () => {
  it("binds root.tether to the repository", () => {
    expect(hostForSidecar("root.tether")).toEqual({ kind: "repository", path: "." })
  })

  it("binds honorary markdown to its folder", () => {
    expect(hostForSidecar("AGENTS.md")).toEqual({
      kind: "honorary_folder",
      path: ".",
      file: "AGENTS.md",
    })
    expect(hostForSidecar("src/CLAUDE.md")).toEqual({
      kind: "honorary_folder",
      path: "src",
      file: "CLAUDE.md",
    })
  })

  it("distinguishes file and folder stems", () => {
    expect(hostForSidecar("src/auth.ts.tether")).toEqual({ kind: "file", path: "src/auth.ts" })
    expect(
      hostForSidecar("src.tether", (path) => (path === "src" ? "dir" : "missing")),
    ).toEqual({ kind: "folder", path: "src" })
    expect(hostForSidecar("extract.tether")).toEqual({ kind: "folder", path: "extract" })
  })
})

describe("resolveRef", () => {
  const host = { kind: "file" as const, path: "src/auth.ts" }

  it("resolves paths from the repo root and #Name to the host file", () => {
    expect(resolveRef({ raw: "./session.ts#Session", path: "./session.ts", name: "Session" }, host, "src/auth.ts.tether", index)).toEqual({
      raw: "./session.ts#Session",
      path: "session.ts",
      name: "Session",
    })
    expect(resolveRef({ raw: "src/session.ts#Session", path: "src/session.ts", name: "Session" }, host, "src/auth.ts.tether", index)).toEqual({
      raw: "src/session.ts#Session",
      path: "src/session.ts",
      name: "Session",
    })
    expect(resolveRef({ raw: "#login", name: "login" }, host, "src/auth.ts.tether", index)).toEqual({
      raw: "#login",
      path: "src/auth.ts",
      name: "login",
    })
  })

  it("prefers a repo-relative hit when the path is not explicit ./", () => {
    expect(resolveRef({ raw: "src/session.ts#Session", path: "src/session.ts", name: "Session" }, host, "src/auth.ts.tether", index)).toEqual({
      raw: "src/session.ts#Session",
      path: "src/session.ts",
      name: "Session",
    })
  })
})

describe("symbolMatchesBind", () => {
  it("matches exact, member, and parent names", () => {
    expect(symbolMatchesBind("login", "login")).toBe(true)
    expect(symbolMatchesBind("Session.refresh", "refresh")).toBe(true)
    expect(symbolMatchesBind("Session", "Session.refresh")).toBe(true)
    expect(symbolMatchesBind("greet", "login")).toBe(false)
  })
})

describe("emitInlineTether", () => {
  it("emits a symbol-hosted tether and resolves refs", () => {
    const result = emitInlineTether(
      {
        path: "src/auth.ts",
        comment: `// @tether
// @symbol login
// @ref ./session.ts#Session
// Login is the session's front door.
`,
        bind: "login",
        profile: typescript,
      },
      index,
    )
    expect(result.facts).toEqual([])
    expect(result.tether).toMatchObject({
      path: "src/auth.ts",
      host: { kind: "symbol", path: "src/auth.ts", name: "login" },
      symbols: ["login"],
      public: false,
      doc: "Login is the session's front door.",
    })
    expect(result.tether?.refs).toEqual([
      { raw: "./session.ts#Session", path: "session.ts", name: "Session" },
    ])
  })

  it("is ill_formed when @symbol disagrees with adjacency", () => {
    const result = emitInlineTether(
      {
        path: "src/auth.ts",
        comment: "// @tether\n// @symbol greet\n",
        bind: "login",
        profile: typescript,
      },
      index,
    )
    expect(result.tether?.host).toEqual({ kind: "symbol", path: "src/auth.ts", name: "login" })
    expect(result.tether?.symbols).toEqual(["greet"])
    expect(result.facts).toEqual([{ kind: "ill_formed", path: "src/auth.ts" }])
  })

  it("does not emit an unmarked comment", () => {
    expect(
      emitInlineTether({ path: "src/auth.ts", comment: "// not tether", bind: "login", profile: typescript }, index),
    ).toEqual({ facts: [] })
  })

  it("parses a python hash comment", () => {
    const result = emitInlineTether(
      {
        path: "src/greet.py",
        comment: "# @tether\n# @symbol greet\n# Adjacency binds this comment to greet.\n",
        bind: "greet",
        profile: python,
      },
      index,
    )
    expect(result.facts).toEqual([])
    expect(result.tether?.symbols).toEqual(["greet"])
    expect(result.tether?.doc).toContain("Adjacency binds")
  })
})

describe("emitSidecarTether", () => {
  it("does not treat sidecar @symbol as an adjacency mismatch", () => {
    const result = emitSidecarTether(
      {
        path: "src/auth.ts.tether",
        source: `@symbol login
@ref #login
@ref src/session.ts#Session
@ref src/host.ts
doc {
  File doctrine.
}
`,
      },
      index,
    )
    expect(result.facts).toEqual([])
    expect(result.tether?.host).toEqual({ kind: "file", path: "src/auth.ts" })
    expect(result.tether?.symbols).toEqual(["login"])
    expect(result.tether?.refs).toEqual([
      { raw: "#login", path: "src/auth.ts", name: "login" },
      { raw: "src/session.ts#Session", path: "src/session.ts", name: "Session" },
      { raw: "src/host.ts", path: "src/host.ts" },
    ])
    expect(result.tether?.doc).toBe("File doctrine.")
  })

  it("emits ill_formed when a sidecar does not parse", () => {
    const result = emitSidecarTether({ path: "src.tether", source: "@quartz no\ndoc {\n" }, index)
    expect(result.tether?.host).toEqual({ kind: "folder", path: "src" })
    expect(result.facts).toEqual([{ kind: "ill_formed", path: "src.tether" }])
  })

  it("emits root.tether against the declaration index", () => {
    const result = emitSidecarTether(
      { path: "root.tether", source: readFileSync(join(repoRoot, "root.tether"), "utf8") },
      index,
    )
    expect(result.facts).toEqual([])
    expect(result.tether?.host).toEqual({ kind: "repository", path: "." })
    expect(result.tether?.public).toBe(true)
    expect(result.tether?.symbols).toEqual([])
    expect(result.tether?.refs).toEqual([
      { raw: "src/extract/types.ts#Tether", path: "src/extract/types.ts", name: "Tether" },
    ])
  })

  it("does not extract honorary markdown", () => {
    expect(emitSidecarTether({ path: "AGENTS.md", source: "# architecture novel\n" }, index)).toEqual({
      facts: [],
    })
  })

  it("is ill_formed when a folder tether uses @symbol", () => {
    const result = emitSidecarTether({ path: "src.tether", source: "@symbol Src\ndoc {\nFolder.\n}\n" }, index)
    expect(result.tether?.host).toEqual({ kind: "folder", path: "src" })
    expect(result.facts).toContainEqual({ kind: "ill_formed", path: "src.tether" })
  })

  it("is symbol_missing when a file sidecar names an absent declaration", () => {
    const result = emitSidecarTether(
      { path: "src/auth.ts.tether", source: "@symbol Missing\ndoc {\nGone.\n}\n" },
      index,
    )
    expect(result.facts).toContainEqual({ kind: "symbol_missing", path: "src/auth.ts.tether" })
  })
})


