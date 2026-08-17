/**
 * Shared "enable AI-agent integration" logic — registers a stdio MCP server
 * exposing the 4 fixed tools (list_void_files/list_requests/run_request/
 * write_result) with Claude Code / Codex, and (for CLI-only users who don't
 * have the Voiden app's richer composed skill available) installs a
 * standalone skill describing the run/verify/write-back loop.
 *
 * This is deliberately NOT @voiden/mcp — that's a separate, standalone
 * server for publishing `/tool` blocks (with verification, scheduling,
 * optional HTTP hosting), a different concern from "let an agent editor run
 * .void files in this project." Every caller below registers the lightweight
 * fixed-tools server; nothing here ever points at @voiden/mcp.
 *
 * Lives in @voiden/executors (not @voiden/runner) so every caller can use it
 * without depending on each other:
 *   - the `voiden` CLI's `agent` command (apps/electron) — passes its own
 *     explicit serverCommand pointing at itself (`voiden mcp-stdio`); see
 *     that command's own file for what replaced the old standalone
 *     @voiden/mcp-host package (retired, folded in directly)
 *   - packages/voiden-runner's own CLI (`voiden-runner mcp install|uninstall|status`)
 *     — relies on the default below (`voiden-runner mcp serve`, which already
 *     serves the same fixed tools standalone, no Electron app required)
 *   - apps/electron's Settings "Claude/Codex integration" toggle, which already
 *     installs its own richer composed skill (skillsInstaller.ts) and only
 *     needs the MCP *registration* half from here — it does not call
 *     installClaudeSkill/uninstallClaudeSkill etc., to avoid writing a second,
 *     more minimal skill file alongside its own. Also passes its own explicit
 *     serverCommand (mirrors `agent`'s), for the same reason.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Name the MCP server is registered under in .mcp.json / config.toml — what
// the agent/host actually shows the user (e.g. in `/mcp`).
const SERVER_NAME = 'voiden-mcp'
// Standalone skill slug — matches SERVER_NAME (both identify "the MCP
// capability"), and is deliberately different from the Voiden app's own
// "voiden" skill directory, so a machine with both installed doesn't have
// one silently overwrite the other's (differently-scoped) content.
const SKILL_SLUG = 'voiden-mcp'

export interface ServerCommand {
  command: string
  args: string[]
}

/**
 * Fallback launch command, used only when a caller doesn't pass its own
 * explicit `serverCommand` (the `voiden` CLI's `agent` command and the app's
 * Settings toggle both do — see resolveMcpStdioServerCommand in
 * apps/electron/src/main/ipc/mcp.ts and apps/electron/src/voiden-cli.ts).
 *
 * Points at `voiden-runner mcp serve` — @voiden/runner already ships that
 * command, and it serves the very same 4 fixed tools standalone (no
 * Electron app, no other Voiden package required), matching @voiden/runner's
 * own role as "a standalone capability users can install on CI servers."
 * This is what `voiden-runner mcp install` ends up registering by default.
 */
function defaultServerCommand(projectPath: string): ServerCommand {
  return {
    command: 'npx',
    args: ['-y', '@voiden/runner', 'mcp', 'serve', projectPath],
  }
}

// ─── Claude Code ────────────────────────────────────────────────────────────
// Project-scoped .mcp.json — the documented, public schema Claude Code reads
// from a project directory. (Claude Code's user-scope config is an opaque,
// larger state file we deliberately don't hand-edit — see README.)

function claudeMcpConfigPath(projectPath: string): string {
  return path.join(projectPath, '.mcp.json')
}

// The .mcp.json we write embeds a machine-specific absolute project path in
// `args` — committing it would point at the wrong path on anyone else's
// machine. Only touches an existing git repo; never creates one, and never
// removes the entry once added (harmless to leave even after `mcp uninstall`).
function ensureMcpJsonGitignored(projectPath: string): void {
  if (!fs.existsSync(path.join(projectPath, '.git'))) return

  const gitignorePath = path.join(projectPath, '.gitignore')
  let content = ''
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8')
  }

  const alreadyIgnored = content.split('\n').some(line => line.trim() === '.mcp.json')
  if (alreadyIgnored) return

  if (content && !content.endsWith('\n')) content += '\n'
  content += (content ? '\n' : '') + '# Voiden MCP registration (contains a machine-specific absolute path)\n.mcp.json\n'
  fs.writeFileSync(gitignorePath, content, 'utf-8')
}

export function registerClaudeMcpServer(projectPath: string, serverCommand?: ServerCommand): void {
  const configPath = claudeMcpConfigPath(projectPath)
  let config: any = {}
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) } catch { config = {} }
  }
  config.mcpServers = config.mcpServers ?? {}
  config.mcpServers[SERVER_NAME] = serverCommand ?? defaultServerCommand(projectPath)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  ensureMcpJsonGitignored(projectPath)
}

export function unregisterClaudeMcpServer(projectPath: string): void {
  const configPath = claudeMcpConfigPath(projectPath)
  if (!fs.existsSync(configPath)) return
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    if (config.mcpServers && SERVER_NAME in config.mcpServers) {
      delete config.mcpServers[SERVER_NAME]
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    }
  } catch { /* leave an unreadable file alone rather than clobber it */ }
}

