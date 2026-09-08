import { Effect } from "effect"
import { rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runGit } from "../../src/core/git"
import { readObservedFile } from "../../src/extract/observations"
import * as parser from "../../src/extract/parser"
import { extractRepo } from "../../src/extract/walk"
import { analyzeRepo, lintRepo } from "../../src/facts/lint"
import { withTempDir } from "../helpers/cli"
import { commitAll, initGitRepo } from "../helpers/git-repo"

afterEach(() => vi.restoreAllMocks())

describe("live repository evidence", () => {
  it.each(["unstaged", "staged", "committed"])(
    "observes a %s deletion instead of treating index membership as existence",
    async (state) => {
      await withTempDir("tether-analysis-", async (root) => {
        await initGitRepo(root, {
          "root.tether": "@ref src/target.ts\n@ref src/target.ts#run\nRepository doctrine.\n",
          "src/target.ts": "export function run() { return 1 }\n",
          "src/target.ts.tether": "File doctrine.\n",
          "src.tether": "Folder doctrine.\n",
        })
        await rm(join(root, "src/target.ts"))
        if (state === "staged") await Effect.runPromise(runGit(root, ["add", "-A"]))
        if (state === "committed") await commitAll(root, "delete target")
        const report = await Effect.runPromise(lintRepo(root))
        expect(report.facts).toEqual(
          expect.arrayContaining([
            { kind: "host_missing", path: "src/target.ts.tether" },
            { kind: "ref_missing", path: "root.tether" },
            { kind: "host_fingerprint_changed", path: "src.tether" },
          ]),
        )
        const changed = await Effect.runPromise(
          lintRepo(root, { changed: true, since: state === "committed" ? "HEAD~1" : "HEAD" }),
        )
        expect(changed.facts).toEqual(report.facts)
        expect(report.comparisons).toContainEqual(
          expect.objectContaining({
            path: "root.tether",
            target: { path: "src/target.ts" },
            status: "unchecked",
            reason: "current_target_missing",
          }),
        )
      })
    },
  )

  it("preserves extensionless file hosts on deletion and canonicalizes root references", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, {
        "root.tether": "@ref .\nRepository doctrine.\n",
        script: "echo hello\n",
        "script.tether": "File doctrine.\n",
      })
      await rm(join(root, "script"))
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.tethers.find((tether) => tether.path === "script.tether")?.host).toEqual({
        kind: "file",
        path: "script",
      })
      expect(report.facts).toContainEqual({ kind: "host_missing", path: "script.tether" })
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({
          check: "ref_fingerprint",
          target: { path: "." },
          status: "compared",
        }),
      )
    })
  })

  it("does not read tracked files through a replaced ancestor symlink", async () => {
    await withTempDir("tether-external-", async (external) => {
      await writeFile(
        join(external, "code.ts"),
        "// @tether\n// External doctrine.\nexport const external = 1\n",
      )
      await withTempDir("tether-analysis-", async (root) => {
        await initGitRepo(root, {
          "src/code.ts": "export const original = 1\n",
          "root.tether": "@ref src/code.ts\nRepository doctrine.\n",
        })
        await rm(join(root, "src"), { recursive: true })
        await symlink(external, join(root, "src"), "dir")
        const report = await Effect.runPromise(analyzeRepo(root))
        expect(report.coverage.extraction).toMatchObject({
          status: "partial",
          unchecked: [{ path: "src/code.ts", reason: "symlink" }],
        })
        expect(report.comparisons).toContainEqual(
          expect.objectContaining({
            target: { path: "src/code.ts" },
            status: "unchecked",
            reason: "symlink",
          }),
        )
        expect(JSON.stringify(report)).not.toContain("External doctrine.")
      })
    })
  })

  it("does not call an empty surviving folder missing", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, { "src.tether": "Folder doctrine.\n", "src/a.ts": "export const a = 1\n" })
      await rm(join(root, "src/a.ts"))
      const report = await Effect.runPromise(lintRepo(root))
      expect(report.facts).toEqual([{ kind: "host_fingerprint_changed", path: "src.tether" }])
    })
  })

  it("follows incoming references to files and folder descendants", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, {
        "owner.ts": "export const owner = 1\n",
        "owner.ts.tether": "@ref lib\n@ref lib/target.ts\n@ref lib/target.ts#run\nOwner doctrine.\n",
        "lib/target.ts": "export function run() { return 1 }\n",
      })
      await writeFile(join(root, "lib/target.ts"), "export function run() { return 2 }\n")
      const report = await Effect.runPromise(lintRepo(root, { changed: true }))
      expect(report.facts).toContainEqual({ kind: "ref_fingerprint_changed", path: "owner.ts.tether" })
      const comparisons = report.comparisons.filter((entry) => entry.check === "ref_fingerprint")
      expect(comparisons).toHaveLength(3)
      for (const entry of comparisons) {
        expect(entry.status).toBe("compared")
        if (entry.status === "compared") expect(entry.before).not.toBe(entry.after)
      }
    })
  })

  it("does not pick the first occurrence of repeated method names", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      const first = "export class A {\n// @tether\n// First doctrine.\nrun() { return 1 }\n}\n"
      const second = "export class B {\n// @tether\n// Second doctrine.\nrun() { return 2 }\n}\n"
      await initGitRepo(root, { "code.ts": first + second, "code.ts.tether": "@ref #run\nFile doctrine.\n" })
      await writeFile(join(root, "code.ts"), first + second.replace("return 2", "return 3"))
      const ambiguous = await Effect.runPromise(analyzeRepo(root))
      const hosts = ambiguous.comparisons.filter((entry) => entry.host.kind === "symbol")
      expect(hosts).toHaveLength(2)
      expect(
        hosts.every((entry) => entry.status === "unchecked" && entry.reason === "current_symbol_ambiguous"),
      ).toBe(true)
      expect(ambiguous.facts).not.toContainEqual({ kind: "host_fingerprint_changed", path: "code.ts" })
      expect(ambiguous.facts).not.toContainEqual({ kind: "ref_missing", path: "code.ts.tether" })
      await writeFile(join(root, "code.ts"), second)
      const historical = await Effect.runPromise(analyzeRepo(root))
      expect(historical.comparisons).toContainEqual(
        expect.objectContaining({
          path: "code.ts",
          status: "unchecked",
          reason: "historical_symbol_ambiguous",
          baseline: expect.objectContaining({ method: "inline_blame" }),
        }),
      )
    })
  })

  it("reports missing historical correspondence on rename, not unchanged", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      const source = "// @tether\n// Keep original doctrine.\nexport function before() { return 1 }\n"
      await initGitRepo(root, { "code.ts": source })
      await writeFile(join(root, "code.ts"), source.replace("before()", "after()"))
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.comparisons).toEqual([
        expect.objectContaining({
          target: { path: "code.ts", name: "after" },
          status: "unchecked",
          reason: "historical_symbol_missing",
          baseline: expect.objectContaining({ method: "inline_blame" }),
        }),
      ])
    })
  })

  it("does not substitute a file commit for an uncommitted inline baseline", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, { "code.ts": "export function run() { return 1 }\n" })
      await writeFile(
        join(root, "code.ts"),
        "// @tether\n// This has been approved.\nexport function run() { return 1 }\n",
      )
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.comparisons).toEqual([
        expect.objectContaining({ status: "unchecked", reason: "baseline_unavailable" }),
      ])
      expect(report.comparisons[0]).not.toHaveProperty("baseline")
    })
  })

  it("reports an unavailable historical blob when a target was added after its source", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, { "root.tether": "@ref later.ts\nOriginal doctrine.\n" })
      await writeFile(join(root, "later.ts"), "export const later = 1\n")
      await commitAll(root, "add target")
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({
          check: "ref_fingerprint",
          status: "unchecked",
          reason: "historical_target_missing",
        }),
      )
    })
  })

  it("keeps unexamined symbols distinct from missing symbols", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, {
        "code.ts": "export function run() { return 1 }\n",
        "code.ts.tether": "@symbol run\n@ref #run\nFile doctrine.\n",
      })
      vi.spyOn(parser, "languageReady").mockResolvedValue(false)
      const extracted = await Effect.runPromise(extractRepo(root))
      expect(extracted.facts).toEqual([])
      expect(extracted.coverage.history).toBe("not_performed")
      expect(extracted.coverage.extraction).toMatchObject({
        status: "partial",
        unchecked: [{ path: "code.ts", reason: "grammar_unavailable" }],
      })
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.facts).toEqual([])
      expect(
        report.comparisons.every(
          (entry) => entry.status === "unchecked" && entry.reason === "grammar_unavailable",
        ),
      ).toBe(true)
    })
  })

  it("does not mislabel existing untracked and unsupported targets as absent", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, {
        "root.tether": "@ref new.ts#run\n@ref code.swift#run\nOriginal doctrine.\n",
        "code.swift": "func run() {}\n",
      })
      await writeFile(join(root, "new.ts"), "export function run() {}\n")
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.facts).not.toContainEqual({ kind: "ref_missing", path: "root.tether" })
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({ target: { path: "new.ts", name: "run" }, reason: "not_tracked" }),
      )
      expect(report.comparisons).toContainEqual(
        expect.objectContaining({
          target: { path: "code.swift", name: "run" },
          reason: "unsupported_language",
        }),
      )
    })
  })

  it("fails explicitly on source syntax and I/O errors", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, { "code.ts": "export function broken( {\n" })
      const result = await Effect.runPromise(analyzeRepo(root).pipe(Effect.either))
      expect(result).toMatchObject({
        _tag: "Left",
        left: { _tag: "SourceObservationError", path: "code.ts" },
      })
      await expect(readObservedFile(root, ".")).rejects.toMatchObject({
        _tag: "SourceObservationError",
        path: ".",
      })
    })
  })

  it("retains duplicate IDs within one file and never serializes raw source observations", async () => {
    await withTempDir("tether-analysis-", async (root) => {
      await initGitRepo(root, {
        "code.ts":
          "// @tether\n// @symbol run\n// Inline doctrine.\nexport function run() { return 'implementation-only-sentinel' }\n",
        "code.ts.tether": "@symbol run\nFile doctrine.\n",
      })
      const report = await Effect.runPromise(analyzeRepo(root))
      expect(report.facts.filter((fact) => fact.kind === "duplicate_id")).toEqual([
        { kind: "duplicate_id", path: "code.ts" },
        { kind: "duplicate_id", path: "code.ts.tether" },
      ])
      expect(JSON.stringify(report)).not.toContain("implementation-only-sentinel")
      expect(JSON.stringify(await Effect.runPromise(extractRepo(root)))).not.toContain(
        "implementation-only-sentinel",
      )
    })
  })
})
