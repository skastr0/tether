#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const platform = `${process.platform}-${process.arch}`
if (!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(platform)) {
  console.error(`tether: unsupported platform ${platform}; supports macOS and Linux glibc on arm64/x64`)
  process.exit(1)
}
const name = `@skastr0/tether-${platform}`
let manifest
try {
  manifest = createRequire(import.meta.url).resolve(`${name}/package.json`)
} catch {
  console.error(`tether: missing platform package ${name}. Reinstall @skastr0/tether with optional dependencies enabled.`)
  process.exit(1)
}
const result = spawnSync(join(dirname(manifest), "bin", "tether"), process.argv.slice(2), {
  stdio: "inherit",
})
if (result.error) console.error(`tether: ${result.error.message}`)
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.status ?? 1)
