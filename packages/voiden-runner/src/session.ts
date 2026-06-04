import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { STORE_DIR } from './plugins/store.js'
import type { RunResult } from './types.js'

const RESULTS_PATH = join(STORE_DIR, 'results.json')
const VARS_PATH = join(STORE_DIR, '.process.env.json')

export interface SessionResult {
  file: string
  result: RunResult
}

export function loadSessionResults(): SessionResult[] {
  if (!existsSync(RESULTS_PATH)) return []
  try {
    return JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'))
  } catch {
    return []
  }
}

export function saveSessionResults(results: SessionResult[]): void {
  mkdirSync(STORE_DIR, { recursive: true })
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf-8')
}

export function appendSessionResults(results: SessionResult[]): void {
  const existing = loadSessionResults()
  saveSessionResults([...existing, ...results])
}

export function clearSession(): void {
  const ENV_PATH = join(STORE_DIR, 'env.json')
  if (existsSync(ENV_PATH)) unlinkSync(ENV_PATH)
  if (existsSync(RESULTS_PATH)) unlinkSync(RESULTS_PATH)
  if (existsSync(VARS_PATH)) unlinkSync(VARS_PATH)
}
