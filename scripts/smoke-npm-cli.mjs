#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

const WRAPPER_NAME = "@skastr0/tether"
const PLATFORM_PACKAGES = {
  "darwin-arm64": "@skastr0/tether-darwin-arm64",
  "darwin-x64": "@skastr0/tether-darwin-x64",
  "linux-arm64": "@skastr0/tether-linux-arm64",
  "linux-x64": "@skastr0/tether-linux-x64",
}
const EXPECTED_NAMES = [WRAPPER_NAME, ...Object.values(PLATFORM_PACKAGES)]
const SMOKE_TOKEN = "SMOKE_NPM_CLI_q9z"
const EXPECTED_SYMBOLS = [
  "greetJs",
  "greetTs",
  "greetTsx",
  "greetRs",
  "greetGo",
  "greetRb",
  "greetPy",
]
const FUSION_FALLBACK_REASON =
  "SYNTHETIC_API_KEY is not set; fusion ranks lexical FTS5 hits only"

const usage = () => {
  throw new Error(
    "usage: node scripts/smoke-npm-cli.mjs <absolute-tarball-directory> [--registry]",
  )
}

const fail = (message) => {
  throw new Error(message)
}

const asRecord = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

const asString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`)
  }
  return value
}

const parseJson = (text, label) => {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    fail(`${label} was empty`)
  }
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(`${label} was not JSON (${detail}):\n${text}`)
  }
}

const sha512Sri = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`

const which = (name) => {
  const dirs = (process.env.PATH ?? "").split(":")
  for (const dir of dirs) {
    if (dir.length === 0) continue
    const candidate = join(dir, name)
    try {
      const stat = lstatSync(candidate)
      if (stat.isFile() || stat.isSymbolicLink()) {
        return candidate
      }
    } catch {
      // keep looking
    }
  }
  return undefined
}

const ensureDir = (path) => {
  mkdirSync(path, { recursive: true })
  return path
}

const writeText = (path, contents) => {
  ensureDir(dirname(path))
  writeFileSync(path, contents)
}

const walkFiles = (root) => {
  /** @type {string[]} */
  const files = []
  const visit = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  visit(root)
  return files
}

const symlinkIfMissing = (target, dest) => {
  if (existsSync(dest) || target === undefined || !existsSync(target)) {
    return
  }
  try {
    symlinkSync(target, dest)
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined
    if (code !== "EEXIST") {
      throw error
    }
  }
}

const populateIsolatedBin = (binDir) => {
  ensureDir(binDir)
  symlinkIfMissing(process.execPath, join(binDir, "node"))
  const git = which("git")
  if (git === undefined) {
    fail("git is required on PATH to initialize the smoke repository")
  }
  symlinkIfMissing(git, join(binDir, "git"))

  const skip = new Set(["bun", "bunx"])
  for (const dir of ["/bin", "/usr/bin", "/usr/sbin"]) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (skip.has(name) || name.startsWith("bun")) {
        continue
      }
      symlinkIfMissing(join(dir, name), join(binDir, name))
    }
  }
  chmodSync(binDir, 0o755)
  return binDir
}

