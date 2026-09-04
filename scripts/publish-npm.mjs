import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const packageNames = [
  "@skastr0/tether-darwin-arm64", "@skastr0/tether-darwin-x64",
  "@skastr0/tether-linux-arm64", "@skastr0/tether-linux-x64", "@skastr0/tether",
]

export function validateManifest(manifest, directory) {
  assert.ok(Array.isArray(manifest), "Expected manifest array")
  assert.deepEqual(manifest.map((p) => p.name).sort(), [...packageNames].sort())
  const versions = new Set(manifest.map((p) => p.version))
  assert.equal(versions.size, 1, "Mixed release versions")
  assert.match(manifest[0].version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  for (const item of manifest) {
    assert.equal(item.filename, basename(item.filename), "Tarball must be a leaf filename")
    assert.match(item.filename, /\.tgz$/)
    const bytes = readFileSync(join(directory, item.filename))
    assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, item.integrity, `Modified artifact: ${item.name}`)
  }
  return packageNames.map((name) => manifest.find((item) => item.name === name))
}

export async function registryIntegrity(item, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}`, {
    signal: AbortSignal.timeout(30_000), headers: { "cache-control": "no-cache" },
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Registry lookup failed (${response.status}) for ${item.name}; do not assume absence`)
  const data = await response.json()
  assert.equal(data.name, item.name)
  assert.equal(data.version, item.version)
  assert.equal(typeof data.dist?.integrity, "string", "Registry omitted integrity")
  return data.dist.integrity
}

export async function publish(directory) {
  const manifest = validateManifest(JSON.parse(readFileSync(join(directory, "manifest.json"))), directory)
  // Preflight the whole release before the first irreversible upload.
  const existing = new Map()
  for (const item of manifest) {
    const integrity = await registryIntegrity(item)
    if (integrity !== undefined) assert.equal(integrity, item.integrity, `Already published with different bytes: ${item.name}@${item.version}`)
    existing.set(item.name, integrity)
  }
  for (const item of manifest) {
    if (existing.get(item.name) !== undefined) {
      console.log(`Verified existing ${item.name}@${item.version}`)
      continue
    }
    const args = ["publish", join(directory, item.filename), "--access", "public", "--ignore-scripts", "--registry=https://registry.npmjs.org"]
    if (item.version.includes("-")) args.push("--tag", "next")
    const result = spawnSync("npm", args, { stdio: "inherit" })
    if (result.error || result.status !== 0) throw new Error(`Publish stopped at ${item.name}; inspect registry state before resuming`)
    let confirmed = false
    for (let attempt = 0; attempt < 6; attempt++) {
      const integrity = await registryIntegrity(item)
      if (integrity !== undefined) {
        assert.equal(integrity, item.integrity, `Unexpected registry bytes: ${item.name}`)
        confirmed = true
        break
      }
      await new Promise((done) => setTimeout(done, 5_000))
    }
    assert.ok(confirmed, `Publication of ${item.name} is not yet visible; stop and inspect before resuming`)
  }
  console.log("All five registry versions match the tested tarballs.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/publish-npm.mjs <tested-tarball-directory>")
  await publish(resolve(process.argv[2]))
}
