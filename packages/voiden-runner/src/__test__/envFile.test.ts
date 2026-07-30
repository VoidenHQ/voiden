import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadEnvFile } from '../envFile.js'

describe('loadEnvFile', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'voiden-env-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, content: string): string => {
    const filePath = join(dir, name)
    writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  it('parses KEY=VALUE .env files, stripping quotes and skipping comments', () => {
    const filePath = write('vars.env', '# comment\nFOO=bar\nTOKEN="secret"\n\nQUOTED=\'q\'\n')
    expect(loadEnvFile(filePath)).toEqual({ FOO: 'bar', TOKEN: 'secret', QUOTED: 'q' })
  })

  it('still throws on a malformed .env line missing "="', () => {
    const filePath = write('bad.env', 'FOO bar\n')
    expect(() => loadEnvFile(filePath)).toThrow('Malformed line 1 in .env file: missing "="')
  })

  it('parses a flat YAML mapping', () => {
    const filePath = write('flat.yaml', 'FOO: bar\n')
    expect(loadEnvFile(filePath)).toEqual({ FOO: 'bar' })
  })

  it('parses the app-style nested env tree (env-public.yaml shape)', () => {
    const filePath = write('env-public.yaml', 'test:\n  variables:\n    BASE_URL: https://echo.apyhub.com\n')
    expect(loadEnvFile(filePath)).toEqual({ BASE_URL: 'https://echo.apyhub.com' })
  })

  it('merges nested children, with child values overriding inherited ones', () => {
    const filePath = write('tree.yaml', [
      'base:',
      '  variables:',
      '    HOST: example.com',
      '    TOKEN: parent',
      '  children:',
      '    staging:',
      '      variables:',
      '        TOKEN: child',
      '',
    ].join('\n'))
    expect(loadEnvFile(filePath)).toEqual({ HOST: 'example.com', TOKEN: 'child' })
  })

  it('supports the .yml extension and coerces scalar values to strings', () => {
    const filePath = write('env.yml', 'PORT: 8080\nDEBUG: true\n')
    expect(loadEnvFile(filePath)).toEqual({ PORT: '8080', DEBUG: 'true' })
  })

  it('returns an empty map for an empty or comment-only YAML file', () => {
    const filePath = write('empty.yaml', '# nothing here\n')
    expect(loadEnvFile(filePath)).toEqual({})
  })

  it('throws on a .env line with an empty key', () => {
    const filePath = write('emptykey.env', '=oops\n')
    expect(() => loadEnvFile(filePath)).toThrow('Malformed line 1 in .env file: empty key')
  })

  it('matches the file extension case-insensitively (.YAML)', () => {
    const filePath = write('upper.YAML', 'FOO: bar\n')
    expect(loadEnvFile(filePath)).toEqual({ FOO: 'bar' })
  })

  it('skips keys with no value (null) in YAML', () => {
    const filePath = write('nullval.yaml', 'FOO: bar\nEMPTY:\n')
    expect(loadEnvFile(filePath)).toEqual({ FOO: 'bar' })
  })

  it('returns an empty map when the YAML root is not a mapping', () => {
    const filePath = write('scalar.yaml', 'just a bare string\n')
    expect(loadEnvFile(filePath)).toEqual({})
  })
})
