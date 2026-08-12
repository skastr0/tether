import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LANGUAGE_IDS } from "../../src/extract/languages"
import { expectJson, runCli } from "../helpers/cli"

interface DoctorCheck {
  readonly name: string
  readonly ok: boolean
  readonly details?: {
    readonly schema_count?: number
    readonly example_count?: number
    readonly commands?: ReadonlyArray<string>
    readonly loaded_count?: number
    readonly languages?: ReadonlyArray<{
      readonly id: string
      readonly ok: boolean
      readonly missing: boolean
    }>
  }
}

interface DoctorPayload {
  readonly ok: boolean
  readonly command: string
  readonly data: {
    readonly status: string
    readonly languages: ReadonlyArray<string>
    readonly checks: ReadonlyArray<DoctorCheck>
  }
}

const withTempDir = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "tether-doctor-"))),
    use,
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )

const checkByName = (payload: DoctorPayload, name: string) => {
  const check = payload.data.checks.find((entry) => entry.name === name)
  expect(check, name).toBeDefined()
  return check as DoctorCheck
}

describe("doctor command", () => {
  it.effect("reports git, wasm grammars, writable home, and discovery wiring", () =>
    withTempDir((home) =>
      Effect.gen(function* () {
        const result = yield* runCli(["doctor"], { TETHER_HOME: home })
        const payload = expectJson<DoctorPayload>(result.stdout)

        expect(result.exitCode).toBe(0)
        expect(result.stderr.trim()).toBe("")
        expect(payload.ok).toBe(true)
        expect(payload.command).toBe("doctor")
        expect(payload.data.status).toBe("ok")
        expect(payload.data.languages).toEqual([...LANGUAGE_IDS])

        const git = checkByName(payload, "git.repository")
        const wasm = checkByName(payload, "grammars.wasm")
        const homeCheck = checkByName(payload, "home.writable")
        const schema = checkByName(payload, "discovery.schema")
        const examples = checkByName(payload, "discovery.examples")

        expect(git.ok).toBe(true)
        expect(homeCheck.ok).toBe(true)
        expect(schema.ok).toBe(true)
        expect(schema.details?.schema_count).toBeGreaterThanOrEqual(0)
        expect(schema.details?.commands).toEqual(["schema list", "schema show"])
        expect(examples.ok).toBe(true)
        expect(examples.details?.example_count).toBeGreaterThan(0)
        expect(examples.details?.commands).toEqual(["examples list", "examples show"])

        expect(wasm.ok).toBe(true)
        expect(wasm.details?.loaded_count).toBeGreaterThan(0)
        expect(wasm.details?.languages?.map((language) => language.id)).toEqual([...LANGUAGE_IDS])
        expect(
          wasm.details?.languages?.filter((language) => language.ok).map((language) => language.id),
        ).toEqual(expect.arrayContaining(["javascript", "typescript", "tsx"]))
      }),
    ),
  )

  it.effect("fails git.repository for a non-repo root via inline JSON", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          const result = yield* runCli(["doctor", JSON.stringify({ root })], {
            TETHER_HOME: home,
          })
          const payload = expectJson<DoctorPayload>(result.stdout)

          expect(result.exitCode).toBe(1)
          expect(payload.ok).toBe(true)
          expect(payload.data.status).toBe("failed")
          expect(checkByName(payload, "git.repository").ok).toBe(false)
          expect(checkByName(payload, "grammars.wasm").ok).toBe(true)
          expect(checkByName(payload, "home.writable").ok).toBe(true)
        }),
      ),
    ),
  )

  it.effect("accepts @file and stdin JSON input", () =>
    withTempDir((home) =>
      withTempDir((root) =>
        Effect.gen(function* () {
          const filePath = join(home, "probe.json")
          yield* Effect.promise(() => writeFile(filePath, JSON.stringify({ root })))

          const fileResult = yield* runCli(["doctor", `@${filePath}`], { TETHER_HOME: home })
          const filePayload = expectJson<DoctorPayload>(fileResult.stdout)
          expect(fileResult.exitCode).toBe(1)
          expect(checkByName(filePayload, "git.repository").ok).toBe(false)

          const stdinResult = yield* runCli(["doctor", "-"], { TETHER_HOME: home }, {
            stdinText: JSON.stringify({ root }),
          })
          const stdinPayload = expectJson<DoctorPayload>(stdinResult.stdout)
          expect(stdinResult.exitCode).toBe(1)
          expect(checkByName(stdinPayload, "git.repository").ok).toBe(false)
        }),
      ),
    ),
  )

  it.effect("fails home.writable when TETHER_HOME is not a directory", () =>
    withTempDir((home) =>
      Effect.gen(function* () {
        const blocked = join(home, "not-a-dir")
        yield* Effect.promise(() => writeFile(blocked, "nope"))

        const result = yield* runCli(["doctor"], { TETHER_HOME: blocked })
        const payload = expectJson<DoctorPayload>(result.stdout)

        expect(result.exitCode).toBe(1)
        expect(payload.data.status).toBe("failed")
        expect(checkByName(payload, "home.writable").ok).toBe(false)
        expect(checkByName(payload, "git.repository").ok).toBe(true)
      }),
    ),
  )
})
