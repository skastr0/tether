import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"

import { LintInputSchema } from "../../src/commands/lint"
import { FACT_KINDS, type Fact } from "../../src/extract/types"
import { defaultFailOn, lintRepo } from "../../src/facts/lint"
import { withTempDir } from "../helpers/cli"
import { commitAll, initGitRepo } from "../helpers/git-repo"

const lintRoot = (root: string, extra?: { readonly changed?: boolean; readonly since?: string }) =>
  Effect.runPromise(lintRepo(root, extra))

const factsOf = (facts: readonly Fact[], kind: Fact["kind"]) =>
  facts.filter((fact) => fact.kind === kind)

describe("lint command", () => {
  it("emits facts and fails when a fail_on kind is present", async () => {
    await withTempDir("tether-lint-cli-", async (root) => {
      await initGitRepo(root, {
        "NOTES.md": "# homeless\n",
      })

      const report = await lintRoot(root)
      expect(report.failed).toBe(true)
      expect(report.fail_on).toEqual([...defaultFailOn()])
      expect(report.facts).toContainEqual({ kind: "rogue_document", path: "NOTES.md" })
      expect(JSON.stringify(report)).not.toMatch(/severity|warning|mild|meaningful/i)
    })
  })

  it("accepts leftover fields on the lint input schema", () => {
    expect(Schema.decodeUnknownSync(LintInputSchema)({ root: ".", changed: true })).toEqual({
      root: ".",
      changed: true,
    })
    expect(Schema.decodeUnknownSync(LintInputSchema)({ root: ".", changed: true, since: "HEAD~1" })).toEqual({
      root: ".",
      changed: true,
      since: "HEAD~1",
    })
  })

  it("fails when the root is not a git repository", async () => {
    await withTempDir("tether-lint-cli-", async (root) => {
      const result = await Effect.runPromise(lintRepo(root).pipe(Effect.either))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toMatchObject({ _tag: "NotAGitRepositoryError" })
      }
    })
  })

  it("emits ill_formed, host_missing, duplicate_id, and public_surface_stale", async () => {
    await withTempDir("tether-lint-cli-", async (root) => {
      await initGitRepo(root, {
        "src.tether": "@quartz no\ndoc {\n",
        "src/gone.ts.tether": "doc {\nleftover\n}\n",
        "a.ts.tether": "@symbol Shared\ndoc {\none\n}\n",
        "b.ts.tether": "@symbol Shared\ndoc {\ntwo\n}\n",
        "root.tether": "@public\ndoc {\npublic doctrine\n}\n",
        "README.md": "# demo\n\n<!-- tether:public -->\n<!-- /tether:public -->\n",
      })

      const report = await lintRoot(root)
      expect(report.failed).toBe(true)
      expect(factsOf(report.facts, "ill_formed")).toContainEqual({
        kind: "ill_formed",
        path: "src.tether",
      })
      expect(factsOf(report.facts, "host_missing")).toContainEqual({
        kind: "host_missing",
        path: "src/gone.ts.tether",
      })
      expect(factsOf(report.facts, "duplicate_id")).toEqual([
        { kind: "duplicate_id", path: "a.ts.tether" },
        { kind: "duplicate_id", path: "b.ts.tether" },
      ])
      expect(factsOf(report.facts, "public_surface_stale")).toEqual([
        { kind: "public_surface_stale", path: "README.md" },
      ])
    })
  })

  it("emits host_fingerprint_changed and not a reformat-only change", async () => {
    await withTempDir("tether-lint-cli-", async (changed) => {
      await withTempDir("tether-lint-cli-", async (reformatted) => {
        await initGitRepo(changed, {
          "src/host.ts": "export function greet(name: string) { return name }\n",
          "src/host.ts.tether": "doc {\nfile doctrine\n}\n",
        })
        await writeFile(
          join(changed, "src/host.ts"),
          "export function greet(name: string) { return name.toUpperCase() }\n",
        )
        await commitAll(changed, "change host")

        const changedReport = await lintRoot(changed)
        expect(changedReport.failed).toBe(false)
        expect(changedReport.fail_on).not.toContain("host_fingerprint_changed")
        expect(factsOf(changedReport.facts, "host_fingerprint_changed")).toEqual([
          { kind: "host_fingerprint_changed", path: "src/host.ts.tether" },
        ])

        await initGitRepo(reformatted, {
          "src/host.ts": "export function greet(name: string) {\n  return name\n}\n",
          "src/host.ts.tether": "doc {\nfile doctrine\n}\n",
        })
        await writeFile(join(reformatted, "src/host.ts"), "export function greet(name: string){return name}\n")
        await commitAll(reformatted, "reformat host")

        const reformatReport = await lintRoot(reformatted)
        expect(factsOf(reformatReport.facts, "host_fingerprint_changed")).toEqual([])
      })
    })
  })

  it("emits ref_missing candidates and ref_fingerprint_changed", async () => {
    await withTempDir("tether-lint-cli-", async (renamed) => {
      await withTempDir("tether-lint-cli-", async (body) => {
        await initGitRepo(renamed, {
          "src/host.ts": "export function greet(name: string) { return name }\n",
          "src/host.ts.tether": "@ref #greet\ndoc {\nnames greet\n}\n",
        })
        await writeFile(join(renamed, "src/host.ts"), "export function hello(name: string) { return name }\n")
        await commitAll(renamed, "rename greet")

        const renamedReport = await lintRoot(renamed)
        expect(factsOf(renamedReport.facts, "ref_missing")).toEqual([
          {
            kind: "ref_missing",
            path: "src/host.ts.tether",
            candidates: [{ path: "src/host.ts", name: "hello" }],
          },
        ])

        await initGitRepo(body, {
          "src/host.ts": "export function greet(name: string) { return name }\n",
          "src/host.ts.tether": "@ref #greet\ndoc {\nnames greet\n}\n",
        })
        await writeFile(
          join(body, "src/host.ts"),
          "export function greet(name: string) { return name.toUpperCase() }\n",
        )
        await commitAll(body, "change greet")

        const bodyReport = await lintRoot(body)
        expect(bodyReport.failed).toBe(false)
        expect(bodyReport.fail_on).not.toContain("ref_fingerprint_changed")
        expect(factsOf(bodyReport.facts, "ref_fingerprint_changed")).toEqual([
          { kind: "ref_fingerprint_changed", path: "src/host.ts.tether" },
        ])
      })
    })
  })

  it("reads fail_on and allowlist from .tether.json", async () => {
    await withTempDir("tether-lint-cli-", async (root) => {
      await initGitRepo(root, {
        "NOTES.md": "# notes\n",
        "src.tether": "@quartz no\ndoc {\n",
        "AGENTS.md": "# steer toward tether\n",
        "src/host.ts": "export const value = 1\n",
        ".tether.json": JSON.stringify({
          fail_on: { ill_formed: true, rogue_document: false },
          allowlist: ["NOTES.md"],
        }),
      })
      await writeFile(join(root, "src/host.ts"), "export const value = 2\n")
      await commitAll(root, "change src")

      const report = await lintRoot(root)
      expect(report.failed).toBe(true)
      expect(report.fail_on).toEqual(["ill_formed"])
      expect(factsOf(report.facts, "rogue_document")).toEqual([])
      expect(factsOf(report.facts, "ill_formed")).toContainEqual({
        kind: "ill_formed",
        path: "src.tether",
      })
      expect(report.facts.some((fact) => fact.path === "AGENTS.md")).toBe(false)
      expect(report.facts.every((fact) => FACT_KINDS.includes(fact.kind))).toBe(true)
    })
  })

  it("changed:true only reports facts on touched paths", async () => {
    await withTempDir("tether-lint-cli-", async (root) => {
      await initGitRepo(root, {
        "NOTES.md": "# homeless\n",
        "src.tether": "@quartz no\ndoc {\n",
        "src/host.ts": "export function greet(name: string) { return name }\n",
        "src/host.ts.tether": "@ref #gone\ndoc {\nnames a missing symbol\n}\n",
      })

      const full = await lintRoot(root)
      expect(factsOf(full.facts, "rogue_document")).toContainEqual({
        kind: "rogue_document",
        path: "NOTES.md",
      })
      expect(factsOf(full.facts, "ill_formed")).toContainEqual({
        kind: "ill_formed",
        path: "src.tether",
      })
      expect(factsOf(full.facts, "ref_missing")).toContainEqual({
        kind: "ref_missing",
        path: "src/host.ts.tether",
      })

      const clean = await lintRoot(root, { changed: true })
      expect(clean.facts).toEqual([])
      expect(clean.failed).toBe(false)

      await writeFile(join(root, "NOTES.md"), "# homeless still\n")
      const notesOnly = await lintRoot(root, { changed: true })
      expect(notesOnly.facts).toEqual([{ kind: "rogue_document", path: "NOTES.md" }])

      await writeFile(join(root, "src/host.ts"), "export function greet(name: string) { return name.toUpperCase() }\n")
      const hostTouched = await lintRoot(root, { changed: true })
      expect(factsOf(hostTouched.facts, "rogue_document")).toEqual([
        { kind: "rogue_document", path: "NOTES.md" },
      ])
      expect(factsOf(hostTouched.facts, "ref_missing")).toEqual([
        { kind: "ref_missing", path: "src/host.ts.tether" },
      ])
      expect(factsOf(hostTouched.facts, "ill_formed")).toEqual([])

      await commitAll(root, "touch notes and host")
      await writeFile(join(root, "src.tether"), "@quartz still no\ndoc {\n")
      const leftover = await lintRoot(root, { changed: true, since: "HEAD" })
      expect(leftover.facts.every((entry) => entry.path === "src.tether")).toBe(true)
      expect(factsOf(leftover.facts, "ill_formed")).toEqual([{ kind: "ill_formed", path: "src.tether" }])
      expect(factsOf(leftover.facts, "rogue_document")).toEqual([])
      expect(factsOf(leftover.facts, "ref_missing")).toEqual([])

      const sinceParent = await lintRoot(root, { changed: true, since: "HEAD~1" })
      expect(factsOf(sinceParent.facts, "rogue_document")).toEqual([
        { kind: "rogue_document", path: "NOTES.md" },
      ])
      expect(factsOf(sinceParent.facts, "ill_formed")).toEqual([
        { kind: "ill_formed", path: "src.tether" },
      ])
      expect(factsOf(sinceParent.facts, "ref_missing")).toEqual([
        { kind: "ref_missing", path: "src/host.ts.tether" },
      ])
    })
  })
})
