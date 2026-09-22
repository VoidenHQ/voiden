#!/usr/bin/env node
/**
 * Stages built plugin bundles from plugins/<id>/dist/ into
 * apps/electron/bundled-plugins/ + bundled-main-plugins/, and snapshots the
 * registry into apps/electron/src/extensions.json.
 *
 * This is the same staging logic forge.config.ts's generateAssets hook runs
 * for a normal (non-Nix) package — pulled out into its own script so the Nix
 * build (nix/package.nix) can call it too, against plugins/ prepared from
 * pinned flake inputs instead of cleanup.sh's live git clone.
 *
 * Must run AFTER scripts/build-plugins.mjs (renderer bundles) and each
 * plugin's own build-main.mjs (main-process bundles), both of which write
 * into plugins/<id>/dist/.
 *
 * Usage:
 *   node scripts/stage-bundled-plugins.mjs [--registry <path-to-extensions.json>]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const pluginsDir = join(repoRoot, 'plugins')
const electronDir = join(repoRoot, 'apps/electron')
const stagingDir = join(electronDir, 'bundled-plugins')
const stagingMainDir = join(electronDir, 'bundled-main-plugins')

const registryArgIdx = process.argv.indexOf('--registry')
const registryPath = registryArgIdx !== -1
  ? process.argv[registryArgIdx + 1]
  : join(pluginsDir, 'plugin-registry', 'extensions.json')

if (!existsSync(registryPath)) {
  console.error(`Registry not found at ${registryPath}`)
  process.exit(1)
}

const appVersion = JSON.parse(readFileSync(join(electronDir, 'package.json'), 'utf-8')).version

// Mirrors forge.config.ts's satisfiesRange — simple space-separated
// >=/<=/>/</= comparator list against a MAJOR.MINOR.PATCH triple.
function satisfiesRange(appVer, range) {
  const clean = (v) => v.replace(/[-+].*$/, '').trim()
  const parse = (v) => clean(v).split('.').map((n) => parseInt(n, 10) || 0)
  const cmp = (a, b) => {
    for (let i = 0; i < 3; i++) {
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
    }
    return 0
  }
  const av = parse(appVer)
  for (const part of range.trim().split(/\s+/)) {
    const m = part.match(/^(>=|<=|>|<|=)?(.+)$/)
    if (!m) continue
    const [, op, ver] = m
    const d = cmp(av, parse(ver))
    if (op === '>=' && d < 0) return false
    if (op === '>' && d <= 0) return false
    if (op === '<=' && d > 0) return false
    if (op === '<' && d >= 0) return false
    if ((!op || op === '=') && d !== 0) return false
  }
  return true
}

const raw = JSON.parse(readFileSync(registryPath, 'utf-8'))
const registryEntries = Array.isArray(raw) ? raw.filter((p) => p.type === 'core') : Object.values(raw?.plugins ?? {})
console.log(`Registry: ${registryEntries.length} core plugin(s)`)

const registeredIds = new Set(registryEntries.map((p) => p.id))
const excludedIds = new Set()
for (const p of registryEntries) {
  if (p.bundled === false) {
    excludedIds.add(p.id)
    continue
  }
  if (p.voidenVersion && !satisfiesRange(appVersion, p.voidenVersion)) {
    excludedIds.add(p.id)
    console.log(`Excluding ${p.id} — requires ${p.voidenVersion}, building ${appVersion}`)
  }
}

mkdirSync(stagingDir, { recursive: true })
mkdirSync(stagingMainDir, { recursive: true })
for (const f of readdirSync(stagingDir)) unlinkSync(join(stagingDir, f))
for (const f of readdirSync(stagingMainDir)) unlinkSync(join(stagingMainDir, f))

if (existsSync(pluginsDir)) {
  for (const pluginDir of readdirSync(pluginsDir)) {
    const manifestPath = join(pluginsDir, pluginDir, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const pluginId = manifest.id
    if (!pluginId || !registeredIds.has(pluginId) || excludedIds.has(pluginId)) continue

    const rendererBundle = join(pluginsDir, pluginDir, 'dist', `${pluginId}.js`)
    if (existsSync(rendererBundle)) {
      copyFileSync(rendererBundle, join(stagingDir, `${pluginId}.js`))
      console.log(`Staged renderer bundle: ${pluginId}.js`)
    }

    if (manifest.mainProcess) {
      const distDir = join(pluginsDir, pluginDir, 'dist')
      const cjsPath = join(distDir, `${pluginId}-main.cjs`)
      const jsPath = join(distDir, `${pluginId}-main.js`)
      const mainBundle = existsSync(cjsPath) ? cjsPath : jsPath
      const ext = mainBundle === cjsPath ? '.cjs' : '.js'
      if (existsSync(mainBundle)) {
        copyFileSync(mainBundle, join(stagingMainDir, `${pluginId}-main${ext}`))
        console.log(`Staged main-process bundle: ${pluginId}-main${ext}`)
      }
    }

    const changelogSrc = join(pluginsDir, pluginDir, 'changelog.json')
    if (existsSync(changelogSrc)) {
      copyFileSync(changelogSrc, join(stagingDir, `${pluginId}-changelog.json`))
      console.log(`Staged changelog: ${pluginId}-changelog.json`)
    }
  }
} else {
  console.warn('plugins/ not found — no plugin bundles staged')
}

const extensionsSnapshotPath = join(electronDir, 'src', 'extensions.json')
mkdirSync(dirname(extensionsSnapshotPath), { recursive: true })
writeFileSync(extensionsSnapshotPath, JSON.stringify(registryEntries, null, 2))
console.log(`Wrote extensions.json snapshot with ${registryEntries.length} core plugins`)
