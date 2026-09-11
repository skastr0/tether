import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { spawn } from "node:child_process"

const root = resolve(import.meta.dir, "..")
const grammarsDir = join(root, "grammars")
const manifest = JSON.parse(await readFile(join(grammarsDir, "manifest.json"), "utf8")) as {
  readonly upstream: { readonly repository: string; readonly tag: string; readonly commit: string }
  readonly tree_sitter_cli: string
  readonly emscripten_image: string
  readonly patch: string
  readonly files: Record<string, { readonly sha256: string }>
}

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

const scratch = await mkdtemp(join(tmpdir(), "tether-rebuild-grammars-"))
try {
  await run(scratch, "git", [
    "clone",
    "--branch",
    manifest.upstream.tag,
    "--depth",
    "1",
    manifest.upstream.repository,
    "src",
  ])
  const clone = join(scratch, "src")
  const head = (await run(clone, "git", ["rev-parse", "HEAD"])).trim()
  if (head !== manifest.upstream.commit) {
    throw new Error(`upstream HEAD ${head} != pinned ${manifest.upstream.commit}`)
  }
  await run(clone, "git", ["apply", join(grammarsDir, manifest.patch)])
  await run(scratch, "docker", ["pull", manifest.emscripten_image])
  const npxArgs = ["--yes", `tree-sitter-cli@${manifest.tree_sitter_cli}`]
  for (const dialect of ["typescript", "tsx"] as const) {
    const dir = join(clone, dialect)
    await run(dir, "npx", [...npxArgs, "generate"])
    await run(dir, "npx", [...npxArgs, "build", "--wasm", "--docker"])
    const produced = join(dir, `tree-sitter-${dialect}.wasm`)
    const name = basename(produced)
    const expected = manifest.files[name]?.sha256
    if (expected === undefined) throw new Error(`manifest missing sha256 for ${name}`)
    const actual = await sha256(produced)
    if (actual !== expected) {
      throw new Error(`${name} sha256 ${actual} != expected ${expected}`)
    }
    await mkdir(grammarsDir, { recursive: true })
    await copyFile(produced, join(grammarsDir, name))
    console.log(`verified ${name} ${actual}`)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
