import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Integration against an unpublished patched Connection is opt-in and must use built artifacts.
const connectionEntry = process.env.DSH_OIDC_CONNECTION_ENTRY
export default defineConfig({
  plugins: [{
    name: 'published-settings-model-test-face', enforce: 'pre',
    resolveId(id) { if (id === '@deepseek-ai/dsh-client-ui-primitives') return '\0published-settings-model' },
    load(id) {
      if (id !== '\0published-settings-model') return
      // Execute the exact published pure model region without loading unrelated React/CSS features.
      const code = readFileSync(import.meta.resolve('@deepseek-ai/dsh-client-ui-primitives').replace('file://', ''), 'utf8')
      const start = code.indexOf('//#region lib/types/settings-form/form-model.js')
      const end = code.indexOf('//#endregion', start)
      if (start < 0 || end < 0) throw new Error('Pinned settings model artifact region is absent')
      return `import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';\n${code.slice(start, end)}\nexport { SettingsFormModel, settingsNumberField, settingsTextField };`
    },
  }],
  resolve: { alias: [
    ...(connectionEntry ? [{ find: /^@deepseek-ai\/dsh-client-connection$/, replacement: resolve(connectionEntry) }] : []),
    ...(process.env.DSH_OIDC_ARTIFACT_TEST === '1' ? [{ find: /^\.\.\/src\/index\.ts$/, replacement: resolve('lib/index.js') }] : []),
  ] },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
