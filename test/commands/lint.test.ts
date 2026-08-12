import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FACT_KINDS, type Fact } from "../../src/extract/types"
import { expectJson, runCli } from "../helpers/cli"
import { commitAll, initGitRepo } from "../helpers/git-repo"

interface LintPayload {
  readonly ok: boolean
  readonly command: string
  readonly data: {
    readonly root: string
    readonly facts: readonly Fact[]
    readonly fail_on: readonly string[]
    readonly failed: boolean
  }
}

interface ErrorPayload {
  readonly ok: false
  readonly command?: string
  readonly error: {
    readonly type: string
    readonly message: string
  }
}

const withTempDir = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "tether-lint-cli-"))),
    use,
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )

const lintRoot = (root: string, home: string) =>
  runCli(["lint", JSON.stringify({ root })], { TETHER_HOME: home })

const factsOf = (facts: readonly Fact[], kind: Fact["kind"]) =>
  facts.filter((fact) => fact.kind === kind)

describe("lint command", () => {
  it.effect("prints facts from inline JSON and exits 1 when a fail_on kind is present", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            initGitRepo(root, {
              "NOTES.md": "# homeless\n",
            }),
          )

          const result = yield* lintRoot(root, home)
          const payload = expectJson<LintPayload>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(result.stderr.trim()).toBe("")
          expect(payload.ok).toBe(true)
          expect(payload.command).toBe("lint")
          expect(payload.data.failed).toBe(true)
          expect(payload.data.fail_on).toEqual([...FACT_KINDS])
          expect(payload.data.facts).toContainEqual({ kind: "rogue_document", path: "NOTES.md" })
          expect(JSON.stringify(payload)).not.toMatch(/severity|warning|mild|meaningful/i)
        }),
      ),
    ),
  )

  it.effect("accepts @file and stdin JSON input", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            initGitRepo(root, {
              "NOTES.md": "# homeless\n",
              ".tether.json": JSON.stringify({ fail_on: [] }),
            }),
          )
          const filePath = join(home, "lint.json")
          yield* Effect.promise(() => writeFile(filePath, JSON.stringify({ root })))

          const fileResult = yield* runCli(["lint", `@${filePath}`], { TETHER_HOME: home })
          const filePayload = expectJson<LintPayload>(fileResult.stdout)
          expect(fileResult.exitCode).toBe(0)
          expect(filePayload.data.failed).toBe(false)
          expect(filePayload.data.facts).toContainEqual({ kind: "rogue_document", path: "NOTES.md" })

          const stdinResult = yield* runCli(["lint", "-"], { TETHER_HOME: home }, {
            stdinText: JSON.stringify({ root }),
          })
          const stdinPayload = expectJson<LintPayload>(stdinResult.stdout)
          expect(stdinResult.exitCode).toBe(0)
          expect(stdinPayload.data.failed).toBe(false)
          expect(stdinPayload.data.facts).toContainEqual({ kind: "rogue_document", path: "NOTES.md" })
        }),
      ),
    ),
  )

  it.effect("fails when the root is not a git repository", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          const result = yield* lintRoot(root, home)
          const payload = expectJson<ErrorPayload>(result.stderr)

          expect(result.exitCode).toBe(1)
          expect(payload.ok).toBe(false)
          expect(payload.command).toBe("lint")
          expect(payload.error.type).toBe("NotAGitRepositoryError")
        }),
      ),
    ),
  )

  it.effect("emits ill_formed, host_missing, duplicate_id, and public_surface_stale", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            initGitRepo(root, {
              "src.tether": "@quartz no\ndoc {\n",
              "src/gone.ts.tether": "doc {\nleftover\n}\n",
              "a.ts.tether": "@symbol Shared\ndoc {\none\n}\n",
              "b.ts.tether": "@symbol Shared\ndoc {\ntwo\n}\n",
              "root.tether": "@symbol Host\n@public\ndoc {\npublic doctrine\n}\n",
              "README.md": "# demo\n\n<!-- tether:public -->\n<!-- /tether:public -->\n",
            }),
          )

          const result = yield* lintRoot(root, home)
          const payload = expectJson<LintPayload>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(factsOf(payload.data.facts, "ill_formed")).toContainEqual({
            kind: "ill_formed",
            path: "src.tether",
          })
          expect(factsOf(payload.data.facts, "host_missing")).toContainEqual({
            kind: "host_missing",
            path: "src/gone.ts.tether",
          })
          expect(factsOf(payload.data.facts, "duplicate_id")).toEqual([
            { kind: "duplicate_id", path: "a.ts.tether" },
            { kind: "duplicate_id", path: "b.ts.tether" },
          ])
          expect(factsOf(payload.data.facts, "public_surface_stale")).toEqual([
            { kind: "public_surface_stale", path: "README.md" },
          ])
        }),
      ),
    ),
  )

  it.effect("emits host_fingerprint_changed and not a reformat-only change", () =>
    withTempDir((home) =>
      withTempDir((changed) =>
        withTempDir((reformatted) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              initGitRepo(changed, {
                "src/host.ts": "export function greet(name: string) { return name }\n",
                "src/host.ts.tether": "doc {\nfile doctrine\n}\n",
              }),
            )
            yield* Effect.promise(() =>
              writeFile(
                join(changed, "src/host.ts"),
                "export function greet(name: string) { return name.toUpperCase() }\n",
              ),
            )
            yield* Effect.promise(() => commitAll(changed, "change host"))

            const changedResult = yield* lintRoot(changed, home)
            const changedPayload = expectJson<LintPayload>(changedResult.stdout)
            expect(factsOf(changedPayload.data.facts, "host_fingerprint_changed")).toEqual([
              { kind: "host_fingerprint_changed", path: "src/host.ts.tether" },
            ])

            yield* Effect.promise(() =>
              initGitRepo(reformatted, {
                "src/host.ts": "export function greet(name: string) {\n  return name\n}\n",
                "src/host.ts.tether": "doc {\nfile doctrine\n}\n",
              }),
            )
            yield* Effect.promise(() =>
              writeFile(join(reformatted, "src/host.ts"), "export function greet(name: string){return name}\n"),
            )
            yield* Effect.promise(() => commitAll(reformatted, "reformat host"))

            const reformatResult = yield* lintRoot(reformatted, home)
            const reformatPayload = expectJson<LintPayload>(reformatResult.stdout)
            expect(factsOf(reformatPayload.data.facts, "host_fingerprint_changed")).toEqual([])
          }),
        ),
      ),
    ),
  )

  it.effect("emits ref_missing candidates and ref_fingerprint_changed", () =>
    withTempDir((home) =>
      withTempDir((renamed) =>
        withTempDir((body) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              initGitRepo(renamed, {
                "src/host.ts": "export function greet(name: string) { return name }\n",
                "src/host.ts.tether": "@ref #greet\ndoc {\nnames greet\n}\n",
              }),
            )
            yield* Effect.promise(() =>
              writeFile(join(renamed, "src/host.ts"), "export function hello(name: string) { return name }\n"),
            )
            yield* Effect.promise(() => commitAll(renamed, "rename greet"))

            const renamedResult = yield* lintRoot(renamed, home)
            const renamedPayload = expectJson<LintPayload>(renamedResult.stdout)
            expect(factsOf(renamedPayload.data.facts, "ref_missing")).toEqual([
              {
                kind: "ref_missing",
                path: "src/host.ts.tether",
                candidates: [{ path: "src/host.ts", name: "hello" }],
              },
            ])

            yield* Effect.promise(() =>
              initGitRepo(body, {
                "src/host.ts": "export function greet(name: string) { return name }\n",
                "src/host.ts.tether": "@ref #greet\ndoc {\nnames greet\n}\n",
              }),
            )
            yield* Effect.promise(() =>
              writeFile(
                join(body, "src/host.ts"),
                "export function greet(name: string) { return name.toUpperCase() }\n",
              ),
            )
            yield* Effect.promise(() => commitAll(body, "change greet"))

            const bodyResult = yield* lintRoot(body, home)
            const bodyPayload = expectJson<LintPayload>(bodyResult.stdout)
            expect(factsOf(bodyPayload.data.facts, "ref_fingerprint_changed")).toEqual([
              { kind: "ref_fingerprint_changed", path: "src/host.ts.tether" },
            ])
          }),
        ),
      ),
    ),
  )

  it.effect("reads fail_on and allowlist from .tether.json", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            initGitRepo(root, {
              "NOTES.md": "# notes\n",
              "src.tether": "@quartz no\ndoc {\n",
              "AGENTS.md": "# steer toward tether\n",
              "src/host.ts": "export const value = 1\n",
              ".tether.json": JSON.stringify({
                fail_on: { ill_formed: true, rogue_document: false },
                allowlist: ["NOTES.md"],
              }),
            }),
          )
          yield* Effect.promise(() => writeFile(join(root, "src/host.ts"), "export const value = 2\n"))
          yield* Effect.promise(() => commitAll(root, "change src"))

          const result = yield* lintRoot(root, home)
          const payload = expectJson<LintPayload>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(payload.data.fail_on).toEqual(["ill_formed"])
          expect(factsOf(payload.data.facts, "rogue_document")).toEqual([])
          expect(factsOf(payload.data.facts, "ill_formed")).toContainEqual({
            kind: "ill_formed",
            path: "src.tether",
          })
          expect(payload.data.facts.some((fact) => fact.path === "AGENTS.md")).toBe(false)
          expect(payload.data.facts.every((fact) => FACT_KINDS.includes(fact.kind))).toBe(true)
        }),
      ),
    ),
  )
})
