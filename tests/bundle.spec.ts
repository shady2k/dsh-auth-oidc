import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { parse } from 'yaml'

it('installs an active settings owner with login disabled and no credentials', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  expect(patch).toEqual([{ insert: [{ id: 'auth-oidc-settings', name: manifest.name, config: { enabled: false } }] }])
  expect(manifest.main).toBe('lib/configure.js')
  expect(manifest.types).toBe('lib/configure.d.ts')
  expect(manifest.exports['.']).toEqual({ types: './lib/configure.d.ts', default: './lib/configure.js' })
  expect(manifest.exports['./runtime']).toEqual({ types: './lib/index.d.ts', default: './lib/index.js' })
  expect(manifest.exports['./configure'].default).toBe('./lib/configure.js')
  expect(manifest.exports['./client'].default).toBe('./lib/client.js')
  expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
  expect(JSON.stringify(manifest)).not.toContain('workspace:')
})
