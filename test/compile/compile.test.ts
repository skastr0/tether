import { readFile, realpath, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { hashRepoRoot } from "../../src/core/git"
import { expectJson, runCli, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

interface CompileEnvelope {
  readonly ok: boolean
  readonly command?: string
  readonly data?: {
    readonly root: string
    readonly git_key: string
    readonly project_dir: string
    readonly wiki_dir: string
    readonly public_dir: string
    readonly wiki_pages: readonly string[]
    readonly public_pages: readonly string[]
    readonly readme_updated: boolean
    readonly tether_count: number
    readonly public_count: number
  }
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly details?: { readonly field?: string; readonly source?: string; readonly reason?: string }
  }
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe("compile command", () => {
  it("writes wiki and public trees under TETHER_HOME, never the repo", async () => {
    await withTempDir("tether-compile-home-", async (home) => {
      await withTempDir("tether-compile-cli-", async (dir) => {
        await initGitRepo(dir, {
          "root.tether": `@ref src/auth.ts
@public
doc {
  Repo doctrine.
}
`,
          "src.tether": `@public
doc {
  Folder doctrine.
}
`,
          "src/auth.ts.tether": `doc {
  File doctrine.
}
`,
          "README.md": `# Authored\n\nkeep\n\n<!-- tether:public -->\nold\n<!-- /tether:public -->\n\ntail\n`,
        })

        const result = await runCli(["compile", JSON.stringify({ root: dir })], { TETHER_HOME: home })
        if (result.stdout.trim().length === 0) {
          throw new Error(`compile produced no stdout (exit ${result.exitCode}): ${result.stderr}`)
        }
        const payload = expectJson<CompileEnvelope>(result.stdout)
        expect(result.exitCode).toBe(0)
        expect(result.stderr.trim()).toBe("")
        expect(payload.ok).toBe(true)
        expect(payload.command).toBe("compile")
        const resolvedDir = await realpath(dir)
        const resolvedHome = await realpath(home)
        expect(payload.data?.root).toBe(resolvedDir)
        expect(payload.data?.git_key).toBe(hashRepoRoot(payload.data?.root ?? dir))
        expect(await realpath(payload.data?.project_dir ?? home)).toContain(resolvedHome)
        expect(payload.data?.wiki_dir).toBe(join(payload.data?.project_dir ?? "", "wiki"))
        expect(payload.data?.readme_updated).toBe(true)
        expect(payload.data?.wiki_pages).toEqual(expect.arrayContaining(["index.md", "src/index.md", "src/auth.ts/index.md"]))
        expect(payload.data?.public_pages).toEqual(expect.arrayContaining(["index.md", "src/index.md"]))
        expect(payload.data?.public_pages).not.toContain("src/auth.ts/index.md")

        const wikiIndex = await readFile(join(payload.data?.wiki_dir ?? "", "index.md"), "utf8")
        const filePage = await readFile(join(payload.data?.wiki_dir ?? "", "src/auth.ts/index.md"), "utf8")
        const nav = await readFile(join(payload.data?.public_dir ?? "", "nav.md"), "utf8")
        const readme = await readFile(join(dir, "README.md"), "utf8")

        expect(wikiIndex.startsWith("---\nfacts: []\n---")).toBe(true)
        expect(wikiIndex).toContain("Repo doctrine.")
        expect(filePage).toContain("File doctrine.")
        expect(filePage).toContain("Folder doctrine.")
        expect(filePage).toContain("Repo doctrine.")
        const fileAt = filePage.indexOf("File doctrine.")
        const folderAt = filePage.indexOf("Folder doctrine.")
        const rootAt = filePage.indexOf("Repo doctrine.")
        expect(fileAt).toBeLessThan(folderAt)
        expect(folderAt).toBeLessThan(rootAt)
        expect(nav).toContain("[.](./index.md)")
        expect(nav).toContain("[src](./src/index.md)")
        expect(nav).not.toContain("src/auth.ts/index.md")
        expect(readme).toContain("# Authored")
        expect(readme).toContain("keep")
        expect(readme).toContain("tail")
        expect(readme).toContain("## .")
        expect(readme).not.toContain("\nold\n")
        expect(await exists(join(dir, "wiki"))).toBe(false)
        expect(await exists(join(dir, ".tether"))).toBe(false)
        expect(await exists(join(dir, "public"))).toBe(false)
      })
    })
  })

  it("accepts @file and stdin JSON and leaves README without markers untouched", async () => {
    await withTempDir("tether-compile-home-", async (home) => {
      await withTempDir("tether-compile-cli-", async (dir) => {
        await initGitRepo(dir, {
          "root.tether": `@public
doc {
  Repo doctrine.
}
`,
          "README.md": "# Authored only\n",
        })
        const payloadPath = join(dir, "input.json")
        await writeFile(payloadPath, JSON.stringify({ root: dir }))

        const fromFile = await runCli(["compile", `@${payloadPath}`], { TETHER_HOME: home })
        const fromStdin = await runCli(["compile", "-"], { TETHER_HOME: home }, { stdinText: JSON.stringify({ root: dir }) })
        if (fromFile.exitCode !== 0) {
          throw new Error(`@file compile failed (exit ${fromFile.exitCode}): ${fromFile.stderr || fromFile.stdout}`)
        }
        const readme = await readFile(join(dir, "README.md"), "utf8")

        expect(fromFile.exitCode).toBe(0)
        expect(fromStdin.exitCode).toBe(0)
        expect(expectJson<CompileEnvelope>(fromFile.stdout).data?.tether_count).toBe(1)
        expect(expectJson<CompileEnvelope>(fromStdin.stdout).data?.readme_updated).toBe(false)
        expect(readme).toBe("# Authored only\n")
      })
    })
  })

  it("puts extract facts in frontmatter and rejects bad input", async () => {
    await withTempDir("tether-compile-home-", async (home) => {
      await withTempDir("tether-compile-cli-", async (dir) => {
        await initGitRepo(dir, {
          "src.tether": `@quartz no\ndoc {\n`,
        })

        const result = await runCli(["compile", JSON.stringify({ root: dir })], { TETHER_HOME: home })
        if (result.stdout.trim().length === 0) {
          throw new Error(`compile produced no stdout (exit ${result.exitCode}): ${result.stderr}`)
        }
        const payload = expectJson<CompileEnvelope>(result.stdout)
        expect(result.exitCode).toBe(0)
        const page = await readFile(join(payload.data?.wiki_dir ?? "", "src/index.md"), "utf8")
        expect(page).toContain("kind: ill_formed")
        expect(page).toContain("path: src.tether")

        const invalid = await runCli(["compile", "not-json"], { TETHER_HOME: home })
        expect(invalid.exitCode).toBe(1)
        expect(expectJson<CompileEnvelope>(invalid.stderr).error?.type).toBe("JsonInputError")

        const emptyRoot = await runCli(["compile", '{"root":"   "}'], { TETHER_HOME: home })
        expect(emptyRoot.exitCode).toBe(1)
        expect(expectJson<CompileEnvelope>(emptyRoot.stderr).error?.details?.field).toBe("root")

        await withTempDir("tether-compile-nogit-", async (notRepoDir) => {
          const notRepo = await runCli(["compile", JSON.stringify({ root: notRepoDir })], { TETHER_HOME: home })
          expect(notRepo.exitCode).toBe(1)
          expect(expectJson<CompileEnvelope>(notRepo.stderr).error?.type).toBe("NotAGitRepositoryError")
        })
      })
    })
  })
})
