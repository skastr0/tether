import { Effect } from "effect"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

import { GitCommandError, GitNotFoundError, NotAGitRepositoryError } from "./errors"

export interface GitRepo {
  readonly root: string
  readonly gitKey: string
  readonly origin?: string
}

export interface GitProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface RunGitOptions {
  readonly trimStdout?: boolean
  readonly env?: NodeJS.ProcessEnv
}

const isMissingGit = (cause: unknown) => {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return (cause as { code?: string }).code === "ENOENT"
  }

  return cause instanceof Error && /ENOENT|not found/i.test(cause.message)
}

const spawnGit = (
  cwd: string,
  args: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
  options: RunGitOptions | undefined,
): Promise<GitProcessResult> =>
  new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"))
      return
    }

    const subprocess = spawn("git", [...args], {
      cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    const onAbort = () => {
      subprocess.kill("SIGTERM")
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    let stdout = ""
    let stderr = ""
    subprocess.stdout.setEncoding("utf8")
    subprocess.stderr.setEncoding("utf8")
    subprocess.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    subprocess.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    subprocess.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })

    subprocess.on("close", (code, killSignal) => {
      signal?.removeEventListener("abort", onAbort)
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"))
        return
      }

      const trimStdout = options?.trimStdout !== false
      resolvePromise({
        stdout: trimStdout ? stdout.trim() : stdout,
        stderr: stderr.trim(),
        exitCode: code ?? (killSignal === null || killSignal === undefined ? 0 : 1),
      })
    })
  })

export const runGit = (cwd: string, args: ReadonlyArray<string>, options?: RunGitOptions) =>
  Effect.tryPromise({
    try: (signal) => spawnGit(cwd, args, signal, options),
    catch: (cause) => {
      if (isMissingGit(cause)) {
        return new GitNotFoundError({
          message: "git is not installed or not on PATH",
        })
      }

      return new GitCommandError({
        args: ["git", ...args],
        message: cause instanceof Error ? cause.message : "git command failed",
      })
    },
  })

const remoteFromScpLike = (value: string) => {
  const match = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(value)
  if (match === null || value.includes("://")) {
    return undefined
  }

  return { host: match[1] ?? "", path: match[2] ?? "" }
}

const cleanRemotePath = (path: string) =>
  path.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "")

export const normalizeOrigin = (remote: string) => {
  const trimmed = remote.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const scp = remoteFromScpLike(trimmed)
  if (scp !== undefined) {
    const path = cleanRemotePath(scp.path).toLowerCase()
    if (scp.host.length === 0 || path.length === 0) {
      return undefined
    }

    return `${scp.host.toLowerCase()}/${path}`
  }

  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()
    const path = cleanRemotePath(url.pathname).toLowerCase()
    if (host.length === 0 || path.length === 0) {
      return undefined
    }

    return `${host}/${path}`
  } catch {
    const cleaned = cleanRemotePath(trimmed).toLowerCase()
    return cleaned.length === 0 ? undefined : cleaned
  }
}

export const encodeGitKey = (normalizedOrigin: string) =>
  normalizedOrigin.replace(/[/:]/g, "__")

export const hashRepoRoot = (root: string) =>
  createHash("sha256").update(resolve(root)).digest("hex")

export const gitKeyFor = (root: string, origin: string | undefined) => {
  const normalized = origin === undefined ? undefined : normalizeOrigin(origin)
  return normalized === undefined ? hashRepoRoot(root) : encodeGitKey(normalized)
}

export const requireGitRepo = (cwd: string) =>
  Effect.gen(function* () {
    const absoluteCwd = resolve(cwd)
    const toplevel = yield* runGit(absoluteCwd, ["rev-parse", "--show-toplevel"])

    if (toplevel.exitCode !== 0) {
      return yield* Effect.fail(
        new NotAGitRepositoryError({
          path: absoluteCwd,
          message: "cwd is not inside a git repository",
        }),
      )
    }

    const root = resolve(toplevel.stdout)
    const originResult = yield* runGit(root, ["remote", "get-url", "origin"])
    const origin = originResult.exitCode === 0 && originResult.stdout.length > 0
      ? originResult.stdout
      : undefined

    return {
      root,
      gitKey: gitKeyFor(root, origin),
      ...(origin === undefined ? {} : { origin }),
    } satisfies GitRepo
  })
