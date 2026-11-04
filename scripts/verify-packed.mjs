/** Verify an existing local tarball without installing it into a DSH profile. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const current = JSON.parse(await readFile('package.json', 'utf8'))
const archive = resolve(process.argv[2] ?? `${current.name}-${current.version}.tgz`)
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
for (const entry of entries) {
  assert(entry.startsWith('package/') && !entry.split('/').includes('..'), `Unsafe archive entry: ${entry}`)
  assert(!/^package\/(?:node_modules|src|tests|scripts)\//.test(entry), `Development payload: ${entry}`)
}
for (const entry of ['package/package.json', 'package/lib/index.js', 'package/lib/index.d.ts', 'package/lib/configure.js', 'package/lib/configure.d.ts', 'package/lib/configuration.js', 'package/lib/configuration.d.ts', 'package/lib/client.js', 'package/lib/client/index.d.ts', 'package/cordis.patch.yml', 'package/locale/en.json', 'package/icon.svg', 'package/README.md', 'package/LICENSE']) assert(entries.includes(entry), `Missing ${entry}`)
const temporary = await mkdtemp(join(tmpdir(), 'dsh-auth-oidc-packed-'))
// Deletion is limited to the exact canonical directory returned by mkdtemp.
const canonical = await realpath(temporary)
assert(canonical === temporary && canonical.startsWith(join(tmpdir(), 'dsh-auth-oidc-packed-')))
try {
  execFileSync('tar', ['-xzf', archive, '-C', temporary])
  const root = join(temporary, 'package')
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-auth-oidc')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert(!JSON.stringify(manifest).includes('workspace:'))
  // Reuse the locked standalone resolver only; no package manager or profile mutation.
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir')
  assert.equal(manifest.main, 'lib/configure.js')
  assert.equal(manifest.types, 'lib/configure.d.ts')
  assert.deepEqual(manifest.exports['.'], { types: './lib/configure.d.ts', default: './lib/configure.js' })
  assert.deepEqual(manifest.exports['./runtime'], { types: './lib/index.d.ts', default: './lib/index.js' })
  const plugin = await import(pathToFileURL(join(root, manifest.exports['./runtime'].default)).href)
  for (const key of ['name', 'inject', 'Config', 'apply']) assert(key in plugin, `Missing ${key}`)
  assert.equal(typeof plugin.apply, 'function')
  assert.equal('default' in plugin, false)
  const configure = await import(pathToFileURL(join(root, manifest.exports['.'].default)).href)
  assert.equal(configure.name, 'auth-oidc-settings')
  assert.deepEqual(configure.inject, [])
  for (const key of ['name', 'inject', 'Config', 'apply']) assert(key in configure, `Missing configurator ${key}`)
  assert.equal(manifest.exports['./configure'].default, './lib/configure.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert((await readFile(join(root, 'lib/client.js'), 'utf8')).includes('window.__ModuleLoader__.load('))
  const consumer = join(root, 'consumer.mts')
  await writeFile(consumer, `import type { Context } from '@deepseek-ai/cordis'\nimport { apply, Config, inject, name } from 'dsh-auth-oidc/runtime'\nconst activation: (ctx: Context, config: Config) => Promise<void> = apply\nimport { apply as configure, Config as Settings } from 'dsh-auth-oidc'\nimport { apply as client } from 'dsh-auth-oidc/client'\nconst owner: (ctx: Context, config: Settings) => void = configure\nconst browser: (ctx: Context) => Promise<void> = client\nvoid [activation, Config, inject, name, owner, browser]\n`)
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), consumer, '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2024', '--types', 'node'], { cwd: root, stdio: 'inherit' })
  console.log(`Verified ${entries.length} packed files, extracted Cordis imports, and NodeNext consumer declarations: ${archive}`)
} finally {
  assert.equal(await realpath(temporary), canonical)
  await rm(canonical, { recursive: true })
}
