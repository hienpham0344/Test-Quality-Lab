// Fails fast when node_modules does not match package-lock.json (e.g. after a pull that bumped Vite).
// Runs before `npm run dev`; the fix is always `npm ci`.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const pkg = readJson(join(root, 'package.json'))
const lock = readJson(join(root, 'package-lock.json'))
const direct = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
const problems = []

for (const name of direct) {
  const locked = lock.packages?.[`node_modules/${name}`]?.version
  if (!locked) continue
  let installed = null
  try {
    installed = readJson(join(root, 'node_modules', name, 'package.json')).version
  } catch {
    // missing package
  }
  if (installed !== locked) problems.push(`  ${name}: installed ${installed ?? 'missing'}, lockfile ${locked}`)
}

if (problems.length) {
  console.error(`node_modules is out of date with package-lock.json:\n${problems.join('\n')}\nRun: npm ci`)
  process.exit(1)
}
