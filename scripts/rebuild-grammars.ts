import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { spawn } from "node:child_process"

interface GrammarEntry {
  readonly id: string
  readonly upstream: { readonly repository: string; readonly tag: string; readonly commit: string }
  readonly patch: string
  readonly npm_install?: boolean
  readonly outputs: ReadonlyArray<{ readonly dir: string; readonly file: string }>
  readonly files: Record<string, { readonly sha256: string }>
}

const root = resolve(import.meta.dir, "..")
const grammarsDir = join(root, "grammars")
const manifest = JSON.parse(await readFile(join(grammarsDir, "manifest.json"), "utf8")) as {
  readonly tree_sitter_cli: string
  readonly emscripten_image: string
  readonly grammars: readonly GrammarEntry[]
}

const only = process.argv[2]

const run = (cwd: string, command: string, args: readonly string[]) =>
  new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`))
    })
  })

const sha256 = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex")

const selected = manifest.grammars.filter((entry) => only === undefined || entry.id === only)
if (selected.length === 0) {
  throw new Error(`no grammar matched ${only ?? "(all)"}`)
}

const scratch = await mkdtemp(join(tmpdir(), "tether-rebuild-grammars-"))
try {
  await run(scratch, "docker", ["pull", manifest.emscripten_image])
  const npxArgs = ["--yes", `tree-sitter-cli@${manifest.tree_sitter_cli}`]
  for (const entry of selected) {
    const clone = join(scratch, entry.id)
    await run(scratch, "git", [
      "clone",
      "--branch",
      entry.upstream.tag,
      "--depth",
      "1",
      entry.upstream.repository,
      entry.id,
    ])
    const head = (await run(clone, "git", ["rev-parse", "HEAD"])).trim()
    if (head !== entry.upstream.commit) {
      throw new Error(`${entry.id} HEAD ${head} != pinned ${entry.upstream.commit}`)
    }
    await run(clone, "git", ["apply", join(grammarsDir, entry.patch)])
    if (entry.npm_install !== false) {
      await run(clone, "npm", ["install", "--ignore-scripts"])
    }
    for (const output of entry.outputs) {
      const dir = join(clone, output.dir)
      await run(dir, "npx", [...npxArgs, "generate"])
      await run(dir, "npx", [...npxArgs, "build", "--wasm", "--docker"])
      const produced = join(dir, output.file)
      const name = basename(produced)
      const expected = entry.files[name]?.sha256
      if (expected === undefined) throw new Error(`manifest missing sha256 for ${name}`)
      const actual = await sha256(produced)
      if (actual !== expected) {
        throw new Error(`${name} sha256 ${actual} != expected ${expected}`)
      }
      await mkdir(grammarsDir, { recursive: true })
      await copyFile(produced, join(grammarsDir, name))
      console.log(`verified ${name} ${actual}`)
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
