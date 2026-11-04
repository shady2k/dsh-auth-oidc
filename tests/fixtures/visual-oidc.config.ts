/** Explicit opt-in fixture config; not collected by the project's normal spec/e2e glob. */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/visual-oidc.visual.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
})
