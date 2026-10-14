#!/usr/bin/env node
/**
 * Builds headless runner bundles from local plugin repos in plugins/.
 * Output: packages/voiden-runner/bundled-runners/{pluginId}-runner.js
 *
 * Only plugins marked `bundled: true` in the plugin-registry's extensions.json
 * (the same flag the Electron app reads — see apps/electron/src/extensions.json)
 * are bundled here. That registry entry is the single source of truth for
 * "should this runner ship inside the @voiden/runner npm package."
 *
 * Each bundled plugin that ships a src/runner.ts also has a build-runner.mjs.
 * This script runs each one and copies the output to bundled-runners/, plus
 * a versions.json recording the exact version bundled (used to detect when a
 * newer release is available — see packages/voiden-runner/src/plugins/registry.ts).
 *
 * Usage (from monorepo root):
 *   node scripts/build-runners.mjs
 *   node scripts/build-runners.mjs voiden-rest-api   # build one plugin
 */

import { readdirSync, existsSync, readFileSync, statSync, mkdirSync, copyFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pluginsDir = resolve(__dirname, '../plugins')
const outDir = resolve(__dirname, '../packages/voiden-runner/bundled-runners')
const registryPath = resolve(__dirname, '../plugins/plugin-registry/extensions.json')

mkdirSync(outDir, { recursive: true })

// The runner bundles are esbuild-compiled CJS, but this directory inherits
// `"type": "module"` from packages/voiden-runner/package.json — without this
// override, Node's native ESM loader rejects them with "module is not defined
// in ES module scope".
writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')

if (!existsSync(pluginsDir)) {
  console.error('plugins/ directory not found. Run: bash cleanup.sh first to clone plugin repos.')
  process.exit(1)
}

if (!existsSync(registryPath)) {
  console.error(`${registryPath} not found. Run: bash cleanup.sh first to clone plugin-registry.`)
  process.exit(1)
}

const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const bundledIds = new Set(
  registry.filter(p => p.type === 'core' && p.hasRunner && p.bundled).map(p => p.id)
)

const targetId = process.argv[2] || null

const plugins = readdirSync(pluginsDir)
  .filter(name => {
    try { return statSync(join(pluginsDir, name)).isDirectory() } catch { return false }
  })
  .flatMap(name => {
    const repoDir = join(pluginsDir, name)
    const buildScript = join(repoDir, 'build-runner.mjs')
    if (!existsSync(buildScript)) return []
    const manifestPath = join(repoDir, 'manifest.json')
    if (!existsSync(manifestPath)) return []
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const pluginId = manifest.id
    if (!pluginId) return []
    if (!bundledIds.has(pluginId)) return []
    if (targetId && pluginId !== targetId) return []
    return [{ repoDir, pluginId, buildScript, version: manifest.version }]
  })

if (plugins.length === 0) {
  const hint = targetId
    ? `Plugin "${targetId}" not found, not marked "bundled": true in the registry, or has no build-runner.mjs`
    : 'No plugins marked "bundled": true with a build-runner.mjs found in plugins/'
  console.error(hint)
  process.exit(1)
}

console.log(`Building ${plugins.length} runner(s): ${plugins.map(p => p.pluginId).join(', ')}\n`)

const versions = {}

let failed = 0
for (const { repoDir, pluginId, buildScript, version } of plugins) {
  process.stdout.write(`  Building ${pluginId}-runner...`)

  // Strip Yarn PnP env vars so each plugin resolves deps from its own node_modules
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('YARN_') && k !== 'NODE_OPTIONS')
  )
  const result = spawnSync('node', [buildScript], {
    cwd: repoDir,
    stdio: 'pipe',
    encoding: 'utf8',
    env: cleanEnv,
  })

  if (result.status !== 0) {
    console.log(' ✗')
    console.error(`    ${(result.stderr || result.stdout || '').trim()}\n`)
    failed++
    continue
  }

  const src = join(repoDir, 'dist', `${pluginId}-runner.js`)
  if (!existsSync(src)) {
    console.log(' ✗  (dist file missing)')
    failed++
    continue
  }

  copyFileSync(src, join(outDir, `${pluginId}-runner.js`))
  versions[pluginId] = version
  console.log(' ✓')
}

writeFileSync(join(outDir, 'versions.json'), JSON.stringify(versions, null, 2) + '\n')

console.log(`\n${plugins.length - failed}/${plugins.length} runner(s) built successfully.`)
if (failed > 0) process.exit(1)
