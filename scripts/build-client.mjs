/** Emit the existing DSH ModuleLoader lazy-factory format, not executable Host ESM. */
import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'

const external = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
const result = await build({ entryPoints: ['src/client/index.ts'], bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic', external, loader: { '.css': 'text' } })
const code = result.outputFiles[0].text
await writeFile('lib/client.js', `window.__ModuleLoader__.load({ id: "dsh-auth-oidc/client", factory: (require) => {\nconst module = { exports: {} };\n${code}\nreturn module.exports;\n} });\n`)