export function isClaudeMcpRegistered(projectPath: string): boolean {
  const configPath = claudeMcpConfigPath(projectPath)
  if (!fs.existsSync(configPath)) return false
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return Boolean(config?.mcpServers?.[SERVER_NAME])
  } catch {
    return false
  }
}

function claudeSkillDir(): string {
  return path.join(os.homedir(), '.claude', 'skills', SKILL_SLUG)
}

export function installClaudeSkill(markdown: string): void {
  const dir = claudeSkillDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), markdown, 'utf-8')
}

export function uninstallClaudeSkill(): void {
  const dir = claudeSkillDir()
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

export function isClaudeSkillInstalled(): boolean {
  return fs.existsSync(path.join(claudeSkillDir(), 'SKILL.md'))
}

// ─── Codex CLI ──────────────────────────────────────────────────────────────
// Codex reads MCP servers from ~/.codex/config.toml's [mcp_servers.<name>]
// tables. There's no TOML dependency here — the section shape we write is
// simple enough for a targeted regex replace/append, done as plain text.

function codexConfigPath(): string {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function codexSectionRegex(): RegExp {
  // Match the whole table body up to (but not including) the next table
  // header or EOF. Must NOT stop at the first `[` the way `[^\[]*` did —
  // the `args = [...]` line inside the section is itself a TOML array and
  // contains `[`/`]`, so that stopped mid-array and left the array dangling
  // in the file after a replace/remove (producing invalid TOML).
  return new RegExp(`\\n?\\[mcp_servers\\.${SERVER_NAME}\\][\\s\\S]*?(?=\\n\\[|$)`)
}

function toTomlStringArray(values: string[]): string {
  return '[' + values.map(v => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ') + ']'
}

export function upsertCodexMcpSection(projectPath: string, serverCommand?: ServerCommand): void {
  const configPath = codexConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : ''

  const { command, args } = serverCommand ?? defaultServerCommand(projectPath)
  const section =
    `[mcp_servers.${SERVER_NAME}]\n` +
    `command = "${command}"\n` +
    `args = ${toTomlStringArray(args)}\n`

  if (codexSectionRegex().test(content)) {
    content = content.replace(codexSectionRegex(), '\n' + section)
  } else {
    content = content.trimEnd() + (content.trim() ? '\n\n' : '') + section
  }
  fs.writeFileSync(configPath, content, 'utf-8')
}

export function removeCodexMcpSection(): void {
  const configPath = codexConfigPath()
  if (!fs.existsSync(configPath)) return
  const content = fs.readFileSync(configPath, 'utf-8').replace(codexSectionRegex(), '')
  fs.writeFileSync(configPath, content, 'utf-8')
}

export function isCodexMcpRegistered(): boolean {
  const configPath = codexConfigPath()
  if (!fs.existsSync(configPath)) return false
  const content = fs.readFileSync(configPath, 'utf-8')
  return content.includes(`[mcp_servers.${SERVER_NAME}]`)
}

function codexSkillDir(): string {
  return path.join(os.homedir(), '.codex', 'skills', SKILL_SLUG)
}

export function installCodexSkill(markdown: string): void {
  const dir = codexSkillDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), markdown, 'utf-8')
}

export function uninstallCodexSkill(): void {
  const dir = codexSkillDir()
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

export function isCodexSkillInstalled(): boolean {
  return fs.existsSync(path.join(codexSkillDir(), 'SKILL.md'))
}

// ─── CLI-facing orchestration (voiden-runner `mcp` command) ────────────────

export interface McpTargets {
  claude?: boolean
  codex?: boolean
}

export function installMcpIntegration(
  projectPath: string,
  targets: McpTargets,
  skillMarkdown: string,
  serverCommand?: ServerCommand,
): string[] {
  const resolved = path.resolve(projectPath)
  const installed: string[] = []
  if (targets.claude) {
    registerClaudeMcpServer(resolved, serverCommand)
    installClaudeSkill(skillMarkdown)
    installed.push('claude')
  }
  if (targets.codex) {
    upsertCodexMcpSection(resolved, serverCommand)
    installCodexSkill(skillMarkdown)
    installed.push('codex')
  }
  return installed
}

export function uninstallMcpIntegration(projectPath: string, targets: McpTargets): string[] {
  const resolved = path.resolve(projectPath)
  const removed: string[] = []
  if (targets.claude) {
    unregisterClaudeMcpServer(resolved)
    uninstallClaudeSkill()
    removed.push('claude')
  }
  if (targets.codex) {
    removeCodexMcpSection()
    uninstallCodexSkill()
    removed.push('codex')
  }
  return removed
}

export interface McpStatus {
  claude: { skillInstalled: boolean; serverRegistered: boolean }
  codex: { skillInstalled: boolean; serverRegistered: boolean }
}

export function getMcpStatus(projectPath: string): McpStatus {
  const resolved = path.resolve(projectPath)
  return {
    claude: { skillInstalled: isClaudeSkillInstalled(), serverRegistered: isClaudeMcpRegistered(resolved) },
    codex: { skillInstalled: isCodexSkillInstalled(), serverRegistered: isCodexMcpRegistered() },
  }
}
