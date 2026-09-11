import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { expectJson, withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const PROJECT_ROOT = resolve(dirname(import.meta.filename), "../..")
const FIXTURE = resolve(PROJECT_ROOT, "test/fixtures/bunfig-preload")
const BUILD_SCRIPT = resolve(PROJECT_ROOT, "scripts/build-npm-cli.ts")

const compileStandalone = (entry: string, outfile: string, autoloadBunfig: boolean) => {
  const args = ["build", "--compile", "--outfile", outfile]
  if (!autoloadBunfig) {
    args.push("--no-compile-autoload-bunfig")
  }
  args.push(entry)
  const result = spawnSync("bun", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  })
  if (result.status !== 0 || !existsSync(outfile)) {
    throw new Error(
      `bun build --compile failed (${result.status}): ${result.stderr || result.stdout}`,
    )
  }
  chmodSync(outfile, 0o755)
}

describe("standalone bunfig isolation", () => {
  it("disables bunfig autoload in the npm compile recipe", () => {
    expect(readFileSync(BUILD_SCRIPT, "utf8")).toContain("autoloadBunfig: false")
  })

  it("runs a compiled binary from a repo whose bunfig preload is missing", async () => {
    await withTempDir("tether-bunfig-preload-", async (dir) => {
      const repo = join(dir, "repo")
      await initGitRepo(repo, {
        "bunfig.toml": readFileSync(join(FIXTURE, "bunfig.toml"), "utf8"),
        "src/ok.ts": readFileSync(join(FIXTURE, "src/ok.ts"), "utf8"),
      })

      const entry = join(dir, "probe.ts")
      writeFileSync(entry, 'console.log(JSON.stringify({ ok: true }))\n')

      const poisoned = join(dir, "poisoned")
      const isolated = join(dir, "isolated")
      compileStandalone(entry, poisoned, true)
      compileStandalone(entry, isolated, false)

      const bad = spawnSync(poisoned, [], { cwd: repo, encoding: "utf8" })
      expect(bad.status).not.toBe(0)
      expect(bad.stdout.trim()).toBe("")
      expect(bad.stderr).toMatch(/preload not found "@opentui\/solid\/preload"/)

      const good = spawnSync(isolated, [], { cwd: repo, encoding: "utf8" })
      expect(good.status).toBe(0)
      expect(good.stderr).not.toMatch(/preload not found/)
      expect(expectJson<{ ok: boolean }>(good.stdout).ok).toBe(true)
    })
  })
})
