/**
 * File discovery — resolve CLI-style paths/globs and recursively find .void files.
 *
 * Extracted from index.ts so the MCP server (and any other consumer) can list
 * a project's .void files without duplicating this logic.
 */

import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { readdir } from 'fs/promises'

/** Recursively collect all .void files under a directory. */
export async function collectVoidFiles(inputPath: string): Promise<string[]> {
  const abs = resolve(inputPath)
  if (!existsSync(abs)) return []

  const stat = statSync(abs)
  if (stat.isFile()) {
    return abs.endsWith('.void') ? [abs] : []
  }

  if (stat.isDirectory()) {
    const entries = await readdir(abs, { withFileTypes: true })
    const results: string[] = []
    for (const entry of entries) {
      const full = resolve(abs, entry.name)
      if (entry.isDirectory()) {
        results.push(...(await collectVoidFiles(full)))
      } else if (entry.isFile() && entry.name.endsWith('.void')) {
        results.push(full)
      }
    }
    return results
  }

  return []
}

/** Expand a list of paths/globs into resolved .void file paths. */
export async function resolveFiles(patterns: string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const dir = resolve(pattern.replace(/\/?\*.*$/, '') || '.')
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.void')) {
          resolved.push(resolve(dir, entry.name))
        }
      }
    } else {
      resolved.push(...(await collectVoidFiles(pattern)))
    }
  }
  return resolved
}