const run = (command, args, options) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) {
    fail(`${options.label} failed to start: ${result.error.message}`)
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

const runChecked = (command, args, options) => {
  const result = run(command, args, options)
  if (result.status !== 0) {
    fail(
      `${options.label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
  }
  return result
}

const loadManifest = (tarballDir) => {
  const manifestPath = join(tarballDir, "manifest.json")
  if (!existsSync(manifestPath)) {
    fail(`missing ${manifestPath}`)
  }
  const raw = parseJson(readFileSync(manifestPath, "utf8"), "manifest.json")
  if (!Array.isArray(raw) || raw.length !== 5) {
    fail("manifest.json must be an array of five packages")
  }

  const entries = raw.map((item, index) => {
    const row = asRecord(item, `manifest.json[${index}]`)
    const name = asString(row.name, `manifest.json[${index}].name`)
    const version = asString(row.version, `manifest.json[${index}].version`)
    const filename = asString(row.filename, `manifest.json[${index}].filename`)
    const integrity = asString(row.integrity, `manifest.json[${index}].integrity`)
    const platform =
      row.platform === undefined
        ? undefined
        : asString(row.platform, `manifest.json[${index}].platform`)
    return { name, version, filename, integrity, platform }
  })

  const names = entries.map((entry) => entry.name).sort()
  const expected = [...EXPECTED_NAMES].sort()
  if (names.join("\n") !== expected.join("\n")) {
    fail(`manifest names must be ${EXPECTED_NAMES.join(", ")}; got ${names.join(", ")}`)
  }

  const versions = new Set(entries.map((entry) => entry.version))
  if (versions.size !== 1) {
    fail(`all five packages must share one version; got ${[...versions].join(", ")}`)
  }

  for (const entry of entries) {
    const tarballPath = join(tarballDir, entry.filename)
    if (!existsSync(tarballPath)) {
      fail(`missing tarball ${tarballPath}`)
    }
    const actual = sha512Sri(readFileSync(tarballPath))
    if (actual !== entry.integrity) {
      fail(`SRI mismatch for ${entry.filename}: expected ${entry.integrity}, got ${actual}`)
    }
    if (entry.name !== WRAPPER_NAME) {
      const expectedPlatform = Object.entries(PLATFORM_PACKAGES).find(([, pkg]) => pkg === entry.name)?.[0]
      if (expectedPlatform === undefined) {
        fail(`unexpected package ${entry.name}`)
      }
      if (entry.platform !== undefined && entry.platform !== expectedPlatform) {
        fail(`${entry.name} platform must be ${expectedPlatform}, got ${entry.platform}`)
      }
    }
  }

  return entries
}

const hostPlatform = () => {
  const key = `${process.platform}-${process.arch}`
  const name = PLATFORM_PACKAGES[key]
  if (name === undefined) {
    fail(`unsupported host platform ${key}`)
  }
  return { key, name }
}

const fixtureFiles = () => ({
  "src/js/greet.js": `// @tether
// @symbol greetJs
// ${SMOKE_TOKEN} javascript greeting is a rename of the caller's name.
export function greetJs(name) {
  return name
}
`,
  "src/ts/greet.ts": `// @tether
// @symbol greetTs
// ${SMOKE_TOKEN} typescript greeting is a rename of the caller's name.
export function greetTs(name: string): string {
  return name
}
`,
  "src/tsx/greet.tsx": `// @tether
// @symbol greetTsx
// ${SMOKE_TOKEN} tsx greeting is a rename of the caller's name.
export function greetTsx(name: string): string {
  return name
}
`,
  "src/rs/greet.rs": `// @tether
// @symbol greetRs
// ${SMOKE_TOKEN} rust say hello.
pub fn greetRs() {
    println!("hi");
}
`,
  "src/go/greet.go": `package sample

// @tether
// @symbol greetGo
// ${SMOKE_TOKEN} golang greeting is a rename of the caller's name.
func greetGo() {}
`,
  "src/rb/greet.rb": `# @tether
# @symbol greetRb
# ${SMOKE_TOKEN} ruby greet is a rename of a greeting.
def greetRb(name)
  name
end
`,
  "src/py/greet.py": `# @tether
# @symbol greetPy
# ${SMOKE_TOKEN} python adjacency binds this comment to greetPy.
def greetPy(name: str) -> str:
    return name
`,
})

const initGitRepo = (repoDir, env) => {
  ensureDir(repoDir)
  for (const [rel, contents] of Object.entries(fixtureFiles())) {
    writeText(join(repoDir, rel), contents)
  }
  runChecked("git", ["init"], { cwd: repoDir, env, label: "git init" })
  runChecked("git", ["config", "user.name", "tether-smoke"], {
    cwd: repoDir,
    env,
    label: "git config user.name",
  })
  runChecked("git", ["config", "user.email", "tether-smoke@example.com"], {
    cwd: repoDir,
    env,
    label: "git config user.email",
  })
  runChecked("git", ["config", "commit.gpgsign", "false"], {
    cwd: repoDir,
    env,
    label: "git config commit.gpgsign",
  })
  runChecked("git", ["add", "-A"], { cwd: repoDir, env, label: "git add" })
  runChecked("git", ["commit", "-m", "init"], { cwd: repoDir, env, label: "git commit" })
}

const envelope = (result, command) => {
  const parsed = parseJson(result.stdout, `${command} stdout`)
  const body = asRecord(parsed, `${command} envelope`)
  if (body.command !== command) {
    fail(`${command} envelope command was ${String(body.command)}`)
  }
  return body
}

const successData = (result, command) => {
  const body = envelope(result, command)
  if (body.ok !== true) {
    fail(`${command} envelope ok was not true:\n${result.stdout}\n${result.stderr}`)
  }
  return asRecord(body.data, `${command} data`)
}

const doctorCheck = (data, name) => {
  const checks = data.checks
  if (!Array.isArray(checks)) {
    fail("doctor data.checks must be an array")
  }
  const check = checks.find((entry) => asRecord(entry, "doctor check").name === name)
  if (check === undefined) {
    fail(`doctor missing check ${name}`)
  }
  return asRecord(check, `doctor check ${name}`)
}

const wasmDetails = (data) => {
  const check = doctorCheck(data, "grammars.wasm")
  return asRecord(check.details, "grammars.wasm details")
}

const collectedSymbols = (extractData) => {
  const tethers = extractData.tethers
  if (!Array.isArray(tethers)) {
    fail("extract data.tethers must be an array")
  }
  /** @type {string[]} */
  const symbols = []
  for (const tether of tethers) {
    const row = asRecord(tether, "extract tether")
    if (!Array.isArray(row.symbols)) {
      fail("extract tether.symbols must be an array")
    }
    for (const symbol of row.symbols) {
      if (typeof symbol === "string") {
        symbols.push(symbol)
      }
    }
  }
  return symbols
}

const searchHits = (data) => {
  if (!Array.isArray(data.hits)) {
    fail("search data.hits must be an array")
  }
  return data.hits.map((hit) => asRecord(hit, "search hit"))
}

const main = () => {
  const tarballDirArg = process.argv[2]
  if (tarballDirArg === undefined || tarballDirArg.startsWith("-")) {
    usage()
  }
  if (!isAbsolute(tarballDirArg)) {
    fail("tarball directory must be an absolute path")
  }
  const tarballDir = resolve(tarballDirArg)
  const useRegistry = process.argv.slice(3).includes("--registry")

  const manifest = loadManifest(tarballDir)
  const version = manifest[0]?.version
  if (version === undefined) {
    fail("manifest version missing")
  }
  const platform = hostPlatform()
  const wrapper = manifest.find((entry) => entry.name === WRAPPER_NAME)
  const platformEntry = manifest.find((entry) => entry.name === platform.name)
  if (wrapper === undefined || platformEntry === undefined) {
    fail(`manifest missing ${WRAPPER_NAME} or ${platform.name}`)
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "tether-npm-cli-smoke-"))
  const isolatedHome = ensureDir(join(tempRoot, "home"))
  const tetherHome = ensureDir(join(tempRoot, "tether-home"))
  const isolatedBin = populateIsolatedBin(join(tempRoot, "bin"))
  const repoDir = join(tempRoot, "repo")
  const installSeed = join(tempRoot, "npm-project")
  const spacedInstall = join(tempRoot, "install with spaces")

  writeText(
    join(isolatedHome, ".gitconfig"),
    "[user]\n\tname = tether-smoke\n\temail = tether-smoke@example.com\n[commit]\n\tgpgsign = false\n",
  )

  const baseEnv = {
    ...process.env,
    HOME: isolatedHome,
    TETHER_HOME: tetherHome,
    GIT_CONFIG_GLOBAL: join(isolatedHome, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "tether-smoke",
    GIT_AUTHOR_EMAIL: "tether-smoke@example.com",
    GIT_COMMITTER_NAME: "tether-smoke",
    GIT_COMMITTER_EMAIL: "tether-smoke@example.com",
  }
  delete baseEnv.SYNTHETIC_API_KEY
  delete baseEnv.NODE_PATH

  const cliEnv = {
    ...baseEnv,
    PATH: isolatedBin,
  }

  try {
    ensureDir(installSeed)
    writeText(
      join(installSeed, "package.json"),
      `${JSON.stringify({ name: "tether-npm-cli-smoke", private: true, version: "0.0.0" })}\n`,
    )

    const installArgs = [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org",
    ]
    if (useRegistry) {
      installArgs.push(`${WRAPPER_NAME}@${version}`)
    } else {
      installArgs.push(join(tarballDir, wrapper.filename), join(tarballDir, platformEntry.filename))
    }

    runChecked("npm", installArgs, {
      cwd: installSeed,
      env: baseEnv,
      label: useRegistry ? "npm install from registry" : "npm install local tarballs",
    })

    ensureDir(dirname(spacedInstall))
    renameSync(installSeed, spacedInstall)
    const installDir = spacedInstall
    const launcher = join(installDir, "node_modules", "@skastr0", "tether", "bin", "tether.js")
    const binShim = join(installDir, "node_modules", ".bin", "tether")
    const platformDir = join(installDir, "node_modules", "@skastr0", `tether-${platform.key}`)

    if (!existsSync(launcher)) {
      fail(`installed launcher missing at ${launcher}`)
    }
    if (!existsSync(binShim)) {
      fail(`installed bin missing at ${binShim}`)
    }

    initGitRepo(repoDir, cliEnv)

    const isolatedNode = join(isolatedBin, "node")
    const runTether = (args, options = {}) =>
      run(isolatedNode, [launcher, ...args], {
        cwd: options.cwd ?? repoDir,
        env: cliEnv,
        label: options.label ?? `tether ${args[0] ?? args.join(" ")}`,
      })

    const tetherOk = (args, label) => {
      const result = runTether(args, { label })
      if (result.status !== 0) {
        fail(`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
      }
      return result
    }

    const versionResult = tetherOk(["--version"], "tether --version")
    if (versionResult.stdout.trim() !== version) {
      fail(`--version expected ${version}, got ${versionResult.stdout.trim()}`)
    }

    const doctorInput = JSON.stringify({ root: repoDir })
    const doctorResult = tetherOk(["doctor", doctorInput], "tether doctor")
    const doctorData = successData(doctorResult, "doctor")
    if (doctorData.status !== "ok") {
      fail(`doctor status was ${String(doctorData.status)}`)
    }
    const wasm = wasmDetails(doctorData)
    if (wasm.loaded_count !== 7 || wasm.missing_count !== 0) {
      fail(
        `doctor grammars.wasm expected loaded_count 7 missing_count 0, got ${JSON.stringify({
          loaded_count: wasm.loaded_count,
          missing_count: wasm.missing_count,
        })}`,
      )
    }
    if (doctorCheck(doctorData, "grammars.wasm").ok !== true) {
      fail("doctor grammars.wasm was not ok")
    }

    const extractResult = tetherOk(["extract", JSON.stringify({ root: repoDir })], "tether extract")
    const extractData = successData(extractResult, "extract")
    const symbols = collectedSymbols(extractData)
    const missingSymbols = EXPECTED_SYMBOLS.filter((symbol) => !symbols.includes(symbol))
    if (missingSymbols.length > 0) {
      fail(`extract missing symbols ${missingSymbols.join(", ")}; got ${symbols.join(", ")}`)
    }

    const lexicalInput = JSON.stringify({
      root: repoDir,
      query: SMOKE_TOKEN,
      mode: "lexical",
    })
    const lexicalFirst = tetherOk(["search", lexicalInput], "tether search lexical")
    const lexicalData = successData(lexicalFirst, "search")
    if (lexicalData.mode !== "lexical") {
      fail(`lexical search mode was ${String(lexicalData.mode)}`)
    }
    if (lexicalData.fusion !== undefined) {
      fail("lexical search must omit fusion")
    }
    const firstHits = searchHits(lexicalData)
    const hitSymbols = firstHits.flatMap((hit) => (Array.isArray(hit.symbols) ? hit.symbols : []))
    const missingHits = EXPECTED_SYMBOLS.filter((symbol) => !hitSymbols.includes(symbol))
    if (firstHits.length < 7 || missingHits.length > 0) {
      fail(
        `lexical search expected the seven smoke symbols for ${SMOKE_TOKEN}; hits=${firstHits.length} missing=${missingHits.join(", ")}`,
      )
    }

    const lexicalSecond = tetherOk(["search", lexicalInput], "tether search lexical persistence")
    const persisted = successData(lexicalSecond, "search")
    if (persisted.source !== "extract_cache" && persisted.source !== "index") {
      fail(`second search source was ${String(persisted.source)}, expected extract_cache or index`)
    }
    const persistedHits = searchHits(persisted)
    if (persistedHits.length < 7) {
      fail(`persisted lexical search returned ${persistedHits.length} hits`)
    }

    const fusionInput = JSON.stringify({
      root: repoDir,
      query: SMOKE_TOKEN,
      mode: "fusion",
    })
    const fusionResult = tetherOk(["search", fusionInput], "tether search fusion")
    const fusionData = successData(fusionResult, "search")
    if (fusionData.mode !== "fusion") {
      fail(`fusion search mode was ${String(fusionData.mode)}`)
    }
    const fusion = asRecord(fusionData.fusion, "search fusion")
    if (fusion.stub !== true || fusion.lexical !== true || fusion.semantic !== false) {
      fail(`fusion fallback shape mismatch: ${JSON.stringify(fusion)}`)
    }
    if (fusion.reason !== FUSION_FALLBACK_REASON) {
      fail(`fusion reason expected ${JSON.stringify(FUSION_FALLBACK_REASON)}, got ${JSON.stringify(fusion.reason)}`)
    }
    const capabilities = asRecord(fusionData.capabilities, "search capabilities")
    const fusionCapability = asRecord(capabilities.fusion, "search capabilities.fusion")
    if (fusionCapability.stub !== true || fusionCapability.semantic !== false) {
      fail(`capabilities.fusion should report lexical fallback, got ${JSON.stringify(fusionCapability)}`)
    }

    const wasmFiles = walkFiles(join(installDir, "node_modules")).filter((path) => path.endsWith(".wasm"))
    if (wasmFiles.length === 0) {
      fail("installed package tree contains no .wasm files to hide")
    }
    const hidden = wasmFiles.map((path) => ({ from: path, to: `${path}.missing` }))
    try {
      for (const file of hidden) {
        renameSync(file.from, file.to)
      }
      const missingWasm = runTether(["doctor", doctorInput], { label: "tether doctor missing wasm" })
      if (missingWasm.status === 0) {
        fail("doctor succeeded after wasm files were hidden")
      }
      const missingEnvelope = envelope(missingWasm, "doctor")
      const missingData = asRecord(missingEnvelope.data, "doctor missing-wasm data")
      if (missingData.status !== "failed") {
        fail(`doctor status after hiding wasm was ${String(missingData.status)}`)
      }
      const missingDetails = wasmDetails(missingData)
      if (missingDetails.loaded_count === 7 && missingDetails.missing_count === 0) {
        fail("doctor still reported loaded_count 7 missing_count 0 after wasm was hidden")
      }
      if (doctorCheck(missingData, "grammars.wasm").ok !== false) {
        fail("doctor grammars.wasm should fail when wasm is missing")
      }
    } finally {
      for (const file of hidden) {
        if (existsSync(file.to) && !existsSync(file.from)) {
          renameSync(file.to, file.from)
        }
      }
    }

    if (!existsSync(platformDir)) {
      fail(`platform package missing at ${platformDir}`)
    }
    const hiddenPlatform = `${platformDir}.missing`
    try {
      renameSync(platformDir, hiddenPlatform)
      const missingDep = runTether(["--version"], { label: "tether --version without optional dep" })
      if (missingDep.status === 0) {
        fail("launcher succeeded after the optional platform package was renamed away")
      }
      const combined = `${missingDep.stdout}\n${missingDep.stderr}`
      if (!combined.includes(platform.name) && !/missing/i.test(combined)) {
        fail(`launcher missing-optional-dep output did not mention the platform package:\n${combined}`)
      }
    } finally {
      if (existsSync(hiddenPlatform) && !existsSync(platformDir)) {
        renameSync(hiddenPlatform, platformDir)
      }
    }

    process.stdout.write("npm CLI smoke passed\n")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
