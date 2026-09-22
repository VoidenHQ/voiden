#!/usr/bin/env node
/**
 * @voiden/mcp — run a live MCP server from a Voiden project's /tool blocks.
 * No subcommand, no verb — this package's only job is to be the server, so
 * invoking it directly means "start", not "do an action":
 *
 *   voiden-mcp [path] [options]
 *
 * Standalone — nothing wraps or duplicates this. The `voiden` CLI's `agent`
 * command registers a project's `.mcp.json`/`config.toml` to launch this
 * package (so an agent editor starts it automatically), but `agent` itself
 * never runs a server or reimplements any of this logic. This is also the
 * part you'd deploy standalone (a Dockerfile, a systemd unit, a PaaS build
 * step) — install just this package, nothing else.
 */

import { resolve, join, dirname } from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { program } from 'commander'
import { withPublishOptions, runPublish, shouldSupervise, runSupervisor, type PublishOpts } from './lib.js'

const pkgPath = resolve(join(dirname(fileURLToPath(import.meta.url)), '../package.json'))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

program
  .name('voiden-mcp')
  .version(pkg.version)
  .description(
    "Runs a live MCP server from every /tool block found under a project. Not a one-shot action — " +
    "discovers and verifies once, then stays up (stdio or --http) until stopped.\n\n" +
    "No subcommand — the project path is the only argument (there's no \"publish\", \"init\", or " +
    "any other verb; running this IS the server starting).\n\n" +
    '  Examples:\n' +
    '    voiden-mcp                           # stdio, current directory\n' +
    '    voiden-mcp ./api --http --port 3000   # HTTP on 127.0.0.1:3000\n' +
    '    voiden-mcp ./api --http --tunnel      # HTTP + a public cloudflared URL\n' +
    '    voiden-mcp --check                    # dry run, no live server\n'
  )
  .argument('[path]', 'Project directory to serve (default: current directory)')

withPublishOptions(program)

program.action(async (path: string | undefined, opts: PublishOpts) => {
  // Restart-on-crash (default on for a live server, see shouldSupervise's
  // own doc comment) needs to spawn a CHILD process actually running the
  // server — a crashed process can't restart itself from inside its own
  // corpse. process.argv.slice(2) reproduces this exact invocation
  // (path + every flag) for that child.
  if (shouldSupervise(opts)) {
    runSupervisor(process.argv[1], process.argv.slice(2))
    return
  }
  await runPublish(resolve(path ?? process.env.VOIDEN_PROJECT_ROOT ?? '.'), opts)
})

program.parseAsync(process.argv)
