/** Check the complete runtime closure and bundle assets before packing. */
import { access, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (JSON.stringify(manifest).includes('workspace:')) throw new Error('Workspace dependency in standalone package')
for (const file of ['lib/index.js', 'lib/index.d.ts', 'lib/configure.js', 'lib/configure.d.ts', 'lib/configuration.js', 'lib/configuration.d.ts', 'lib/client.js', 'lib/client/index.d.ts', 'lib/compatibility.js', 'lib/compatibility.d.ts', 'cordis.patch.yml', 'icon.svg', 'LICENSE']) {
  await access(resolve(root, file))
}
for (const file of await readdir(resolve(root, 'lib'))) {
  if (!file.endsWith('.js') || file === 'client.js') continue
  const code = await readFile(resolve(root, 'lib', file), 'utf8')
  for (const match of code.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('node:')) continue
    if (specifier.startsWith('.')) {
      if (!specifier.endsWith('.js')) throw new Error(`Non-JS runtime import: ${specifier}`)
      await access(resolve(root, 'lib', specifier))
    } else {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (!manifest.dependencies?.[name] && !manifest.peerDependencies?.[name]) throw new Error(`Undeclared runtime import: ${name}`)
    }
  }
}
if (manifest.main !== 'lib/configure.js' || manifest.types !== 'lib/configure.d.ts' || manifest.exports['.'].default !== './lib/configure.js' || manifest.exports['.'].types !== './lib/configure.d.ts') throw new Error('Root export must be the discoverable settings owner')
if (manifest.exports['./runtime'].default !== './lib/index.js' || manifest.exports['./runtime'].types !== './lib/index.d.ts') throw new Error('Missing explicit raw runtime export')
const plugin = await import('dsh-auth-oidc/runtime')
for (const key of ['name', 'inject', 'Config', 'apply']) if (!(key in plugin)) throw new Error(`Missing Cordis export: ${key}`)
if ('default' in plugin) throw new Error('Mixed Cordis plugin exports')
const configure = await import('dsh-auth-oidc')
if (configure.name !== 'auth-oidc-settings' || configure.inject.length !== 0) throw new Error('Package root is not an always-active settings owner')
for (const key of ['name', 'inject', 'Config', 'apply']) if (!(key in configure)) throw new Error(`Missing configurator export: ${key}`)
const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
if (!client.includes('window.__ModuleLoader__.load(') || !client.includes('dsh-auth-oidc/client')) throw new Error('Missing browser factory registration')
const allowedClientImports = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store', 'zod'])
for (const match of client.matchAll(/require\(["']([^"']+)["']\)/g)) {
  if (!allowedClientImports.has(match[1])) throw new Error(`Undeclared browser external: ${match[1]}`)
}
console.log('Standalone Host/configurator imports, browser factory closure, Cordis exports, declarations, and bundle assets verified')
