import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import {
  extractTracked,
  isHonoraryMarkdown,
  isTetherSidecar,
  statFromTracked,
} from "../../src/extract/walk"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..")
const scratch: string[] = []

const writeTree = async (dir: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("sidecar classification", () => {
  it("classifies .tether files and honorary markdown", () => {
    expect(isTetherSidecar("root.tether")).toBe(true)
    expect(isTetherSidecar("src/foo.ts.tether")).toBe(true)
    expect(isTetherSidecar("src/foo.ts")).toBe(false)
    expect(isTetherSidecar(".tether.json")).toBe(false)
    expect(isHonoraryMarkdown("AGENTS.md")).toBe(true)
    expect(isHonoraryMarkdown("src/CLAUDE.md")).toBe(true)
    expect(isHonoraryMarkdown("README.md")).toBe(false)
  })

  it("stats siblings from the tracked set", () => {
    const stat = statFromTracked(["src/auth.ts", "src/session.ts", "skills/tether/SKILL.md"])
    expect(stat("src/auth.ts")).toBe("file")
    expect(stat("src")).toBe("dir")
    expect(stat("missing")).toBe("missing")
  })
})

describe("extractTracked", () => {
  it("extracts sidecars and adjacent inlines, not honorary markdown", async () => {
    const result = await extractTracked(repoRoot, [
      "root.tether",
      "AGENTS.md",
      "README.md",
      "test/fixtures/typescript/adjacency.ts",
      "test/fixtures/python/bind.py",
    ])

    const root = result.tethers.find((tether) => tether.path === "root.tether")
    expect(root?.host).toEqual({ kind: "repository", path: "." })
    expect(root?.public).toBe(true)
    expect(root?.symbols).toEqual([])

    expect(result.tethers.some((tether) => tether.path === "AGENTS.md")).toBe(false)

    const greets = result.tethers
      .filter(
        (tether) =>
          tether.host.kind === "symbol" &&
          (tether.host.name === "greetTs" || tether.host.name === "greetPy"),
      )
      .map((tether) => tether.path)
      .sort()
    expect(greets).toEqual(["test/fixtures/python/bind.py", "test/fixtures/typescript/adjacency.ts"])
    expect(result.tethers.filter((tether) => tether.path === "README.md")).toEqual([])
    expect(
      result.tethers.some(
        (tether) =>
          tether.path === "test/fixtures/typescript/adjacency.ts" &&
          tether.doc.includes("inside a body"),
      ),
    ).toBe(false)
    expect(result.tethers.some((tether) => tether.path === "test/fixtures/python/bind.py")).toBe(true)
  })

  it("resolves refs after the full declaration pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tether-extract-files-"))
    scratch.push(dir)
    await writeTree(dir, {
      "src/session.ts": `export class Session {}\nexport function refreshSession() { return 1 }\n`,
      "src/auth.ts": `// @tether
// @symbol login
// @ref session.ts#Session
// Login is the session's front door.
export function login() { return 1 }
`,
      "src/auth.ts.tether": `@ref #login
@ref session.ts#refreshSession
doc {
  File doctrine.
}
`,
      "src.tether": `@ref session.ts#Session
doc {
  Folder doctrine.
}
`,
    })

    const result = await extractTracked(dir, [
      "src/session.ts",
      "src/auth.ts",
      "src/auth.ts.tether",
      "src.tether",
    ])

    expect(result.facts).toEqual([])
    expect(result.tethers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/auth.ts",
          host: { kind: "symbol", path: "src/auth.ts", name: "login" },
          symbols: ["login"],
          refs: [{ raw: "session.ts#Session", path: "src/session.ts", name: "Session" }],
        }),
        expect.objectContaining({
          path: "src/auth.ts.tether",
          host: { kind: "file", path: "src/auth.ts" },
          refs: [
            { raw: "#login", path: "src/auth.ts", name: "login" },
            { raw: "session.ts#refreshSession", path: "src/session.ts", name: "refreshSession" },
          ],
        }),
        expect.objectContaining({
          path: "src.tether",
          host: { kind: "folder", path: "src" },
          symbols: [],
        }),
      ]),
    )
  })

  it("skips files with no language profile", async () => {
    await expect(extractTracked(repoRoot, ["README.md"])).resolves.toMatchObject({
      facts: [],
    })
  })

  it("emits ill_formed when a sidecar does not parse", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tether-extract-ill-"))
    scratch.push(dir)
    await writeTree(dir, {
      "src.tether": "@quartz no\ndoc {\n",
    })

    const result = await extractTracked(dir, ["src.tether"])
    expect(result.tethers[0]?.host).toEqual({ kind: "folder", path: "src" })
    expect(result.facts).toEqual([{ kind: "ill_formed", path: "src.tether" }])
  })
})
