import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const output = resolve(root, "dist/tarballs")
mkdirSync(output, { recursive: true })
const version = JSON.parse(readFileSync(join(root, "package.json"))).version
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
const manifest = []
for (const platform of [...platforms, undefined]) {
  const name = `tether${platform ? `-${platform}` : ""}`
  const directory = join(root, "dist/npm", name)
  const pkg = JSON.parse(readFileSync(join(directory, "package.json")))
  assert.equal(pkg.name, `@skastr0/${name}`)
  assert.equal(pkg.version, version)
  if (!platform) assert.deepEqual(pkg.optionalDependencies, Object.fromEntries(platforms.map((p) => [`@skastr0/tether-${p}`, version])))
  const [pack] = JSON.parse(execFileSync("npm", ["pack", directory, "--json", "--ignore-scripts", "--pack-destination", output], { encoding: "utf8" }))
  for (const file of pack.files) {
    assert.match(file.path, platform
      ? /^(package\.json|LICENSE|NOTICE\.md|BUN-LICENSE|EMSCRIPTEN-LICENSE|bin\/tether|assets\/[^/]+\.wasm)$/
      : /^(package\.json|LICENSE|README\.md|bin\/tether\.js)$/)
  }
  if (platform) {
    assert.equal(pack.files.filter((file) => file.path.endsWith(".wasm")).length, 8)
    assert.ok(pack.files.find((file) => file.path === "bin/tether")?.mode & 0o111)
  }
  const bytes = readFileSync(join(output, pack.filename))
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  assert.equal(integrity, pack.integrity)
  manifest.push({ name: pkg.name, version, filename: pack.filename, integrity, ...(platform ? { platform } : {}) })
}
writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(JSON.stringify(manifest, null, 2))
