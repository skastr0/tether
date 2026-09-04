import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join, resolve } from "node:path"
import { LANGUAGE_IDS } from "../src/extract/languages"
import { profileForLanguage } from "../src/extract/parser"

const root = resolve(import.meta.dir, "..")
const require = createRequire(import.meta.url)
const metadata = await Bun.file(join(root, "package.json")).json()
const version: string = metadata.version
const bunVersion: string = metadata.packageManager.replace("bun@", "")
if (Bun.version !== bunVersion) throw new Error(`Build requires Bun ${bunVersion}, got ${Bun.version}`)
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid package version")

const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const
const assets = ["web-tree-sitter/tree-sitter.wasm", ...LANGUAGE_IDS.map((id) => profileForLanguage(id).grammar)]
const destination = join(root, "dist", "npm")
const common = {
  version,
  type: "module",
  license: "MIT",
  repository: { type: "git", url: "git+https://github.com/skastr0/tether.git" },
  homepage: "https://github.com/skastr0/tether#readme",
  bugs: { url: "https://github.com/skastr0/tether/issues" },
  publishConfig: { access: "public" },
}

// Use the bundler's input graph, not unrelated optional/type-only peers.
// Include WASM package owners separately because WASM is copied as sidecars.
const graph = await Bun.build({
  entrypoints: [join(root, "src", "cli.ts")], target: "bun", metafile: true,
  define: { APP_VERSION: JSON.stringify(version), TETHER_COMPILED: "true" },
})
if (!graph.success || !graph.metafile) throw new AggregateError(graph.logs, "Cannot inspect bundle inputs")
const graphData = typeof graph.metafile === "string" ? JSON.parse(graph.metafile) : graph.metafile
const inputs: string[] = Object.keys(graphData.inputs)
const notices: string[] = []
const seen = new Set<string>()
for (const input of [...inputs.filter((path) => path.includes("node_modules/")), ...assets.map((path) => require.resolve(path))].sort()) {
  let dir = dirname(resolve(root, input))
  while (true) {
    const candidate = Bun.file(join(dir, "package.json"))
    if (await candidate.exists() && (await candidate.json()).name) break
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No package manifest for ${input}`)
    dir = parent
  }
  const manifest = join(dir, "package.json")
  if (seen.has(manifest)) continue
  seen.add(manifest)
  const pkg = await Bun.file(manifest).json()
  const licenseFiles = (await readdir(dir)).filter((file) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file)).sort()
  if (licenseFiles.length === 0) throw new Error(`Missing upstream license: ${pkg.name}`)
  notices.push(`## ${pkg.name}@${pkg.version}\n\n${(await Promise.all(licenseFiles.map((file) => readFile(join(dir, file), "utf8")))).join("\n\n")}`)
}
const dependencyNotices = notices.join("\n\n")

for (const platform of platforms) {
  const [os, cpu] = platform.split("-")
  const dir = join(destination, `tether-${platform}`)
  await mkdir(join(dir, "bin"), { recursive: true })
  await mkdir(join(dir, "assets"), { recursive: true })
  const outfile = join(dir, "bin", "tether")
  const result = await Bun.build({
    entrypoints: [join(root, "src", "cli.ts")],
    target: "bun",
    compile: { target: `bun-${platform}`, outfile },
    define: { APP_VERSION: JSON.stringify(version), TETHER_COMPILED: "true" },
    minify: true,
  })
  if (!result.success) throw new AggregateError(result.logs, `Compilation failed: ${platform}`)
  await chmod(outfile, 0o755)
  for (const specifier of assets) await copyFile(require.resolve(specifier), join(dir, "assets", basename(specifier)))
  await copyFile(join(root, "LICENSE"), join(dir, "LICENSE"))
  await copyFile(join(root, "scripts", "licenses", "bun.LICENSE"), join(dir, "BUN-LICENSE"))
  await copyFile(join(root, "scripts", "licenses", "emscripten.LICENSE"), join(dir, "EMSCRIPTEN-LICENSE"))
  await writeFile(join(dir, "NOTICE.md"), `${await readFile(join(root, "NOTICE.md"), "utf8")}\n\n${dependencyNotices}\n`)
  await writeFile(join(dir, "package.json"), JSON.stringify({
    ...common, name: `@skastr0/tether-${platform}`, description: `Tether CLI for ${platform}.`,
    os: [os], cpu: [cpu], ...(os === "linux" ? { libc: ["glibc"] } : {}),
    files: ["bin", "assets", "LICENSE", "NOTICE.md", "BUN-LICENSE", "EMSCRIPTEN-LICENSE"],
  }, null, 2) + "\n")
  console.log(`Built ${platform}`)
}

const wrapper = join(destination, "tether")
await mkdir(join(wrapper, "bin"), { recursive: true })
await copyFile(join(root, "scripts", "launcher.mjs"), join(wrapper, "bin", "tether.js"))
await chmod(join(wrapper, "bin", "tether.js"), 0o755)
for (const file of ["LICENSE", "README.md"]) await copyFile(join(root, file), join(wrapper, file))
await writeFile(join(wrapper, "package.json"), JSON.stringify({
  ...common, name: "@skastr0/tether", description: metadata.description,
  engines: { node: ">=22.14.0" }, bin: { tether: "bin/tether.js" },
  files: ["bin", "README.md", "LICENSE"],
  optionalDependencies: Object.fromEntries(platforms.map((platform) => [`@skastr0/tether-${platform}`, version])),
}, null, 2) + "\n")
