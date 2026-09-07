import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { discoverEnvProfiles, resolveEnvProfile } from '../envProfiles.js'

describe('envProfiles', () => {
  let projectRoot: string
  let voidenDir: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'voiden-envprofiles-'))
    voidenDir = join(projectRoot, '.voiden')
    mkdirSync(voidenDir)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  const write = (relPath: string, content: string): void => {
    writeFileSync(join(projectRoot, relPath), content, 'utf-8')
  }

  describe('discoverEnvProfiles', () => {
    it('falls back to legacy-dotenv for "default" when no YAML profile files exist at all', () => {
      write('.env', 'PLAIN=1\n')
      const profiles = discoverEnvProfiles(projectRoot)
      expect(profiles).toEqual([
        { name: 'default', source: 'legacy-dotenv', dotEnvFiles: [join(projectRoot, '.env')] },
      ])
    })

    it('reports "default" as legacy-dotenv with no files when nothing is present at all', () => {
      expect(discoverEnvProfiles(projectRoot)).toEqual([
        { name: 'default', source: 'legacy-dotenv', dotEnvFiles: [] },
      ])
    })

    it('discovers a named profile and lists its full dotted environment hierarchy', () => {
      write('.voiden/env-staging-public.yaml', [
        'staging:',
        '  variables:',
        '    HOST: staging.example.com',
        '  children:',
        '    eu:',
        '      variables:',
        '        REGION: eu',
        '',
      ].join('\n'))
      const profiles = discoverEnvProfiles(projectRoot)
      const staging = profiles.find((p) => p.name === 'staging')
      expect(staging).toMatchObject({
        name: 'staging',
        source: 'yaml',
        environments: ['staging', 'staging.eu'],
      })
    })

    it('treats a profile whose YAML has zero environments as legacy-dotenv, not an empty yaml profile', () => {
      write('.voiden/env-empty-public.yaml', '# nothing here\n')
      const profiles = discoverEnvProfiles(projectRoot)
      const empty = profiles.find((p) => p.name === 'empty')
      expect(empty?.source).toBe('legacy-dotenv')
    })

    it('discovers the "default" profile\'s own env-public.yaml/env-private.yaml (no name suffix)', () => {
      write('.voiden/env-public.yaml', 'dev:\n  variables:\n    FOO: bar\n')
      const profiles = discoverEnvProfiles(projectRoot)
      expect(profiles).toEqual([
        { name: 'default', source: 'yaml', publicFile: join(voidenDir, 'env-public.yaml'), environments: ['dev'] },
      ])
    })
  })

  describe('resolveEnvProfile', () => {
    it('throws a clear error for an unknown profile', () => {
      expect(() => resolveEnvProfile(projectRoot, 'nope')).toThrow('Unknown profile "nope". Available: default')
    })

    it('merges public + private, private winning on key conflict', () => {
      write('.voiden/env-staging-public.yaml', 'staging:\n  variables:\n    HOST: pub.example.com\n    SHARED: pub\n')
      write('.voiden/env-staging-private.yaml', 'staging:\n  variables:\n    SECRET: shh\n    SHARED: priv\n')
      expect(resolveEnvProfile(projectRoot, 'staging')).toEqual({
        HOST: 'pub.example.com',
        SHARED: 'priv',
        SECRET: 'shh',
      })
    })

    it('resolves a specific top-level environment by exact path', () => {
      write('.voiden/env-multi-public.yaml', [
        'dev:',
        '  variables:',
        '    HOST: dev.example.com',
        'staging:',
        '  variables:',
        '    HOST: staging.example.com',
        '',
      ].join('\n'))
      expect(resolveEnvProfile(projectRoot, 'multi', 'dev')).toEqual({ HOST: 'dev.example.com' })
      expect(resolveEnvProfile(projectRoot, 'multi', 'staging')).toEqual({ HOST: 'staging.example.com' })
    })

    it('resolves a nested child by its full dotted path, inheriting and overriding parent vars', () => {
      write('.voiden/env-staging-public.yaml', [
        'staging:',
        '  variables:',
        '    HOST: staging.example.com',
        '    REGION: us',
        '  children:',
        '    eu:',
        '      variables:',
        '        REGION: eu',
        '',
      ].join('\n'))
      expect(resolveEnvProfile(projectRoot, 'staging', 'staging.eu')).toEqual({
        HOST: 'staging.example.com',
        REGION: 'eu',
      })
      // The parent alone, unaffected by the child's override:
      expect(resolveEnvProfile(projectRoot, 'staging', 'staging')).toEqual({
        HOST: 'staging.example.com',
        REGION: 'us',
      })
    })

    it('disambiguates same-named children under different parents by full path (the bug a bare-name search would hit)', () => {
      write('.voiden/env-multi-public.yaml', [
        'staging:',
        '  variables:',
        '    HOST: staging.example.com',
        '  children:',
        '    eu:',
        '      variables:',
        '        REGION: staging-eu',
        'prod:',
        '  variables:',
        '    HOST: prod.example.com',
        '  children:',
        '    eu:',
        '      variables:',
        '        REGION: prod-eu',
        '',
      ].join('\n'))
      expect(resolveEnvProfile(projectRoot, 'multi', 'staging.eu')).toEqual({ HOST: 'staging.example.com', REGION: 'staging-eu' })
      expect(resolveEnvProfile(projectRoot, 'multi', 'prod.eu')).toEqual({ HOST: 'prod.example.com', REGION: 'prod-eu' })
    })

    it('throws a clear error naming the available environments when the requested path is missing', () => {
      write('.voiden/env-staging-public.yaml', 'staging:\n  variables:\n    HOST: x\n')
      expect(() => resolveEnvProfile(projectRoot, 'staging', 'bogus')).toThrow(
        'Environment "bogus" not found in profile "staging". Available: staging',
      )
    })

    it('falls back to merging discovered .env* files for a legacy-dotenv profile', () => {
      write('.env', 'FOO=bar\n')
      write('.voiden/.env.private', 'SECRET=shh\n')
      const resolved = resolveEnvProfile(projectRoot, 'default')
      expect(resolved).toMatchObject({ FOO: 'bar', SECRET: 'shh' })
    })
  })
})
