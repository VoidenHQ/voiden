#!/usr/bin/env node
/**
 * Builds headless runner bundles from local plugin repos in plugins/.
 * Output: packages/voiden-runner/bundled-runners/{pluginId}-runner.js
 *
 * Each plugin that ships a src/runner.ts also has a build-runner.mjs.
 * This script runs each one and copies the output to bundled-runners/.
 *
 * Usage (from monorepo root):
 *   node scripts/build-runners.mjs
 *   node scripts/build-runners.mjs voiden-rest-api   # build one plugin
 */

import { readdirSync, existsSync, readFileSync, statSync, mkdirSync, copyFileSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pluginsDir = resolve(__dirname, '../plugins')
const outDir = resolve(__dirname, '../packages/voiden-runner/bundled-runners')

mkdirSync(outDir, { recursive: true })

if (!existsSync(pluginsDir)) {
  console.error('plugins/ directory not found. Run: bash cleanup.sh first to clone plugin repos.')
  process.exit(1)
}

const targetId = process.argv[2] || null

const plugins = readdirSync(pluginsDir)
  .filter(name => {
    if (!name.startsWith('plugin-')) return false
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
    if (targetId && pluginId !== targetId) return []
    return [{ repoDir, pluginId, buildScript }]
  })

if (plugins.length === 0) {
  const hint = targetId
    ? `Plugin "${targetId}" not found or has no build-runner.mjs`
    : 'No runner-capable plugins found in plugins/'
  console.error(hint)
  process.exit(1)
}

console.log(`Building ${plugins.length} runner(s): ${plugins.map(p => p.pluginId).join(', ')}\n`)

let failed = 0
for (const { repoDir, pluginId, buildScript } of plugins) {
  process.stdout.write(`  Building ${pluginId}-runner...`)

  const result = spawnSync('node', [buildScript], {
    cwd: repoDir,
    stdio: 'pipe',
    encoding: 'utf8',
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
  console.log(' ✓')
}

console.log(`\n${plugins.length - failed}/${plugins.length} runner(s) built successfully.`)
if (failed > 0) process.exit(1)
