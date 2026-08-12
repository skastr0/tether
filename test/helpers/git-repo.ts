import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const run = (cwd: string, args: ReadonlyArray<string>) =>
  new Promise<void>((resolvePromise, reject) => {
    const subprocess = spawn(args[0] ?? "git", args.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    subprocess.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    subprocess.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    subprocess.on("error", reject)
    subprocess.on("close", (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${args.join(" ")} failed (${code}): ${stderr || stdout}`))
    })
  })

export const writeTree = async (dir: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

export const configureGit = async (dir: string) => {
  await run(dir, ["git", "config", "user.email", "tether@example.com"])
  await run(dir, ["git", "config", "user.name", "tether"])
  await run(dir, ["git", "config", "commit.gpgsign", "false"])
}

export const commitAll = async (dir: string, message: string) => {
  await run(dir, ["git", "add", "-A"])
  await run(dir, ["git", "commit", "-m", message])
}

export const initGitRepo = async (dir: string, files: Record<string, string>): Promise<string> => {
  await writeTree(dir, files)
  await run(dir, ["git", "init"])
  await configureGit(dir)
  await commitAll(dir, "init")
  return dir
}
